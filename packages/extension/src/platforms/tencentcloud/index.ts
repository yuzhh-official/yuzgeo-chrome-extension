import type { AdapterContext, AuthState, DraftResult, RenderedPost } from '@yuzgeo/core';
import { PLATFORMS } from '@yuzgeo/core';
import { HttpError, jsonBody } from '../../lib/http';
import type { ExtensionAdapter } from '../types';
import {
  ADD_DRAFT_PATH,
  apiUrl,
  callApi,
  CSRF_QUERY_PARAM,
  csrfToken,
  editorUrl,
  ORIGIN,
  SESSION_PATH,
  SOURCE_TYPE_ORIGINAL,
  TencentCloudError,
  WRITE_PAGE,
} from './api';

interface SessionData {
  isLogin?: boolean;
  uid?: number | string;
  nickname?: string;
  name?: string;
  userInfo?: { nickname?: string; name?: string; uid?: number | string };
}

interface DraftData {
  draftId?: number | string;
  id?: number | string;
}

/** Plain-text approximation of markdown, sent alongside the source (the editor stores both). */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function checkAuth(ctx: AdapterContext): Promise<AuthState> {
  try {
    const data = await callApi<SessionData | null>(
      apiUrl(SESSION_PATH),
      { ...jsonBody({}), signal: ctx.signal },
      '获取用户信息',
    );
    const user = data?.userInfo ?? data;
    const loggedIn = Boolean(data && data.isLogin !== false && (user?.uid || user?.nickname));
    if (!loggedIn) return { loggedIn: false };
    return { loggedIn: true, username: user?.nickname || user?.name || String(user?.uid) };
  } catch (error) {
    if (error instanceof TencentCloudError) return { loggedIn: false };
    const cause = (error as Error).cause;
    if (cause instanceof HttpError && (cause.status === 401 || cause.status === 403))
      return { loggedIn: false };
    throw error;
  }
}

async function createDraft(post: RenderedPost, ctx: AdapterContext): Promise<DraftResult> {
  const token = await csrfToken();
  if (post.tags.length)
    ctx.log(`腾讯云开发者社区标签需在编辑器中选择，已忽略：${post.tags.join('、')}`);
  const data = await callApi<DraftData>(
    apiUrl(ADD_DRAFT_PATH, { [CSRF_QUERY_PARAM]: token }),
    {
      ...jsonBody({
        title: post.title,
        content: post.body,
        plain: markdownToPlain(post.body),
        sourceType: SOURCE_TYPE_ORIGINAL,
        summary: post.summary ?? '',
        pic: post.coverUrl ?? '',
      }),
      signal: ctx.signal,
    },
    '保存草稿',
  );
  const rawId = data?.draftId ?? data?.id;
  if (rawId === undefined || rawId === null || rawId === '')
    throw new Error('腾讯云开发者社区保存草稿失败：未返回草稿 ID');
  const id = String(rawId);
  ctx.log(`腾讯云开发者社区草稿已保存：${id}`);
  return { id, draftUrl: editorUrl(id) };
}

export const tencentcloud: ExtensionAdapter = {
  meta: PLATFORMS.tencentcloud,
  headerRules: [
    {
      requestDomains: ['cloud.tencent.com'],
      setHeaders: { Origin: ORIGIN, Referer: WRITE_PAGE },
    },
  ],
  checkAuth,
  uploadImage: () => Promise.reject(new Error('腾讯云开发者社区暂不支持图片上传')),
  createDraft,
};
