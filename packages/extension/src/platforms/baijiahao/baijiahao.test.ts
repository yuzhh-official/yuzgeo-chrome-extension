import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import {
  assertDraftOnlyPath,
  buildDraftBody,
  EDITOR_URL,
  extractEditorToken,
  parseAuth,
  parseDraftId,
  parseResponse,
  SAVE_DRAFT_URL,
  USER_URL,
} from './api';
import { baijiahao } from './index';

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };
const post: RenderedPost = {
  title: '测试文章（请勿发布）',
  body: '<p>正文</p>',
  markdown: '正文',
  tags: [],
  coverUrl: 'https://invalid/cover.png',
  extra: { publish: true },
};
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('baijiahao protocol', () => {
  it('allows only the draft save path and known query', () => {
    expect(() => assertDraftOnlyPath(SAVE_DRAFT_URL)).not.toThrow();
    for (const path of [
      '/pcui/article/publish',
      '/pcui/article/save?publish=1',
      '/pcui/article/save/anything',
      'https://evil.test/pcui/article/save',
      '//evil.test/pcui/article/save',
      '/pcui/article/%70ublish',
    ])
      expect(() => assertDraftOnlyPath(path)).toThrow('拒绝');
  });
  it('creates only a text draft, ignoring cover and arbitrary metadata', () => {
    const body = buildDraftBody(post);
    expect(body.get('content')).toBe('<p>正文</p>');
    expect(body.get('title')).toBe(post.title);
    expect(body.get('type')).toBe('news');
    expect([...body.keys()].sort()).toEqual(['content', 'feed_cat', 'len', 'title', 'type']);
    expect(body.toString()).not.toMatch(/publish|cover|original|activity/);
  });
  it('parses quoted editor tokens without executing JavaScript', () => {
    expect(extractEditorToken('window.__BJH__INIT__AUTH__ = "test-token",window.next=1')).toBe(
      'test-token',
    );
    expect(extractEditorToken("window.__BJH__INIT__AUTH__='test-token';")).toBe('test-token');
    expect(extractEditorToken('window.__BJH__INIT__AUTH__="test\\u002dtoken"')).toBe('test-token');
    for (const input of [
      '<html>登录</html>',
      'window.__BJH__INIT__AUTH__=""',
      'window.__BJH__INIT__AUTH__=alert(1)',
    ])
      expect(() => extractEditorToken(input)).toThrow();
  });
  it('handles JSON/JSONP and rejects script execution and malformed responses', () => {
    expect(
      parseDraftId(
        'bjhdraft({"errno":0,"errmsg":"success","ret":{"article_id":"123456789012345678"}});',
      ),
    ).toBe('123456789012345678');
    for (const text of [
      'alert(1)',
      'null',
      '[]',
      'bjhdraft({});evil()',
      '{"errmsg":"success"}',
      '{"errno":1,"errmsg":"success","ret":{"article_id":12}}',
    ])
      expect(() => parseDraftId(text)).toThrow();
    expect(() => parseResponse('<html>验证</html>')).toThrow('无法识别');
    expect(() =>
      parseDraftId('{"errno":0,"errmsg":"success","ret":{"article_id":123456789012345678}}'),
    ).toThrow('有效草稿 ID');
  });
  it('recognizes a verified user and treats login expiry separately from service errors', () => {
    expect(
      parseAuth(
        JSON.stringify({
          errno: 0,
          errmsg: 'success',
          data: { user: { userid: '1', name: '作者' } },
        }),
      ),
    ).toEqual({ loggedIn: true, username: '作者' });
    expect(parseAuth('{"errno":401,"errmsg":"请先登录"}')).toEqual({ loggedIn: false });
    expect(parseAuth('{"errno":0,"errmsg":"success","data":{}}')).toEqual({ loggedIn: false });
    expect(() => parseAuth('{"errno":500,"errmsg":"服务繁忙"}')).toThrow('服务繁忙');
  });
});

describe('baijiahao adapter', () => {
  it.each([401, 403])('reports HTTP %s as logged out', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    expect(await baijiahao.checkAuth(ctx)).toEqual({ loggedIn: false });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(USER_URL);
  });
  it('surfaces network errors', async () => {
    fetchMock.mockRejectedValue(new Error('network failed'));
    await expect(baijiahao.checkAuth(ctx)).rejects.toThrow('network failed');
  });
  it('reads a fresh token and sends one draft request with redirects disabled', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('window.__BJH__INIT__AUTH__="temporary";'))
      .mockResolvedValueOnce(
        Response.json({ errno: 0, errmsg: 'success', ret: { article_id: '123' } }),
      );
    expect(await baijiahao.createDraft(post, ctx)).toEqual({
      id: '123',
      draftUrl: `${EDITOR_URL}?type=news&article_id=123`,
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([EDITOR_URL, SAVE_DRAFT_URL]);
    const options = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(options.method).toBe('POST');
    expect(options.headers).toHaveProperty('token', 'temporary');
    expect(options.credentials).toBe('include');
    expect(options.redirect).toBe('error');
    expect(options.signal).toBe(ctx.signal);
    expect(ctx.log).not.toHaveBeenCalledWith(expect.stringContaining('temporary'));
  });
  it('does not send any write when the editor token is absent', async () => {
    fetchMock.mockResolvedValue(new Response('登录页面'));
    await expect(baijiahao.createDraft(post, ctx)).rejects.toThrow('令牌');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not retry failed writes or upload images', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('window.__BJH__INIT__AUTH__="test";'))
      .mockRejectedValueOnce(new Error('connection lost'));
    await expect(baijiahao.createDraft(post, ctx)).rejects.toThrow('connection lost');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(baijiahao.uploadImage(new Blob(), ctx)).rejects.toThrow('暂不支持');
  });
});
