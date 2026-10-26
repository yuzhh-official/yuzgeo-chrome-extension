import { PLATFORMS } from '@yuzgeo/core';
import { getCookie } from '../../lib/http';
import { runInPage } from '../../lib/page-context';
import type { ExtensionAdapter } from '../types';
import {
  assertDraftOnlyPath,
  DRAFTS_URL,
  EDITOR_URL,
  HOME_URL,
  ORIGIN,
  readAccount,
  USER_PATH,
} from './api';
import { fillDraft } from './editor';

export const sohu: ExtensionAdapter = {
  meta: PLATFORMS.sohu,
  // All requests run in the creator page, using its own Origin/Referer and session.
  headerRules: [],
  async checkAuth(ctx) {
    if (!(await getCookie(ORIGIN, 'ppinf')) && !(await getCookie(ORIGIN, 'pprdig')))
      return { loggedIn: false };
    assertDraftOnlyPath(USER_PATH);
    return runInPage({ url: HOME_URL, match: `${ORIGIN}/*` }, readAccount, [5000], ctx.signal);
  },
  uploadImage: () => Promise.reject(new Error('搜狐号暂不支持图片上传')),
  async createDraft(post, ctx) {
    ctx.signal.throwIfAborted();
    if (post.title.length < 5 || post.title.length > 72)
      throw new Error('搜狐号标题需为 5–72 个字符，请调整标题');
    assertDraftOnlyPath(EDITOR_URL);
    await runInPage(
      { url: EDITOR_URL, match: `${ORIGIN}/*`, fresh: true },
      fillDraft,
      [{ title: post.title, html: post.body, summary: post.summary ?? '', timeoutMs: 20000 }],
      ctx.signal,
    );
    ctx.log('搜狐号编辑器已确认保存草稿，请在内容管理中查看');
    // The editor does not expose a verified server id here; this is a local tracking id.
    return { id: `local-${crypto.randomUUID()}`, draftUrl: DRAFTS_URL };
  },
};
