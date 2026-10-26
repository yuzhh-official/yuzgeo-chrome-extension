import type { AuthState, RenderedPost } from '@yuzgeo/core';

export const ORIGIN = 'https://baijiahao.baidu.com';
export const USER_URL = `${ORIGIN}/builder/app/appinfo`;
export const EDITOR_URL = `${ORIGIN}/builder/rc/edit`;
export const SAVE_DRAFT_URL = `${ORIGIN}/pcui/article/save?callback=bjhdraft`;

// Protocol facts from the handoff and public historical adapter; not live-verified.
// This is an allowlist, not a blacklist: new endpoints need deliberate review.
export function assertDraftOnlyPath(value: string): void {
  const url = new URL(value, ORIGIN);
  if (
    url.origin !== ORIGIN ||
    url.hash !== '' ||
    url.pathname !== '/pcui/article/save' ||
    [...url.searchParams].some(([key, val]) => key !== 'callback' || val !== 'bjhdraft')
  ) {
    throw new Error('百家号：拒绝调用非草稿保存接口');
  }
}

interface Envelope {
  errno?: number | string;
  errmsg?: string;
  data?: { user?: { userid?: string | number; name?: string } };
  ret?: { article_id?: string | number };
}

/** Accept JSON and the named JSONP envelope only. Never execute response text. */
export function parseResponse(text: string): Envelope {
  const trimmed = text.trim();
  const match = /^bjhdraft\(\s*([\s\S]*)\s*\)\s*;?$/.exec(trimmed);
  let value: unknown;
  try {
    value = JSON.parse(match?.[1] ?? trimmed);
  } catch {
    throw new Error('百家号返回内容无法识别，请确认登录状态或在平台完成验证');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('百家号返回内容格式异常');
  return value as Envelope;
}

function succeeded(response: Envelope): boolean {
  return (
    response.errmsg === 'success' &&
    (response.errno === undefined || String(response.errno) === '0')
  );
}

export function parseAuth(text: string): AuthState {
  const result = parseResponse(text);
  if (
    /未登录|登录失效|请.*登录|not.?login/i.test(result.errmsg ?? '') ||
    ['401', '403'].includes(String(result.errno))
  )
    return { loggedIn: false };
  if (!succeeded(result)) throw new Error(`百家号登录检查失败：${result.errmsg || '未知响应'}`);
  const user = result.data?.user;
  if (!user?.userid || !user.name) return { loggedIn: false };
  return { loggedIn: true, username: user.name };
}

/** Read a quoted JS string as data; never eval the creator page. */
export function extractEditorToken(html: string): string {
  const match = /(?:window\.)?__BJH__INIT__AUTH__\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/.exec(
    html,
  );
  if (!match) throw new Error('未找到百家号编辑器令牌，请登录百家号并打开图文编辑器后重试');
  let token: string;
  if (match[1]!.startsWith('"')) {
    try {
      token = JSON.parse(match[1]!) as string;
    } catch {
      throw new Error('百家号编辑器令牌格式异常');
    }
  } else {
    token = match[1]!.slice(1, -1);
    if (token.includes('\\')) throw new Error('百家号编辑器令牌格式已变化，请更新扩展');
  }
  if (!token || /[\r\n]/.test(token)) throw new Error('百家号编辑器令牌为空或无效');
  return token;
}

export function buildDraftBody(post: RenderedPost): URLSearchParams {
  // No publication flags, advertising activity, originality claims, or cover.
  return new URLSearchParams({
    title: post.title,
    content: post.body,
    type: 'news',
    feed_cat: '1',
    len: String(post.body.length),
  });
}

export function parseDraftId(text: string): string {
  const result = parseResponse(text);
  if (!succeeded(result)) throw new Error(`百家号保存草稿失败：${result.errmsg || '未知响应'}`);
  const id = result.ret?.article_id;
  if (
    (typeof id !== 'string' && typeof id !== 'number') ||
    (typeof id === 'number' && !Number.isSafeInteger(id)) ||
    !/^\d+$/.test(String(id)) ||
    String(id) === '0'
  )
    throw new Error('百家号未返回有效草稿 ID，请先到草稿箱确认，避免重复创建');
  return String(id);
}

export function draftUrl(id: string): string {
  return `${EDITOR_URL}?type=news&article_id=${encodeURIComponent(id)}`;
}
