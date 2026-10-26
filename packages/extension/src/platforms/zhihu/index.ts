import type { AdapterContext, AuthState, DraftResult, RenderedPost } from '@yuzgeo/core';
import { PLATFORMS } from '@yuzgeo/core';
import { md5 } from 'js-md5';
import { getCookie, HttpError, jsonBody, requestJson } from '../../lib/http';
import type { ExtensionAdapter } from '../types';
import { zhihuHtmlOptions } from './html';
import { signOssPut } from './oss';

const ZHUANLAN = 'https://zhuanlan.zhihu.com';
const ME_URL = 'https://www.zhihu.com/api/v4/me';
const DRAFTS_URL = `${ZHUANLAN}/api/articles/drafts`;
const draftUrl = (id: string) => `${ZHUANLAN}/api/articles/${id}/draft`;
const IMAGES_URL = 'https://api.zhihu.com/images';
const OSS_HOST = 'zhihu-pics-upload.zhimg.com';
const OSS_BUCKET = 'zhihu-pics';
// Mirrors what Aliyun's browser SDK sends; Zhihu's bucket policy may expect it.
const OSS_USER_AGENT = 'aliyun-sdk-js/6.8.0';
/** `upload_file.state` value meaning the hash is already stored and no PUT is needed. */
const IMAGE_ALREADY_EXISTS = 1;
const IMAGE_POLL_ATTEMPTS = 10;
const IMAGE_POLL_DELAY_MS = 500;

interface ZhihuMe {
  name?: string;
  url_token?: string;
}

interface ZhihuDraft {
  id: number | string;
}

interface ImageUploadTicket {
  upload_file: { state: number; image_id: string; object_key: string };
  upload_token?: {
    access_id: string;
    access_key: string;
    access_token: string;
    access_timestamp?: number;
  };
}

interface ImageInfo {
  status?: string;
  original_src?: string;
  src?: string;
  watermark_src?: string;
}

/** Zhihu errors look like `{ "error": { "message": "...", "code": ... } }`. */
function zhihuErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    try {
      const parsed = JSON.parse(error.body) as { error?: { message?: string } };
      if (parsed.error?.message) return `${parsed.error.message}（HTTP ${error.status}）`;
    } catch {
      // Not JSON; fall through to the generic message.
    }
    return `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function withZhihuError<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error(`知乎${action}失败：${zhihuErrorMessage(error)}`, { cause: error });
  }
}

/** Zhihu's write APIs require the `_xsrf` cookie echoed back as a header. */
async function xsrfHeaders(): Promise<Record<string, string>> {
  const token = await getCookie('https://www.zhihu.com', '_xsrf');
  if (!token) throw new Error('未找到知乎的 _xsrf Cookie，请先在浏览器中打开一次 zhihu.com 后重试');
  return { 'x-xsrftoken': token };
}

function jsonRequest(
  method: string,
  data: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
): RequestInit {
  const init = jsonBody(data);
  return {
    ...init,
    method,
    headers: { ...(init.headers as Record<string, string>), ...headers },
    signal,
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function checkAuth(ctx: AdapterContext): Promise<AuthState> {
  try {
    const me = await requestJson<ZhihuMe>(ME_URL, { signal: ctx.signal });
    return { loggedIn: true, username: me.name ?? me.url_token };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403))
      return { loggedIn: false };
    throw error;
  }
}

async function createDraft(post: RenderedPost, ctx: AdapterContext): Promise<DraftResult> {
  const headers = await xsrfHeaders();
  const draft = await withZhihuError('创建草稿', () =>
    requestJson<ZhihuDraft>(
      DRAFTS_URL,
      jsonRequest(
        'POST',
        { title: post.title, content: post.body, delta_time: 0 },
        headers,
        ctx.signal,
      ),
    ),
  );
  const id = String(draft.id);
  ctx.log(`知乎草稿已创建：${id}`);

  // Creation alone may not keep the body or cover; the editor always saves via this PATCH.
  const update = {
    title: post.title,
    content: post.body,
    delta_time: 0,
    table_of_contents: false,
    ...(post.coverUrl ? { titleImage: post.coverUrl, isTitleImageFullScreen: false } : {}),
  };
  await withZhihuError('保存草稿', () =>
    fetchOk(draftUrl(id), jsonRequest('PATCH', update, headers, ctx.signal)),
  );

  return { id, draftUrl: `${ZHUANLAN}/p/${id}/edit` };
}

/** The draft PATCH may answer with an empty body, so don't parse it. */
async function fetchOk(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, { credentials: 'include', ...init });
  if (!response.ok)
    throw new HttpError(response.status, url, await response.text().catch(() => ''));
}

async function uploadImage(image: Blob, ctx: AdapterContext): Promise<string> {
  const bytes = await image.arrayBuffer();
  const headers = await xsrfHeaders();
  const ticket = await withZhihuError('申请图片上传', () =>
    requestJson<ImageUploadTicket>(
      IMAGES_URL,
      jsonRequest('POST', { image_hash: md5(bytes), source: 'article' }, headers, ctx.signal),
    ),
  );
  const { image_id: imageId, object_key: objectKey, state } = ticket.upload_file;

  if (state !== IMAGE_ALREADY_EXISTS) {
    const token = ticket.upload_token;
    if (!token) throw new Error('知乎图片上传失败：未返回上传凭证');
    const contentType = image.type || 'application/octet-stream';
    const signed = await signOssPut(
      {
        bucket: OSS_BUCKET,
        objectKey,
        contentType,
        date: new Date().toUTCString(),
        ossHeaders: { 'x-oss-user-agent': OSS_USER_AGENT },
      },
      {
        accessKeyId: token.access_id,
        accessKeySecret: token.access_key,
        securityToken: token.access_token,
      },
    );
    await withZhihuError('上传图片', () =>
      fetchOk(`https://${OSS_HOST}/${objectKey}`, {
        method: 'PUT',
        headers: signed,
        body: bytes,
        credentials: 'omit',
        signal: ctx.signal,
      }),
    );
  }

  return withZhihuError('获取图片地址', () => waitForImage(imageId, ctx.signal));
}

/** Zhihu processes uploads asynchronously; the URL is only usable once status is `success`. */
async function waitForImage(imageId: string, signal: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < IMAGE_POLL_ATTEMPTS; attempt++) {
    const info = await requestJson<ImageInfo>(`${IMAGES_URL}/${imageId}`, { signal });
    const url = info.original_src || info.src || info.watermark_src;
    if (info.status === 'success' && url) return url;
    await delay(IMAGE_POLL_DELAY_MS, signal);
  }
  throw new Error(`图片 ${imageId} 处理超时`);
}

export const zhihu: ExtensionAdapter = {
  meta: PLATFORMS.zhihu,
  htmlOptions: zhihuHtmlOptions,
  headerRules: [
    {
      requestDomains: ['zhihu.com'],
      setHeaders: { Origin: ZHUANLAN, Referer: `${ZHUANLAN}/write` },
    },
    {
      // The OSS bucket's CORS rules allow Zhihu's own origin.
      requestDomains: [OSS_HOST],
      setHeaders: { Origin: ZHUANLAN, Referer: `${ZHUANLAN}/` },
    },
  ],
  checkAuth,
  uploadImage,
  createDraft,
};
