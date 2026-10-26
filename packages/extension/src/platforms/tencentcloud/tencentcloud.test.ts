import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { csrfHash } from './api';
import { markdownToPlain, tencentcloud } from './index';

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };

const post: RenderedPost = {
  title: 'T',
  summary: 'S',
  tags: ['Vue'],
  body: '# hi\n\n**bold** [link](https://x.y)',
  markdown: '# hi',
  extra: {},
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubCookies(values: Record<string, string>) {
  vi.stubGlobal('browser', {
    cookies: {
      get: vi.fn(async ({ name }: { name: string }) =>
        name in values ? { value: values[name] } : null,
      ),
    },
  });
}

beforeEach(() => stubCookies({ skey: '@abcDEF123' }));
afterEach(() => vi.unstubAllGlobals());

describe('csrfHash', () => {
  it('matches the 5381 hash', () => {
    expect(csrfHash('')).toBe(5381);
    // 5381 * 33 + 97
    expect(csrfHash('a')).toBe(177670);
    let expected = 5381;
    for (const ch of '@abcDEF123') expected = (expected * 33 + ch.charCodeAt(0)) % 2 ** 32;
    expect(csrfHash('@abcDEF123')).toBe(expected & 0x7fffffff);
  });

  it('stays a non-negative 31-bit integer for long input', () => {
    const value = csrfHash('x'.repeat(500));
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0x7fffffff);
  });
});

describe('markdownToPlain', () => {
  it('strips common markdown syntax', () => {
    expect(markdownToPlain(post.body)).toBe('hi bold link');
  });
});

describe('tencentcloud adapter', () => {
  it('reports the nickname when logged in', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ code: 0, data: { isLogin: true, uid: 1, nickname: '小明' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await tencentcloud.checkAuth(ctx)).toEqual({ loggedIn: true, username: '小明' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://cloud.tencent.com/developer/api/user/session');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(ctx.signal);
  });

  it('reports logged-out on empty session, non-zero code or 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 0, data: {} })),
    );
    expect(await tencentcloud.checkAuth(ctx)).toEqual({ loggedIn: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 1001, msg: '未登录' })),
    );
    expect(await tencentcloud.checkAuth(ctx)).toEqual({ loggedIn: false });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ msg: 'no' }, 401)),
    );
    expect(await tencentcloud.checkAuth(ctx)).toEqual({ loggedIn: false });
  });

  it('creates a draft with the csrf token', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ code: 0, data: { draftId: 12345 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await tencentcloud.createDraft(post, ctx);
    expect(result).toEqual({
      id: '12345',
      draftUrl: 'https://cloud.tencent.com/developer/article/write?draftId=12345',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/developer/api/article/addArticleDraft');
    expect(parsed.searchParams.get('csrfCode')).toBe(String(csrfHash('@abcDEF123')));
    expect(init?.signal).toBe(ctx.signal);
    expect(JSON.parse(init?.body as string)).toMatchObject({
      title: 'T',
      content: post.body,
      summary: 'S',
    });
  });

  it('surfaces the platform message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 9, msg: '标题过长' })),
    );
    await expect(tencentcloud.createDraft(post, ctx)).rejects.toThrow(
      '腾讯云开发者社区保存草稿失败：标题过长',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ msg: '服务繁忙' }, 500)),
    );
    await expect(tencentcloud.createDraft(post, ctx)).rejects.toThrow('服务繁忙（HTTP 500）');
  });

  it('requires the skey cookie, falling back to p_skey', async () => {
    stubCookies({});
    vi.stubGlobal('fetch', vi.fn());
    await expect(tencentcloud.createDraft(post, ctx)).rejects.toThrow('skey');
    stubCookies({ p_skey: 'p' });
    const fetchMock = vi.fn(async (_url: string) => json({ code: 0, data: { id: 'd1' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await tencentcloud.createDraft(post, ctx)).id).toBe('d1');
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('csrfCode')).toBe(
      String(csrfHash('p')),
    );
  });

  it('does not support image upload yet', async () => {
    await expect(tencentcloud.uploadImage(new Blob(), ctx)).rejects.toThrow('暂不支持图片上传');
  });
});
