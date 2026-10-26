import { getCookie, HttpError, request } from '../../lib/http';

// Every endpoint, cookie and field name below is a best guess about the creator center's web
// app, kept in one place so it can be corrected after capturing its real traffic.
export const ORIGIN = 'https://creator.xiaohongshu.com';
/** Long-article ("写长文") editor in the creator center. */
export const ARTICLE_EDITOR_URL = `${ORIGIN}/publish/publish?from=menu&target=article`;
/** Creator-center account info; answers `{ success, code, msg, data: { userName, … } }`. */
export const USER_INFO_URL = `${ORIGIN}/api/galaxy/user/info`;
/** Session cookies set by the creator-center login; any one of them means "maybe logged in". */
export const SESSION_COOKIES = [
  'access-token-creator.xiaohongshu.com',
  'galaxy_creator_session_id',
  'customer-sso-sid',
];
/** Envelope codes that mean the session is missing or expired. */
const LOGGED_OUT_CODES = new Set([-100, -101, 401]);

export interface XhsResponse<T> {
  success?: boolean;
  code?: number | string;
  msg?: string;
  message?: string;
  data?: T;
}

export interface XhsUserInfo {
  userName?: string;
  nickname?: string;
  nickName?: string;
  name?: string;
  redId?: string;
  userId?: string;
}

/** What the user-info endpoint told us: logged in (maybe with a name), logged out, or unknown. */
export type UserInfoOutcome =
  { kind: 'user'; username?: string } | { kind: 'loggedOut' } | { kind: 'unknown' };

export async function hasSessionCookie(): Promise<boolean> {
  for (const name of SESSION_COOKIES) {
    if (await getCookie(ORIGIN, name)) return true;
  }
  return false;
}

export function pickUsername(user: XhsUserInfo | null | undefined): string | undefined {
  if (!user || typeof user !== 'object') return undefined;
  return user.userName || user.nickname || user.nickName || user.name || user.redId || undefined;
}

/** Classifies a user-info response body; pure so it can be unit tested. */
export function parseUserInfo(text: string): UserInfoOutcome {
  let json: XhsResponse<XhsUserInfo>;
  try {
    json = JSON.parse(text) as XhsResponse<XhsUserInfo>;
  } catch {
    // Login redirects and anti-bot pages come back as HTML; not conclusive either way.
    return { kind: 'unknown' };
  }
  if (!json || typeof json !== 'object') return { kind: 'unknown' };
  const code = Number(json.code);
  if (LOGGED_OUT_CODES.has(code)) return { kind: 'loggedOut' };
  const ok = json.success === true || (json.success === undefined && code === 0);
  if (ok && json.data && typeof json.data === 'object')
    return { kind: 'user', username: pickUsername(json.data) };
  const message = json.msg || json.message || '';
  if (/登录/.test(message)) return { kind: 'loggedOut' };
  return { kind: 'unknown' };
}

/**
 * Asks the creator center who is logged in. Network errors propagate; anything else that does
 * not clearly answer the question (signature checks, odd bodies) is reported as `unknown`.
 */
export async function fetchUserInfo(signal: AbortSignal): Promise<UserInfoOutcome> {
  try {
    const response = await request(USER_INFO_URL, {
      headers: { accept: 'application/json, text/plain, */*' },
      signal,
    });
    return parseUserInfo(await response.text());
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401) return { kind: 'loggedOut' };
      const parsed = parseUserInfo(error.body);
      return parsed.kind === 'loggedOut' ? parsed : { kind: 'unknown' };
    }
    throw error;
  }
}

/** The creator center rejects long articles beyond this many characters of text. */
export const MAX_ARTICLE_LENGTH = 10_000;
/** How long to wait for the editor to load and accept the content. */
export const EDITOR_TIMEOUT_MS = 30_000;

/** Readable text of a markdown body, for the paste's plain-text part and the length check. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Length as the platform counts it: visible characters, whitespace excluded. */
export function textLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}
