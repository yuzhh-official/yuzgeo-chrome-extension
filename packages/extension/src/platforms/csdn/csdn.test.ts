import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractSigningMaterial,
  findBundleUrls,
  getSigningMaterial,
  setSigningMaterialSource,
} from './credentials';
import { csdn } from './index';

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };
// Dummy values for tests only.
const FAKE = { appKey: '1234567', appSecret: 'abcdefghijklmnop1234' };
const SAVE_URL = 'https://bizapi.csdn.net/blog-console-api/v1/postedit/saveArticle';

const post: RenderedPost = {
  title: '标题',
  summary: '摘要',
  tags: ['Vue', 'TypeScript'],
  body: '# hi\n\n**bold**',
  markdown: '# hi\n\n**bold**',
  extra: {},
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function stubCookies(values: Record<string, string>) {
  vi.stubGlobal('browser', {
    cookies: {
      get: vi.fn(async ({ name }: { name: string }) =>
        name in values ? { name, value: values[name] } : null,
      ),
    },
  });
}

beforeEach(() => setSigningMaterialSource(async () => FAKE));
afterEach(() => {
  vi.unstubAllGlobals();
  setSigningMaterialSource();
});

describe('signing material extraction', () => {
  it('finds CSDN-hosted bundle urls only', () => {
    const html =
      '<script src="https://g.csdnimg.cn/a.js"></script>' +
      '<script defer src="/mp_blog/static/app.js"></script>' +
      '<script src="https://evil.example/x.js"></script>';
    expect(findBundleUrls(html, 'https://mp.csdn.net/mp_blog/creation/editor')).toEqual([
      'https://g.csdnimg.cn/a.js',
      'https://mp.csdn.net/mp_blog/static/app.js',
    ]);
  });

  it('extracts a key/secret pair from bundle code', () => {
    const code = `var c={appKey:"${FAKE.appKey}",appSecret:"${FAKE.appSecret}"};`;
    expect(extractSigningMaterial(code)).toEqual(FAKE);
    expect(extractSigningMaterial(`appKey:"${FAKE.appKey}"`)).toBeUndefined();
  });

  it('fetches the editor page and scans its bundles', async () => {
    setSigningMaterialSource();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://mp.csdn.net/mp_blog/creation/editor'))
        return new Response(
          '<script src="https://g.csdnimg.cn/vendor.js"></script><script src="/app.js"></script>',
        );
      if (url === 'https://mp.csdn.net/app.js')
        return new Response(`x={"appKey":"${FAKE.appKey}","appSecret":"${FAKE.appSecret}"}`);
      return new Response('function vendor(){}');
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await getSigningMaterial(ctx.signal)).toEqual(FAKE);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://mp.csdn.net/mp_blog/creation/editor',
      'https://mp.csdn.net/app.js',
    ]);
  });

  it('fails with a readable error when nothing matches', async () => {
    setSigningMaterialSource();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<script src="/app.js"></script>')),
    );
    await expect(getSigningMaterial(ctx.signal)).rejects.toThrow(/未能从 CSDN 编辑器页面/);
  });
});

describe('csdn adapter', () => {
  it('checkAuth reads the UserName cookie', async () => {
    stubCookies({ UserName: 'zoy%5Fluo' });
    expect(await csdn.checkAuth(ctx)).toEqual({ loggedIn: true, username: 'zoy_luo' });
    stubCookies({});
    expect(await csdn.checkAuth(ctx)).toEqual({ loggedIn: false });
  });

  it('uploadImage is not supported', async () => {
    await expect(csdn.uploadImage(new Blob(), ctx)).rejects.toThrow('CSDN 暂不支持图片上传');
  });

  it('saves a signed markdown draft', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ code: 200, msg: 'success', data: { id: 123456789, url: 'x' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await csdn.createDraft(post, ctx);
    expect(result).toEqual({
      id: '123456789',
      draftUrl: 'https://mp.csdn.net/mp_blog/creation/editor/123456789',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SAVE_URL);
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(ctx.signal);
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-ca-key']).toBe(FAKE.appKey);
    expect(headers['x-ca-signature-headers']).toBe('x-ca-key,x-ca-nonce');
    expect(headers['x-ca-signature']).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      title: '标题',
      description: '摘要',
      markdowncontent: post.body,
      tags: 'Vue,TypeScript',
      status: 2,
      type: 'original',
      read_type: 'public',
      source: 'pc_mdeditor',
    });
    expect(body.content).toContain('<strong>bold</strong>');
  });

  it('surfaces CSDN msg on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 400, msg: '标题不能为空', data: null })),
    );
    await expect(csdn.createDraft(post, ctx)).rejects.toThrow('CSDN 保存草稿失败：标题不能为空');
  });

  it('retries once with fresh signing material after a gateway rejection', async () => {
    const source = vi.fn(async () => FAKE);
    setSigningMaterialSource(source);
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ++calls === 1
          ? new Response('', {
              status: 400,
              headers: { 'x-ca-error-message': 'Invalid Signature' },
            })
          : json({ code: 200, data: { id: 1 } }),
      ),
    );
    expect((await csdn.createDraft(post, ctx)).id).toBe('1');
    expect(source).toHaveBeenCalledTimes(2);
  });

  it('reports a persistent signature rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('', { status: 400, headers: { 'x-ca-error-message': 'Invalid Signature' } }),
      ),
    );
    await expect(csdn.createDraft(post, ctx)).rejects.toThrow(
      /接口签名被拒绝（Invalid Signature）/,
    );
  });
});
