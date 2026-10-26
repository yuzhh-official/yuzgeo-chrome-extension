import type { AdapterContext, AuthState, DraftResult, RenderedPost } from '@yuzgeo/core';
import { PLATFORMS } from '@yuzgeo/core';
import { HttpError, jsonBody } from '../../lib/http';
import type { ExtensionAdapter } from '../types';
import {
  AliyunError,
  callApi,
  CSRF_HEADER,
  CSRF_PARAM,
  csrfToken,
  draftEditorUrl,
  EDITOR_URL,
  ORIGIN,
  SAVE_DRAFT_URL,
  USER_URL,
} from './api';

/** Content type flag for markdown articles in the editor's save payload (unverified). */
const CONTENT_TYPE_MARKDOWN = 'markdown';
const MAX_SUMMARY_LENGTH = 200;

interface AliyunUser {
  nickname?: string;
  nickName?: string;
  userName?: string;
  username?: string;
  name?: string;
  userId?: string | number;
}

interface SavedDraft {
  id?: string | number;
  articleId?: string | number;
  draftId?: string | number;
}

function pickUsername(user: AliyunUser): string | undefined {
  const name = user.nickname || user.nickName || user.userName || user.username || user.name;
  return name || (user.userId !== undefined ? String(user.userId) : undefined);
}

async function checkAuth(ctx: AdapterContext): Promise<AuthState> {
  try {
    const user = await callApi<AliyunUser | null>(USER_URL, { signal: ctx.signal }, '获取用户信息');
    if (!user || typeof user !== 'object') return { loggedIn: false };
    return { loggedIn: true, username: pickUsername(user) };
  } catch (error) {
    if (error instanceof AliyunError) return { loggedIn: false };
    const cause = (error as Error).cause;
    if (cause instanceof HttpError && (cause.status === 401 || cause.status === 403))
      return { loggedIn: false };
    throw error;
  }
}

function draftId(saved: SavedDraft | string | number | null | undefined): string {
  if (typeof saved === 'string' || typeof saved === 'number') return String(saved);
  const id = saved?.id ?? saved?.articleId ?? saved?.draftId;
  if (id === undefined || id === null || id === '')
    throw new Error('阿里云开发者社区保存草稿失败：未返回草稿 ID');
  return String(id);
}

async function createDraft(post: RenderedPost, ctx: AdapterContext): Promise<DraftResult> {
  const token = await csrfToken();
  const url = new URL(SAVE_DRAFT_URL);
  url.searchParams.set(CSRF_PARAM, token);
  const init = jsonBody({
    title: post.title,
    content: post.body,
    contentType: CONTENT_TYPE_MARKDOWN,
    description: (post.summary ?? '').slice(0, MAX_SUMMARY_LENGTH),
    tags: post.tags.join(','),
    ...(post.coverUrl ? { cover: post.coverUrl } : {}),
  });
  const saved = await callApi<SavedDraft | string | number | null>(
    url.toString(),
    {
      ...init,
      headers: { ...(init.headers as Record<string, string>), [CSRF_HEADER]: token },
      signal: ctx.signal,
    },
    '保存草稿',
  );
  const id = draftId(saved);
  ctx.log(`阿里云开发者社区草稿已保存：${id}`);
  return { id, draftUrl: draftEditorUrl(id) };
}

export const aliyun: ExtensionAdapter = {
  meta: PLATFORMS.aliyun,
  headerRules: [
    {
      requestDomains: ['developer.aliyun.com'],
      setHeaders: { Origin: ORIGIN, Referer: EDITOR_URL },
    },
  ],
  checkAuth,
  uploadImage: () => Promise.reject(new Error('阿里云开发者社区暂不支持图片上传')),
  createDraft,
};
