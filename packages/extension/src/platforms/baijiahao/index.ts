import { PLATFORMS } from '@yuzgeo/core';
import { HttpError, request } from '../../lib/http';
import type { ExtensionAdapter } from '../types';
import {
  assertDraftOnlyPath,
  buildDraftBody,
  draftUrl,
  EDITOR_URL,
  extractEditorToken,
  ORIGIN,
  parseAuth,
  parseDraftId,
  SAVE_DRAFT_URL,
  USER_URL,
} from './api';

export const baijiahao: ExtensionAdapter = {
  meta: PLATFORMS.baijiahao,
  headerRules: [
    {
      requestDomains: ['baijiahao.baidu.com'],
      setHeaders: { Origin: ORIGIN, Referer: EDITOR_URL },
    },
  ],
  async checkAuth(ctx) {
    try {
      const result = await request(USER_URL, { signal: ctx.signal, redirect: 'error' });
      return parseAuth(await result.text());
    } catch (error) {
      if (error instanceof HttpError && [401, 403].includes(error.status))
        return { loggedIn: false };
      throw error;
    }
  },
  uploadImage: () => Promise.reject(new Error('百家号暂不支持图片上传')),
  async createDraft(post, ctx) {
    ctx.signal.throwIfAborted();
    assertDraftOnlyPath(SAVE_DRAFT_URL);
    const editor = await request(EDITOR_URL, { signal: ctx.signal, redirect: 'error' });
    const token = extractEditorToken(await editor.text());
    const saved = await request(SAVE_DRAFT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', token },
      body: buildDraftBody(post).toString(),
      signal: ctx.signal,
      redirect: 'error',
    });
    const id = parseDraftId(await saved.text());
    ctx.log('百家号草稿已保存');
    return { id, draftUrl: draftUrl(id) };
  },
};
