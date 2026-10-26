import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertDraftOnlyPath,
  buildDraftBody,
  createCreationId,
  DRAFTS_PAGE_URL,
  pageSendJson,
  parseDraftResponse,
  parseUsername,
  SAVE_DRAFT_PATH,
} from './api';

const runInPage = vi.fn();
vi.mock('../../lib/page-context', () => ({
  runInPage: (...args: unknown[]) => runInPage(...args),
}));

const { douyin } = await import('./index');

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };

const post: RenderedPost = {
  title: '标题',
  summary: '摘要',
  tags: ['a'],
  body: '# hi\n\n**bold**',
  markdown: '# hi\n\n**bold**',
  extra: {},
};

function stubCookies(values: Record<string, string>) {
  vi.stubGlobal('browser', {
    cookies: {
      get: vi.fn(async ({ name }: { name: string }) =>
        name in values ? { name, value: values[name] } : null,
      ),
    },
  });
}

beforeEach(() => runInPage.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('payload and response helpers', () => {
  it('builds a markdown long-article draft without images or cover', () => {
    const body = buildDraftBody(post, 'abc123', 1_700_000_000_500) as {
      item: { common: { draft: Record<string, unknown> }; cover: unknown };
    };
    const draft = body.item.common.draft;
    expect(draft.title).toBe('标题');
    expect(draft.long_article).toBe(post.body);
    expect(draft.image_info).toEqual([]);
    expect(draft.poster).toBe('');
    expect(draft.creation_id).toBe('abc123');
    expect(draft.init_timestamp).toBe(1_700_000_000);
    expect(body.item.cover).toEqual({});
    expect(JSON.stringify(body)).not.toMatch(/publish/i);
  });

  it('generates editor-style creation ids', () => {
    expect(createCreationId(42, () => 0)).toBe('aaaaaaaa42');
    expect(createCreationId()).toMatch(/^[a-z0-9]{8}\d{13}$/);
  });

  it('only ever targets a draft-only endpoint', () => {
    expect(() => assertDraftOnlyPath(SAVE_DRAFT_PATH)).not.toThrow();
    expect(() => assertDraftOnlyPath('/web/api/media/article/publish/')).toThrow(/拒绝/);
    expect(() => assertDraftOnlyPath('/web/api/media/aweme/create_v2/')).toThrow(/拒绝/);
  });

  it('extracts the draft id from data or top level when present', () => {
    const ok = (data: unknown) => ({ status: 200, text: JSON.stringify(data) });
    expect(parseDraftResponse(ok({ status_code: 0, data: { draft_id: 12 } }))).toBe('12');
    expect(parseDraftResponse(ok({ status_code: 0, article_id: 'x9' }))).toBe('x9');
    expect(parseDraftResponse(ok({ status_code: 0, data: {} }))).toBeUndefined();
  });

  it('reports API errors in Chinese, with a cover hint when relevant', () => {
    const res = { status: 200, text: JSON.stringify({ status_code: 7, status_msg: '请上传封面' }) };
    expect(() => parseDraftResponse(res)).toThrow(/请上传封面.*手动添加封面/);
    expect(() => parseDraftResponse({ status: 403, text: '' })).toThrow(/HTTP 403.*风控/);
  });

  it('reads the nickname from user info', () => {
    expect(parseUsername({ status_code: 0, user: { nickname: '小明' } })).toBe('小明');
    expect(parseUsername({ status_code: 8 })).toBeUndefined();
    expect(parseUsername(null)).toBeUndefined();
  });
});

describe('pageSendJson', () => {
  it('posts JSON via XHR with credentials and resolves with the response', async () => {
    const sent: Record<string, unknown> = {};
    class FakeXhr {
      status = 200;
      responseText = '{"status_code":0}';
      withCredentials = false;
      timeout = 0;
      headers: Record<string, string> = {};
      onload?: () => void;
      open(method: string, url: string) {
        Object.assign(sent, { method, url });
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      send(body: string) {
        Object.assign(sent, { body, withCredentials: this.withCredentials, headers: this.headers });
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const result = await pageSendJson({ url: 'https://x/y', body: '{}', timeoutMs: 1 });
    expect(result).toEqual({ ok: true, value: { status: 200, text: '{"status_code":0}' } });
    expect(sent).toMatchObject({ method: 'POST', url: 'https://x/y', withCredentials: true });
  });

  it('never throws', async () => {
    vi.stubGlobal('XMLHttpRequest', function () {
      throw new Error('boom');
    });
    const result = await pageSendJson({ url: 'https://x/y', body: '{}', timeoutMs: 1 });
    expect(result.ok).toBe(false);
  });
});

describe('douyin adapter', () => {
  it('is logged out without a session cookie', async () => {
    stubCookies({});
    expect(await douyin.checkAuth(ctx)).toEqual({ loggedIn: false });
  });

  it('is logged in with a cookie, using the nickname when available', async () => {
    stubCookies({ sessionid_ss: 's' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status_code: 0, user: { nickname: '小明' } })),
    );
    expect(await douyin.checkAuth(ctx)).toEqual({ loggedIn: true, username: '小明' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    expect(await douyin.checkAuth(ctx)).toEqual({ loggedIn: true });
  });

  it('saves the draft from inside the creator page', async () => {
    stubCookies({ sessionid: 's' });
    runInPage.mockResolvedValue({
      status: 200,
      text: JSON.stringify({ status_code: 0, data: { draft_id: '777' } }),
    });
    const result = await douyin.createDraft(post, ctx);
    expect(result).toEqual({ id: '777', draftUrl: DRAFTS_PAGE_URL });

    const [target, func, [req], signal] = runInPage.mock.calls[0] as [
      { url: string; match: string },
      unknown,
      [{ url: string; body: string }],
      AbortSignal,
    ];
    expect(target.match).toBe('https://creator.douyin.com/*');
    expect(func).toBe(pageSendJson);
    expect(req.url).toBe(`https://creator.douyin.com${SAVE_DRAFT_PATH}?aid=1128`);
    expect(JSON.parse(req.body).item.common.draft.title).toBe('标题');
    expect(signal).toBe(ctx.signal);
  });

  it('falls back to the creation id when the API returns no id', async () => {
    stubCookies({ sessionid: 's' });
    runInPage.mockResolvedValue({ status: 200, text: JSON.stringify({ status_code: 0 }) });
    const result = await douyin.createDraft(post, ctx);
    expect(result.id).toMatch(/^[a-z0-9]{8}\d{13}$/);
  });

  it('refuses to save when not logged in', async () => {
    stubCookies({});
    await expect(douyin.createDraft(post, ctx)).rejects.toThrow(/未登录/);
    expect(runInPage).not.toHaveBeenCalled();
  });

  it('does not upload images', async () => {
    await expect(douyin.uploadImage(new Blob(), ctx)).rejects.toThrow('抖音长文暂不支持图片上传');
  });
});
