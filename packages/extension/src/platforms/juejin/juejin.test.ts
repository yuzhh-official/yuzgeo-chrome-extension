import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJuejinJson } from './api';
import { parseApply, parseToken } from './imagex';
import { juejin } from './index';

const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('parseJuejinJson', () => {
  it('keeps 19-digit ids exact', () => {
    const parsed = parseJuejinJson<{ data: { id: string; user_id: string } }>(
      '{"data":{"id":7300000000000000001,"user_id":"123"}}',
    );
    expect(parsed.data.id).toBe('7300000000000000001');
  });
});

describe('parseToken / parseApply', () => {
  it('accepts nested and flat token shapes', () => {
    const creds = { AccessKeyId: 'ak', SecretAccessKey: 'sk', SessionToken: 'st' };
    expect(parseToken({ token: creds })).toMatchObject({
      accessKeyId: 'ak',
      serviceId: '73owjymdk6',
    });
    expect(parseToken({ ...creds, ServiceId: 'svc' }).serviceId).toBe('svc');
    expect(() => parseToken({})).toThrow();
  });

  it('falls back to InnerUploadAddress', () => {
    const target = parseApply({
      InnerUploadAddress: {
        UploadNodes: [
          {
            UploadHost: 'up.example',
            SessionKey: 'sk',
            StoreInfos: [{ StoreUri: 'a/b', Auth: 'x' }],
          },
        ],
      },
    });
    expect(target).toEqual({ host: 'up.example', sessionKey: 'sk', storeUri: 'a/b', auth: 'x' });
  });
});

describe('juejin adapter', () => {
  it('reports logged-out on err_no != 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ err_no: 403, err_msg: 'must login', data: null })),
    );
    expect(await juejin.checkAuth(ctx)).toEqual({ loggedIn: false });
  });

  it('creates a draft and resolves tags best-effort', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('query_tag_list')) throw new TypeError('network down');
      return new Response('{"err_no":0,"err_msg":"success","data":{"id":7300000000000000001}}');
    });
    vi.stubGlobal('fetch', fetchMock);
    const post: RenderedPost = {
      title: 'T',
      tags: ['Vue'],
      body: '# hi',
      markdown: '# hi',
      extra: {},
    };
    const result = await juejin.createDraft(post, ctx);
    expect(result).toEqual({
      id: '7300000000000000001',
      draftUrl: 'https://juejin.cn/editor/drafts/7300000000000000001',
    });
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string);
    expect(body).toMatchObject({
      title: 'T',
      mark_content: '# hi',
      edit_type: 10,
      category_id: '0',
      tag_ids: [],
    });
    expect(ctx.log).toHaveBeenCalled();
  });

  it('throws a readable error when draft creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ err_no: 2, err_msg: '参数错误', data: null })),
    );
    const post: RenderedPost = { title: 'T', tags: [], body: '', markdown: '', extra: {} };
    await expect(juejin.createDraft(post, ctx)).rejects.toThrow('掘金创建草稿失败：参数错误');
  });

  it('uploads an image through ImageX', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.includes('gen_token'))
          return json({
            err_no: 0,
            data: { token: { AccessKeyId: 'ak', SecretAccessKey: 'sk', SessionToken: 'st' } },
          });
        if (url.includes('Action=ApplyImageUpload'))
          return json({
            Result: {
              UploadAddress: {
                StoreInfos: [{ StoreUri: 'tos/abc', Auth: 'auth' }],
                UploadHosts: ['up.host'],
                SessionKey: 'sess',
              },
            },
          });
        if (url.startsWith('https://up.host/')) return json({ success: 0 });
        if (url.includes('Action=CommitImageUpload'))
          return json({ Result: { Results: [{ Uri: 'tos/abc' }] } });
        if (url.includes('get_img_url'))
          return json({ err_no: 0, data: { main_url: 'https://p3.byteimg.com/abc' } });
        throw new Error(`unexpected ${url}`);
      }),
    );
    const url = await juejin.uploadImage(new Blob(['123456789']), ctx);
    expect(url).toBe('https://p3.byteimg.com/abc');
    const put = calls.find((c) => c.url === 'https://up.host/tos/abc')!;
    expect(put.init.headers).toMatchObject({ Authorization: 'auth', 'Content-CRC32': 'cbf43926' });
    const apply = calls.find((c) => c.url.includes('ApplyImageUpload'))!;
    expect((apply.init.headers as Record<string, string>).Authorization).toMatch(
      /^AWS4-HMAC-SHA256 .*\/cn-north-1\/imagex\//,
    );
    expect(calls.at(-1)!.url).toContain('uri=tos%2Fabc');
  });
});
