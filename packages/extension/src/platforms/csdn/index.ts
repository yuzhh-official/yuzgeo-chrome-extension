import type { AdapterContext, AuthState, DraftResult, RenderedPost } from '@yuzgeo/core';
import { PLATFORMS, renderHtml } from '@yuzgeo/core';
import { getCookie } from '../../lib/http';
import type { ExtensionAdapter } from '../types';
import { callBizapi } from './api';
import { EDITOR_PAGE_URL } from './credentials';

const COOKIE_URL = 'https://mp.csdn.net';
/** Set on `.csdn.net` at login, cleared at logout; its value is the account's user name. */
const USERNAME_COOKIE = 'UserName';
const SAVE_ARTICLE_PATH = '/blog-console-api/v1/postedit/saveArticle';
/** Article `status`: 0 = publish, 2 = draft. We only ever send 2. */
const STATUS_DRAFT = 2;
const editorUrl = (id: string) => `${EDITOR_PAGE_URL}/${id}`;

interface SaveArticleData {
  id?: number | string;
  article_id?: number | string;
  url?: string;
}

async function checkAuth(_ctx: AdapterContext): Promise<AuthState> {
  const username = await getCookie(COOKIE_URL, USERNAME_COOKIE);
  if (!username) return { loggedIn: false };
  let decoded = username;
  try {
    decoded = decodeURIComponent(username);
  } catch {
    // Not percent-encoded; use as-is.
  }
  return { loggedIn: true, username: decoded };
}

function stringExtra(extra: Record<string, unknown>, key: string): string | undefined {
  const value = extra[key];
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(',');
  return undefined;
}

/** Request body mirroring what CSDN's markdown editor sends when saving a draft. */
export function buildSaveArticleBody(post: RenderedPost): Record<string, unknown> {
  return {
    article_id: '',
    title: post.title,
    description: post.summary ?? '',
    content: renderHtml(post.body),
    markdowncontent: post.body,
    tags: post.tags.join(','),
    categories: stringExtra(post.extra, 'categories') ?? '',
    type: stringExtra(post.extra, 'type') ?? 'original',
    status: STATUS_DRAFT,
    read_type: 'public',
    reason: '',
    resource_url: '',
    resource_id: '',
    original_link: stringExtra(post.extra, 'original_link') ?? '',
    authorized_status: false,
    check_original: false,
    source: 'pc_mdeditor',
    not_auto_saved: 1,
    is_new: 1,
    cover_type: post.coverUrl ? 1 : 0,
    cover_images: post.coverUrl ? [post.coverUrl] : [],
    vote_id: 0,
    scheduled_time: 0,
    creator_activity_id: '',
    sync_git_code: 0,
  };
}

async function createDraft(post: RenderedPost, ctx: AdapterContext): Promise<DraftResult> {
  const data = await callBizapi<SaveArticleData | null>(
    SAVE_ARTICLE_PATH,
    buildSaveArticleBody(post),
    ctx.signal,
    '保存草稿',
  );
  const rawId = data?.id ?? data?.article_id;
  if (rawId === undefined || rawId === null || rawId === '')
    throw new Error('CSDN 保存草稿失败：接口未返回文章 ID');
  const id = String(rawId);
  ctx.log(`CSDN 草稿已保存：${id}`);
  return { id, draftUrl: editorUrl(id) };
}

export const csdn: ExtensionAdapter = {
  meta: PLATFORMS.csdn,
  headerRules: [
    {
      requestDomains: ['csdn.net'],
      setHeaders: { Origin: 'https://mp.csdn.net', Referer: EDITOR_PAGE_URL },
    },
  ],
  checkAuth,
  uploadImage: () => Promise.reject(new Error('CSDN 暂不支持图片上传')),
  createDraft,
};
