// Douyin creator-center details. The draft endpoint and payload shape were confirmed by studying how
// an existing sync tool talks to the creator center; anything still marked UNVERIFIED is not.

import type { RenderedPost } from '@yuzgeo/core';
import type { PageResult } from '../../lib/page-context';

export const CREATOR = 'https://creator.douyin.com';
export const COOKIE_URL = CREATOR;
/** Session cookies set on `.douyin.com` at login; any one of them means a session exists. */
export const SESSION_COOKIES = ['sessionid_ss', 'sessionid'] as const;
/** Returns `{ status_code: 0, user: { nickname, … } }` for a logged-in account. */
export const USER_INFO_URL = `${CREATOR}/web/api/media/user/info/`;

/**
 * Page opened (in the background) to run the draft request in. Any creator-center page loads the
 * security SDK that signs requests; the home page is the most stable URL.
 */
export const PAGE_URL = `${CREATOR}/creator-micro/home`;
export const PAGE_MATCH = `${CREATOR}/*`;

/** The long-article editor's "存草稿" endpoint; drafts only, it never publishes. */
export const SAVE_DRAFT_PATH = '/web/api/media/aweme/draft';
/** App id the creator center sends with its web API calls. */
export const APP_ID = '1128';
/** UNVERIFIED: where the user finds article drafts (content management, drafts tab). */
export const DRAFTS_PAGE_URL = `${CREATOR}/creator-micro/content/manage`;

export const REQUEST_TIMEOUT_MS = 20_000;
/** `status_code` meaning success in Douyin web API responses. */
export const STATUS_OK = 0;

/** Guard: this adapter must never call anything that could publish. */
export function assertDraftOnlyPath(path: string): void {
  if (/publish|release|post_article|create_item|create_v2/i.test(path))
    throw new Error(`抖音长文：拒绝调用可能发布内容的接口（${path}）`);
}

/** Client-generated id the editor uses to identify one creation across saves. */
export function createCreationId(now = Date.now(), random = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let prefix = '';
  for (let i = 0; i < 8; i++) prefix += chars[Math.floor(random() * chars.length)];
  return `${prefix}${now}`;
}

/**
 * Draft payload for a markdown long article. Text-only: no images, no cover. UNVERIFIED: whether
 * the editor puts the summary in `description` (sent empty here, as the editor does by default).
 */
export function buildDraftBody(
  post: RenderedPost,
  creationId: string,
  now = Date.now(),
): Record<string, unknown> {
  return {
    item: {
      common: {
        draft: {
          title: post.title,
          description: '',
          long_article: post.body,
          image_info: [],
          head_poster: '',
          poster: '',
          text_extra: '[]',
          visibility_type: 0,
          timing: 0,
          creation_id: creationId,
          init_timestamp: Math.floor(now / 1000),
          req_type: 0,
        },
      },
      cover: {},
    },
  };
}

export interface PageHttpResult {
  status: number;
  text: string;
}

export interface DraftRequest {
  url: string;
  body: string;
  timeoutMs: number;
}

/**
 * Runs in the creator-center page's MAIN world (serialized by `runInPage`): no closures, never
 * throws. Uses XMLHttpRequest because Douyin's security SDK hooks it to add the a_bogus/X-Bogus
 * signature and the secsdk CSRF token, exactly as for the page's own requests.
 */
export function pageSendJson(req: DraftRequest): Promise<PageResult<PageHttpResult>> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', req.url, true);
      xhr.withCredentials = true;
      xhr.timeout = req.timeoutMs;
      xhr.setRequestHeader('content-type', 'application/json');
      xhr.onload = () =>
        resolve({ ok: true, value: { status: xhr.status, text: xhr.responseText } });
      xhr.onerror = () => resolve({ ok: false, error: '抖音长文：网络请求失败' });
      xhr.ontimeout = () => resolve({ ok: false, error: '抖音长文：请求超时' });
      xhr.send(req.body);
    } catch (error) {
      resolve({ ok: false, error: `抖音长文：页面内请求出错（${String(error)}）` });
    }
  });
}

interface DouyinResponse {
  status_code?: number;
  status_msg?: string;
  message?: string;
  data?: Record<string, unknown> | null;
  [key: string]: unknown;
}

const ID_KEYS = ['draft_id', 'article_id', 'item_id', 'id'] as const;

function pickId(source: Record<string, unknown> | null | undefined): string | undefined {
  if (!source) return undefined;
  for (const key of ID_KEYS) {
    const value = source[key];
    if ((typeof value === 'string' && value) || typeof value === 'number') return String(value);
  }
  return undefined;
}

function coverHint(message: string): string {
  return /封面|cover/i.test(message)
    ? '（抖音要求文章封面，而本工具为纯文本模式不上传图片，请在创作者中心手动添加封面后保存）'
    : '';
}

/** Checks the raw page response; returns the draft id when the API reports one. */
export function parseDraftResponse(result: PageHttpResult): string | undefined {
  let json: DouyinResponse;
  try {
    json = JSON.parse(result.text) as DouyinResponse;
  } catch {
    const detail = result.text.trim().slice(0, 200);
    throw new Error(
      `抖音长文保存草稿失败：HTTP ${result.status}${detail ? `，${detail}` : '，返回内容为空（可能被风控拦截）'}`,
    );
  }
  if (json.status_code !== STATUS_OK || result.status >= 400) {
    const message = json.status_msg || json.message || `status_code ${String(json.status_code)}`;
    throw new Error(`抖音长文保存草稿失败：${message}${coverHint(message)}`);
  }
  return pickId(json.data ?? undefined) ?? pickId(json);
}

interface UserInfoResponse {
  status_code?: number;
  user?: { nickname?: string; unique_id?: string; short_id?: string | number };
}

/** Username from the user-info endpoint, or undefined when the response isn't a logged-in user. */
export function parseUsername(json: unknown): string | undefined {
  const info = json as UserInfoResponse | null;
  if (!info || info.status_code !== STATUS_OK) return undefined;
  const user = info.user;
  return user?.nickname || user?.unique_id || undefined;
}
