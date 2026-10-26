import type { AdapterContext, AuthState, DraftResult, RenderedPost } from '@yuzgeo/core';
import { PLATFORMS, renderHtml } from '@yuzgeo/core';
import { runInPage } from '../../lib/page-context';
import type { ExtensionAdapter } from '../types';
import {
  ARTICLE_EDITOR_URL,
  EDITOR_TIMEOUT_MS,
  fetchUserInfo,
  hasSessionCookie,
  MAX_ARTICLE_LENGTH,
  ORIGIN,
  plainText,
  textLength,
} from './api';
import { fillAndSaveDraft } from './editor';

async function checkAuth(ctx: AdapterContext): Promise<AuthState> {
  if (!(await hasSessionCookie())) return { loggedIn: false };
  const outcome = await fetchUserInfo(ctx.signal);
  if (outcome.kind === 'loggedOut') return { loggedIn: false };
  // `unknown` (e.g. the endpoint wants page-made signatures): trust the session cookie.
  if (outcome.kind === 'user' && outcome.username)
    return { loggedIn: true, username: outcome.username };
  return { loggedIn: true };
}

/**
 * Long-article drafts live only in the browser, written by the creator center itself. There is no
 * draft API, so we drive the editor: a fresh background tab, title and body filled in, and the
 * editor's own "save draft" button clicked. The editor stores the draft in its own format.
 */
async function createDraft(post: RenderedPost, ctx: AdapterContext): Promise<DraftResult> {
  ctx.signal.throwIfAborted();
  if (!(await hasSessionCookie())) throw new Error('小红书未登录，请先登录创作者中心后重试');

  const text = plainText(post.body);
  const length = textLength(text);
  if (length > MAX_ARTICLE_LENGTH)
    throw new Error(`小红书长文最多 ${MAX_ARTICLE_LENGTH} 字，本文约 ${length} 字`);

  await runInPage(
    // Fresh tab: never touch an editor the user may be writing in.
    { url: ARTICLE_EDITOR_URL, match: `${ORIGIN}/*`, fresh: true },
    fillAndSaveDraft,
    [{ title: post.title, html: renderHtml(post.body), text, timeoutMs: EDITOR_TIMEOUT_MS }],
    ctx.signal,
  );
  ctx.log('小红书长文草稿已保存到浏览器本地草稿箱');
  // The draft has no id we can read back; it shows up in the editor's 草稿箱 → 长文笔记.
  return { id: crypto.randomUUID(), draftUrl: ARTICLE_EDITOR_URL };
}

export const xiaohongshu: ExtensionAdapter = {
  meta: PLATFORMS.xiaohongshu,
  headerRules: [
    {
      requestDomains: ['creator.xiaohongshu.com'],
      setHeaders: { Origin: ORIGIN, Referer: `${ORIGIN}/` },
    },
  ],
  checkAuth,
  uploadImage: () => Promise.reject(new Error('小红书长文暂不支持图片上传')),
  createDraft,
};
