import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aliyun } from './index';

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };

const post: RenderedPost = {
  title: 'T',
  summary: 'S',
  tags: ['Java', 'Cloud'],
  body: '# hi',
  markdown: '# hi',
  extra: {},
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubCookie(value: string | undefined) {
  const get = vi.fn(async () => (value === undefined ? null : { value }));
  vi.stubGlobal('browser', { cookies: { get } });
  return get;
}

beforeEach(() => stubCookie('tok'));
afterEach(() => vi.unstubAllGlobals());

describe('aliyun checkAuth', () => {
  it('returns the nickname when logged in', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ success: true, code: '200', data: { nickname: '小明', userId: 1 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await aliyun.checkAuth(ctx)).toEqual({ loggedIn: true, username: '小明' });
    expect(fetchMock.mock.calls[0]![1]!.signal).toBe(ctx.signal);
  });

  it('reports logged-out on an error envelope, null data, HTML or 401', async () => {
    const responses = [
      json({ success: false, code: '401', message: '未登录' }),
      json({ success: true, code: '200', data: null }),
      new Response('<html>login</html>'),
      json({ message: 'no' }, 401),
    ];
    for (const response of responses) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      );
      expect(await aliyun.checkAuth(ctx)).toEqual({ loggedIn: false });
    }
  });

  it('rethrows network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    await expect(aliyun.checkAuth(ctx)).rejects.toThrow('network down');
  });
});

describe('aliyun createDraft', () => {
  it('saves a markdown draft with the CSRF token', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ success: true, code: '200', data: { id: 12345 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await aliyun.createDraft(post, ctx);
    expect(result).toEqual({
      id: '12345',
      draftUrl: 'https://developer.aliyun.com/article/new?id=12345',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(url).searchParams.get('_csrf')).toBe('tok');
    expect((init!.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
    expect(init!.signal).toBe(ctx.signal);
    expect(JSON.parse(init!.body as string)).toMatchObject({
      title: 'T',
      content: '# hi',
      contentType: 'markdown',
      description: 'S',
      tags: 'Java,Cloud',
    });
  });

  it('accepts a bare id as data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 0, data: '987' })),
    );
    expect((await aliyun.createDraft(post, ctx)).id).toBe('987');
  });

  it('fails clearly without the CSRF cookie', async () => {
    stubCookie(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(aliyun.createDraft(post, ctx)).rejects.toThrow('c_csrf');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the platform message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ success: false, code: 'TitleTooLong', message: '标题过长' })),
    );
    await expect(aliyun.createDraft(post, ctx)).rejects.toThrow(
      '阿里云开发者社区保存草稿失败：标题过长',
    );
  });

  it('surfaces HTTP error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: '请求过于频繁' }, 429)),
    );
    await expect(aliyun.createDraft(post, ctx)).rejects.toThrow('请求过于频繁（HTTP 429）');
  });

  it('fails when no id comes back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ success: true, data: {} })),
    );
    await expect(aliyun.createDraft(post, ctx)).rejects.toThrow('未返回草稿 ID');
  });
});

describe('aliyun uploadImage', () => {
  it('is not supported yet', async () => {
    await expect(aliyun.uploadImage(new Blob(['x']), ctx)).rejects.toThrow(
      '阿里云开发者社区暂不支持图片上传',
    );
  });
});
