import type { RenderedPost } from '@yuzgeo/core';

export const ORIGIN = 'https://mp.weixin.qq.com';
// No session token in the returned URL: draft results are persisted in local history.
export const DRAFTS_URL = `${ORIGIN}/`;

/** Public protocol reference, not yet verified against a real account. Never execute page JS. */
export function readSession(html: string): { token: string; username: string } | undefined {
  const token = /\bdata\s*:\s*\{[^}]*?\bt\s*:\s*["'](\d+)["']/.exec(html)?.[1];
  const user = /\buser_name\s*:\s*["']([^"'\r\n]+)["']/.exec(html)?.[1];
  const nick = /\bnick_name\s*:\s*["']([^"'\r\n]+)["']/.exec(html)?.[1];
  if (!token || !user) return undefined;
  return { token, username: nick || user };
}

export function saveUrl(token: string): string {
  if (!/^\d+$/.test(token)) throw new Error('公众号登录令牌无效，请重新登录');
  return `${ORIGIN}/cgi-bin/operate_appmsg?${new URLSearchParams({ t: 'ajax-response', sub: 'create', type: '77', token, lang: 'zh_CN' })}`;
}

export function assertDraftRequest(url: string, body: URLSearchParams): void {
  const target = new URL(url);
  const expected = new URL(saveUrl(body.get('token') ?? ''));
  if (
    target.origin !== ORIGIN ||
    target.pathname !== expected.pathname ||
    target.hash ||
    target.username ||
    target.password ||
    target.searchParams.size !== expected.searchParams.size ||
    [...target.searchParams].some(([k, v]) => expected.searchParams.get(k) !== v) ||
    body.get('AppMsgId') !== '' ||
    body.get('count') !== '1' ||
    [...body.keys()].some((key) => !DRAFT_FIELDS.has(key))
  )
    throw new Error('公众号：拒绝非新建草稿请求');
}

const DRAFT_FIELDS = new Set([
  'token',
  'lang',
  'f',
  'ajax',
  'AppMsgId',
  'count',
  'data_seq',
  'operate_from',
  'title0',
  'content0',
  'digest0',
  'auto_gen_digest0',
  'author0',
  'fileid0',
  'cdn_url0',
  'show_cover_pic0',
  'copyright_type0',
]);

export function buildDraftBody(post: RenderedPost, token: string): URLSearchParams {
  if (!post.title.trim() || [...post.title].length > 64)
    throw new Error('公众号标题需为 1–64 个字符');
  if (!post.body.trim()) throw new Error('公众号正文不能为空');
  // Links unsupported by WeChat become readable text. No image/cover upload or original claim.
  const content = post.body.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
  return new URLSearchParams({
    token,
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
    AppMsgId: '',
    count: '1',
    data_seq: '0',
    operate_from: 'Chrome',
    title0: post.title,
    content0: content,
    digest0: [...(post.summary ?? '')].slice(0, 120).join(''),
    auto_gen_digest0: post.summary ? '0' : '1',
    author0: '',
    fileid0: '',
    cdn_url0: '',
    show_cover_pic0: '0',
    copyright_type0: '0',
  });
}

export function parseDraftId(value: unknown): string {
  const result = value as { appMsgId?: unknown; ret?: number; base_resp?: { ret?: number } } | null;
  const code = result?.base_resp?.ret ?? result?.ret;
  if (code !== undefined && code !== 0) {
    const hint =
      code === 200003
        ? '登录已过期，请重新登录'
        : [-6, -8].includes(code)
          ? '请在公众号后台完成验证'
          : '请在公众号后台检查账号权限、正文与封面要求';
    throw new Error(`公众号保存草稿失败（${code}）：${hint}`);
  }
  const id = result?.appMsgId;
  if (
    (typeof id !== 'string' && typeof id !== 'number') ||
    (typeof id === 'number' && !Number.isSafeInteger(id)) ||
    !/^[1-9]\d*$/.test(String(id))
  )
    throw new Error('公众号未返回有效草稿 ID，请先到草稿箱确认，避免重复创建');
  return String(id);
}
