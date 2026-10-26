import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { assertDraftOnlyPath, DRAFTS_URL, EDITOR_URL, readAccount, USER_PATH } from './api';
import { fillDraft } from './editor';

const runInPage = vi.fn();
vi.mock('../../lib/page-context', () => ({ runInPage }));
const { sohu } = await import('./index');
const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };
const post: RenderedPost = {
  title: '文字测试（请勿发布）',
  body: '<p>正文</p>',
  markdown: '正文',
  tags: [],
  extra: {},
};
const fetchMock = vi.fn();
const cookie = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('location', new URL(EDITOR_URL));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) =>
      key === 'currentAccount'
        ? JSON.stringify({ id: 123 })
        : key === 'preview-sp-cm'
          ? 'page-client'
          : null,
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => (key === 'dv-id' ? 'page-device' : null),
  });
  vi.stubGlobal('browser', { cookies: { get: cookie } });
});
afterEach(() => vi.unstubAllGlobals());

describe('sohu account protocol', () => {
  it('validates the account id and name against the observed server envelope', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: 2000000, success: true, data: { id: 123, nickName: '作者' } }),
    );
    expect(await readAccount(1000)).toEqual({
      ok: true,
      value: { loggedIn: true, username: '作者' },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${USER_PATH}?accountId=123`);
    expect(fetchMock.mock.calls[0]?.[1].headers).toEqual({
      'sp-cm': 'page-client',
      'dv-id': 'page-device',
    });
  });
  it.each([401, 403])('treats HTTP %s as logged out', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    expect(await readAccount(1000)).toEqual({ ok: true, value: { loggedIn: false } });
  });
  it('does not mistake cached account data for a valid login', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: 2000000, success: true, data: { id: 999, nickName: 'other' } }),
    );
    expect((await readAccount(1000)).ok).toBe(false);
    fetchMock.mockRejectedValue(new Error('offline'));
    expect((await readAccount(1000)).ok).toBe(false);
  });
  it('handles an absent account or a login page without a request', async () => {
    expect(await readAccount(0)).toEqual({ ok: true, value: { loggedIn: false } });
    vi.stubGlobal('location', new URL('https://mp.sohu.com/mpfe/v4/login'));
    expect(await readAccount(1000)).toEqual({ ok: true, value: { loggedIn: false } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses other origins, publishing paths and existing editors', async () => {
    for (const path of [
      '/publish',
      '/mpbp/bp/news/publish',
      'https://evil.test' + USER_PATH,
      EDITOR_URL + '?id=42',
    ])
      expect(() => assertDraftOnlyPath(path)).toThrow('拒绝');
    expect(() => assertDraftOnlyPath(EDITOR_URL)).not.toThrow();
    expect(() => assertDraftOnlyPath(USER_PATH)).not.toThrow();
    vi.stubGlobal('location', new URL(EDITOR_URL + '?id=42'));
    expect(
      await fillDraft({ title: post.title, html: post.body, summary: '', timeoutMs: 0 }),
    ).toEqual({ ok: false, error: '搜狐号：拒绝操作非新建文章页面' });
  });
});

describe('sohu adapter', () => {
  it('avoids opening the site when no session cookie exists', async () => {
    cookie.mockResolvedValue(null);
    expect(await sohu.checkAuth(ctx)).toEqual({ loggedIn: false });
    expect(runInPage).not.toHaveBeenCalled();
  });
  it('checks the account using the site page', async () => {
    cookie.mockResolvedValue({ value: 'session' });
    runInPage.mockResolvedValue({ loggedIn: true, username: '作者' });
    expect(await sohu.checkAuth(ctx)).toEqual({ loggedIn: true, username: '作者' });
    expect(runInPage.mock.calls[0]?.[1]).toBe(readAccount);
  });
  it('saves only in a fresh editor and returns the content list', async () => {
    runInPage.mockResolvedValue({});
    const result = await sohu.createDraft(post, ctx);
    expect(result.draftUrl).toBe(DRAFTS_URL);
    expect(result.id).toMatch(/^local-/);
    expect(runInPage.mock.calls[0]?.[0]).toEqual({
      url: EDITOR_URL,
      match: 'https://mp.sohu.com/*',
      fresh: true,
    });
    expect(runInPage.mock.calls[0]?.[1]).toBe(fillDraft);
    expect(runInPage.mock.calls[0]?.[2][0].html).toBe(post.body);
  });
  it('surfaces permission errors and rejects invalid titles/images', async () => {
    runInPage.mockRejectedValue(new Error('未实名认证'));
    await expect(sohu.createDraft(post, ctx)).rejects.toThrow('未实名认证');
    await expect(sohu.createDraft({ ...post, title: '短' }, ctx)).rejects.toThrow('5–72');
    await expect(sohu.uploadImage(new Blob(), ctx)).rejects.toThrow('暂不支持');
  });
});
