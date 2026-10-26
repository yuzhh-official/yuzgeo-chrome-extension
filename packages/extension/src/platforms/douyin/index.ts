import type { AdapterContext, AuthState, DraftResult, RenderedPost } from '@yuzgeo/core';
import { PLATFORMS } from '@yuzgeo/core';
import { getCookie } from '../../lib/http';
import { runInPage } from '../../lib/page-context';
import type { ExtensionAdapter } from '../types';
import {
  APP_ID,
  assertDraftOnlyPath,
  buildDraftBody,
  COOKIE_URL,
  createCreationId,
  CREATOR,
  DRAFTS_PAGE_URL,
  PAGE_MATCH,
  PAGE_URL,
  pageSendJson,
  parseDraftResponse,
  parseUsername,
  REQUEST_TIMEOUT_MS,
  SAVE_DRAFT_PATH,
  SESSION_COOKIES,
  USER_INFO_URL,
} from './api';

async function hasSessionCookie(): Promise<boolean> {
  for (const name of SESSION_COOKIES) {
    if (await getCookie(COOKIE_URL, name)) return true;
  }
  return false;
}

/** Best effort: the user-info endpoint may want a signature, so failure only loses the name. */
async function fetchUsername(signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(USER_INFO_URL, { credentials: 'include', signal });
    if (!response.ok) return undefined;
    return parseUsername(await response.json());
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

async function checkAuth(ctx: AdapterContext): Promise<AuthState> {
  if (!(await hasSessionCookie())) return { loggedIn: false };
  const username = await fetchUsername(ctx.signal);
  return username ? { loggedIn: true, username } : { loggedIn: true };
}

async function createDraft(post: RenderedPost, ctx: AdapterContext): Promise<DraftResult> {
  assertDraftOnlyPath(SAVE_DRAFT_PATH);
  if (!(await hasSessionCookie())) throw new Error('抖音长文：未登录，请先登录 creator.douyin.com');

  const creationId = createCreationId();
  const url = new URL(SAVE_DRAFT_PATH, CREATOR);
  url.searchParams.set('aid', APP_ID);
  const result = await runInPage(
    { url: PAGE_URL, match: PAGE_MATCH },
    pageSendJson,
    [
      {
        url: url.toString(),
        body: JSON.stringify(buildDraftBody(post, creationId)),
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    ],
    ctx.signal,
  );
  // The draft endpoint may not echo an id; the creation id identifies this draft either way.
  const id = parseDraftResponse(result) ?? creationId;
  ctx.log(`抖音长文草稿已保存：${id}`);
  return { id, draftUrl: DRAFTS_PAGE_URL };
}

export const douyin: ExtensionAdapter = {
  meta: PLATFORMS.douyin,
  headerRules: [
    {
      // Only affects the background user-info request; draft requests run inside the page.
      requestDomains: ['creator.douyin.com'],
      setHeaders: { Origin: CREATOR, Referer: `${CREATOR}/` },
    },
  ],
  checkAuth,
  uploadImage: () => Promise.reject(new Error('抖音长文暂不支持图片上传')),
  createDraft,
};
