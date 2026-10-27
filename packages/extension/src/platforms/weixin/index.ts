import { PLATFORMS } from '@yuzgeo/core';
import { HttpError, request, requestJson } from '../../lib/http';
import type { ExtensionAdapter } from '../types';
import {
  assertDraftRequest,
  buildDraftBody,
  DRAFTS_URL,
  ORIGIN,
  parseDraftId,
  readSession,
  saveUrl,
} from './api';

async function session(signal: AbortSignal) {
  const response = await request(`${ORIGIN}/`, { signal });
  if (new URL(response.url || ORIGIN).origin !== ORIGIN) return undefined;
  return readSession(await response.text());
}

export const weixin: ExtensionAdapter = {
  meta: PLATFORMS.weixin,
  headerRules: [
    { requestDomains: ['mp.weixin.qq.com'], setHeaders: { Origin: ORIGIN, Referer: `${ORIGIN}/` } },
  ],
  async checkAuth(ctx) {
    try {
      const account = await session(ctx.signal);
      return account ? { loggedIn: true, username: account.username } : { loggedIn: false };
    } catch (error) {
      if (error instanceof HttpError && [401, 403].includes(error.status))
        return { loggedIn: false };
      throw error;
    }
  },
  uploadImage: () => Promise.reject(new Error('微信公众号暂不支持图片上传')),
  async createDraft(post, ctx) {
    ctx.signal.throwIfAborted();
    const account = await session(ctx.signal);
    if (!account) throw new Error('请先登录微信公众号后台');
    const body = buildDraftBody(post, account.token);
    const url = saveUrl(account.token);
    assertDraftRequest(url, body);
    const result = await requestJson<unknown>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
      signal: ctx.signal,
      redirect: 'error',
    });
    const id = parseDraftId(result);
    ctx.log('公众号草稿已保存，请进入公众号后台的草稿箱查看');
    return { id, draftUrl: DRAFTS_URL };
  },
};
