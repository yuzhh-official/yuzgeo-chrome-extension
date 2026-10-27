import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import {
  assertDraftRequest,
  buildDraftBody,
  ORIGIN,
  parseDraftId,
  readSession,
  saveUrl,
} from './api';
import { weixin } from './index';

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };
const post: RenderedPost = {
  title: '测试文章（请勿发布）',
  body: '<p>文字<a href="https://example.com">链接说明</a></p>',
  markdown: '',
  tags: [],
  extra: { sub: 'send', publish: true },
  coverUrl: 'https://invalid/cover.png',
};
const html = `window.wx={data:{t:"123456"},user_name:"gh_test",nick_name:"测试公众号"}`;
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('WeChat text-only drafts', () => {
  it('requires a token and account, without evaluating page scripts', () => {
    expect(readSession(html)).toEqual({ token: '123456', username: '测试公众号' });
    expect(readSession('<html>扫码登录</html>')).toBeUndefined();
    expect(readSession('data:{t:"123"}')).toBeUndefined();
    expect(readSession('data:{t:alert(1)},user_name:"x"')).toBeUndefined();
    expect(() => saveUrl('123&sub=send')).toThrow();
  });
  it('ignores metadata, cover and publication claims and flattens links', () => {
    const body = buildDraftBody(post, '123');
    expect(body.get('content0')).toBe('<p>文字链接说明</p>');
    expect(body.get('cdn_url0')).toBe('');
    expect(body.get('copyright_type0')).toBe('0');
    expect(body.get('AppMsgId')).toBe('');
    expect(body.toString()).not.toMatch(/publish|invalid|sub=/);
    expect(() => buildDraftBody({ ...post, title: '长'.repeat(65) }, '123')).toThrow('64');
  });
  it('rejects publishing, updates, extra/duplicate query parameters and other origins', () => {
    const url = saveUrl('123');
    const body = buildDraftBody(post, '123');
    expect(() => assertDraftRequest(url, body)).not.toThrow();
    for (const bad of [
      url.replace('sub=create', 'sub=send'),
      url + '&sub=create',
      url + '&publish=1',
      url.replace(ORIGIN, 'https://evil.test'),
      url + '#x',
      url.replace('/operate_appmsg', '/masssend'),
    ])
      expect(() => assertDraftRequest(bad, body)).toThrow();
    body.set('AppMsgId', '100');
    expect(() => assertDraftRequest(url, body)).toThrow();
    body.set('AppMsgId', '');
    body.set('publish', '1');
    expect(() => assertDraftRequest(url, body)).toThrow();
  });
  it('requires a valid id and respects error codes even if an id is present', () => {
    expect(parseDraftId({ base_resp: { ret: 0 }, appMsgId: '123456789012345678' })).toBe(
      '123456789012345678',
    );
    for (const value of [
      null,
      {},
      { appMsgId: 0 },
      { appMsgId: Number.MAX_SAFE_INTEGER + 1 },
      { appMsgId: '1/../2' },
      { appMsgId: 1, base_resp: { ret: 200003 } },
    ])
      expect(() => parseDraftId(value)).toThrow();
    expect(() => parseDraftId({ base_resp: { ret: -6 } })).toThrow('完成验证');
  });
  it.each([401, 403])('recognizes HTTP %s as logged out', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    expect(await weixin.checkAuth(ctx)).toEqual({ loggedIn: false });
  });
  it('exposes network failures rather than reporting logged out', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(weixin.checkAuth(ctx)).rejects.toThrow('network');
  });
  it('uses a fresh session for one write and never persists a token in the draft link', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(html))
      .mockResolvedValueOnce(Response.json({ base_resp: { ret: 0 }, appMsgId: '789' }));
    const result = await weixin.createDraft(post, ctx);
    expect(result).toEqual({ id: '789', draftUrl: ORIGIN + '/' });
    expect(JSON.stringify(result)).not.toContain('123456');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1]!;
    assertDraftRequest(url, new URLSearchParams(init.body));
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('include');
    expect(ctx.log).not.toHaveBeenCalledWith(expect.stringContaining('123456'));
  });
  it('does not write when logged out or retry an uncertain write', async () => {
    fetchMock.mockResolvedValue(new Response('扫码登录'));
    await expect(weixin.createDraft(post, ctx)).rejects.toThrow('登录');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response(html))
      .mockRejectedValueOnce(new Error('lost'));
    await expect(weixin.createDraft(post, ctx)).rejects.toThrow('lost');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(weixin.uploadImage(new Blob(), ctx)).rejects.toThrow('暂不支持');
  });
});
