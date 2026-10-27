import { PLATFORMS } from '@yuzgeo/core';
import { runInPage } from '../../lib/page-context';
import type { ExtensionAdapter } from '../types';
import { DRAFTS_URL, EDITOR_URL, HOME_URL, ORIGIN, readAccount } from './api';
import { fillDraft } from './editor';

export const toutiao: ExtensionAdapter = {
  meta: PLATFORMS.toutiao,
  headerRules: [],
  checkAuth: (ctx) =>
    runInPage({ url: HOME_URL, match: `${ORIGIN}/*` }, readAccount, [5000], ctx.signal),
  uploadImage: () => Promise.reject(new Error('头条号暂不支持图片上传')),
  async createDraft(post, ctx) {
    ctx.signal.throwIfAborted();
    if ([...post.title].length < 2 || [...post.title].length > 30)
      throw new Error('头条号标题需为 2–30 个字符，请调整标题');
    await runInPage(
      { url: EDITOR_URL, match: `${ORIGIN}/*`, fresh: true },
      fillDraft,
      [{ title: post.title, html: post.body, timeoutMs: 20000 }],
      ctx.signal,
    );
    ctx.log('头条号编辑器已确认自动保存，请在草稿箱查看');
    return { id: `local-${crypto.randomUUID()}`, draftUrl: DRAFTS_URL };
  },
};
