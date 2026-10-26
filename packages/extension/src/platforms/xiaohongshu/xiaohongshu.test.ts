import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARTICLE_EDITOR_URL,
  MAX_ARTICLE_LENGTH,
  parseUserInfo,
  plainText,
  textLength,
  USER_INFO_URL,
} from './api';
import { fillAndSaveDraft } from './editor';

const runInPage = vi.fn();
vi.mock('../../lib/page-context', () => ({ runInPage }));
const { xiaohongshu } = await import('./index');

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };

const post: RenderedPost = {
  title: 'T',
  summary: 'S',
  tags: [],
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

function stubCookies(names: string[]) {
  const get = vi.fn(async (details?: { url: string; name: string }) =>
    details && names.includes(details.name) ? { value: 'v' } : null,
  );
  vi.stubGlobal('browser', { cookies: { get } });
  return get;
}

beforeEach(() => {
  stubCookies(['galaxy_creator_session_id']);
  runInPage.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('parseUserInfo', () => {
  it('reads the user name from a success envelope', () => {
    expect(
      parseUserInfo(JSON.stringify({ success: true, code: 0, data: { userName: '小红' } })),
    ).toEqual({ kind: 'user', username: '小红' });
    expect(parseUserInfo(JSON.stringify({ code: 0, data: { redId: '123' } }))).toEqual({
      kind: 'user',
      username: '123',
    });
  });

  it('detects logged-out envelopes', () => {
    expect(parseUserInfo(JSON.stringify({ success: false, code: -100 }))).toEqual({
      kind: 'loggedOut',
    });
    expect(parseUserInfo(JSON.stringify({ success: false, code: 1, msg: '请先登录' }))).toEqual({
      kind: 'loggedOut',
    });
  });

  it('treats HTML and unknown failures as inconclusive', () => {
    expect(parseUserInfo('<html></html>')).toEqual({ kind: 'unknown' });
    expect(
      parseUserInfo(JSON.stringify({ success: false, code: 300011, msg: '签名错误' })),
    ).toEqual({ kind: 'unknown' });
  });
});

describe('xiaohongshu checkAuth', () => {
  it('is logged out without a session cookie and makes no request', async () => {
    stubCookies([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await xiaohongshu.checkAuth(ctx)).toEqual({ loggedIn: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the user name from the user-info endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ success: true, code: 0, data: { userName: '小红' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await xiaohongshu.checkAuth(ctx)).toEqual({ loggedIn: true, username: '小红' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(USER_INFO_URL);
    expect(init!.signal).toBe(ctx.signal);
    expect(init!.credentials).toBe('include');
  });

  it('is logged out on 401 or a logged-out envelope', async () => {
    for (const response of [json({}, 401), json({ success: false, code: -100 }, 403)]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      );
      expect(await xiaohongshu.checkAuth(ctx)).toEqual({ loggedIn: false });
    }
  });

  it('trusts the cookie when the endpoint is inconclusive', async () => {
    for (const response of [new Response('<html></html>'), json({ code: 'x' }, 406)]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      );
      expect(await xiaohongshu.checkAuth(ctx)).toEqual({ loggedIn: true });
    }
  });

  it('rethrows network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    await expect(xiaohongshu.checkAuth(ctx)).rejects.toThrow('network down');
  });
});

describe('plain text helpers', () => {
  it('strips markdown syntax but keeps the words', () => {
    expect(plainText('# 标题\n\n**加粗** [链接](https://x)\n\n- 项\n\n```js\nlet a\n```')).toBe(
      '标题\n\n加粗 链接\n\n项\n\nlet a',
    );
    expect(textLength('a b\n c')).toBe(3);
  });
});

describe('xiaohongshu createDraft', () => {
  it('fills the editor in a fresh tab and lets it save the draft', async () => {
    runInPage.mockResolvedValue(null);
    const result = await xiaohongshu.createDraft({ ...post, body: '**粗体** 正文' }, ctx);
    expect(result.draftUrl).toBe(ARTICLE_EDITOR_URL);

    const [target, func, [input], signal] = runInPage.mock.calls[0] as [
      { url: string; fresh?: boolean },
      unknown,
      [{ title: string; html: string; text: string }],
      AbortSignal,
    ];
    expect(target).toMatchObject({ url: ARTICLE_EDITOR_URL, fresh: true });
    expect(func).toBe(fillAndSaveDraft);
    expect(input.title).toBe('T');
    expect(input.html).toContain('<strong>粗体</strong>');
    expect(input.text).toBe('粗体 正文');
    expect(signal).toBe(ctx.signal);
  });

  it('surfaces editor failures', async () => {
    runInPage.mockRejectedValue(new Error('没有找到小红书编辑器的“存草稿”按钮'));
    await expect(xiaohongshu.createDraft(post, ctx)).rejects.toThrow('存草稿');
  });

  it('rejects articles over the length limit before opening a tab', async () => {
    const body = '字'.repeat(MAX_ARTICLE_LENGTH + 1);
    await expect(xiaohongshu.createDraft({ ...post, body }, ctx)).rejects.toThrow(/最多/);
    expect(runInPage).not.toHaveBeenCalled();
  });

  it('asks to log in first when there is no session', async () => {
    stubCookies([]);
    await expect(xiaohongshu.createDraft(post, ctx)).rejects.toThrow('小红书未登录');
    expect(runInPage).not.toHaveBeenCalled();
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(
      xiaohongshu.createDraft(post, { ...ctx, signal: controller.signal }),
    ).rejects.toThrow('cancelled');
  });
});

describe('fillAndSaveDraft', () => {
  it('never targets publishing controls', () => {
    const source = fillAndSaveDraft.toString();
    expect(source).toMatch(/发布/);
    expect(source).not.toMatch(/\^\([^)]*发布/);
  });
});

describe('xiaohongshu uploadImage', () => {
  it('is not supported', async () => {
    await expect(xiaohongshu.uploadImage(new Blob(['x']), ctx)).rejects.toThrow(
      '小红书长文暂不支持图片上传',
    );
  });
});
