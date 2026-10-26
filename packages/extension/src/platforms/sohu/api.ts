import type { AuthState } from '@yuzgeo/core';
import type { PageResult } from '../../lib/page-context';

export const ORIGIN = 'https://mp.sohu.com';
export const HOME_URL = `${ORIGIN}/home`;
export const EDITOR_URL = `${ORIGIN}/mpfe/v4/contentManagement/news/addarticle`;
export const DRAFTS_URL = `${ORIGIN}/mpfe/v4/contentManagement/first/page?newsType=1`;
export const USER_PATH = '/mpbp/bp/account/info';

/** No unverified write API: only the new-article editor and read-only account endpoint. */
export function assertDraftOnlyPath(value: string): void {
  const url = new URL(value, ORIGIN);
  if (
    url.origin !== ORIGIN ||
    ![new URL(EDITOR_URL).pathname, USER_PATH].includes(url.pathname) ||
    (url.pathname === new URL(EDITOR_URL).pathname && (url.search || url.hash))
  )
    throw new Error('搜狐号：拒绝访问未允许的草稿操作路径');
}

/** MAIN world: validate the site's selected account against the real account API. */
export async function readAccount(timeoutMs: number): Promise<PageResult<AuthState>> {
  try {
    if (location.origin !== 'https://mp.sohu.com' || /\/login|\/register/.test(location.pathname))
      return { ok: true, value: { loggedIn: false } };
    const deadline = Date.now() + timeoutMs;
    let accountId: string | undefined;
    let client: string | null = null;
    let device: string | null = null;
    while (Date.now() < deadline) {
      try {
        const current = JSON.parse(localStorage.getItem('currentAccount') ?? 'null') as {
          id?: unknown;
        } | null;
        if (
          (typeof current?.id === 'number' || typeof current?.id === 'string') &&
          /^\d+$/.test(String(current.id))
        ) {
          accountId = String(current.id);
          // Use the platform's existing client identifiers, never generate a replacement.
          // These remain inside this page and are sent only to its own account API.
          client = localStorage.getItem('preview-sp-cm');
          device = sessionStorage.getItem('dv-id') || localStorage.getItem('preview-dv-id');
          if (client && device) break;
        }
      } catch {
        /* An incomplete site cache is not authentication evidence. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!accountId) return { ok: true, value: { loggedIn: false } };
    if (!client || !device)
      return { ok: false, error: '搜狐号客户端尚未初始化，请打开创作中心后刷新登录状态' };
    const response = await fetch(
      `/mpbp/bp/account/info?accountId=${encodeURIComponent(accountId)}`,
      {
        credentials: 'include',
        headers: { 'sp-cm': client, 'dv-id': device },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      },
    );
    if ([401, 403].includes(response.status)) return { ok: true, value: { loggedIn: false } };
    if (!response.ok) return { ok: false, error: `搜狐号登录检查失败：HTTP ${response.status}` };
    const json = (await response.json()) as {
      code?: number;
      success?: boolean;
      msg?: string;
      data?: { id?: string | number; nickName?: string };
    };
    if (
      json.code === 2000000 &&
      json.success === true &&
      String(json.data?.id) === accountId &&
      json.data?.nickName
    )
      return { ok: true, value: { loggedIn: true, username: json.data.nickName } };
    if (/未登录|登录失效|请.*登录/.test(json.msg ?? ''))
      return { ok: true, value: { loggedIn: false } };
    return { ok: false, error: `搜狐号登录检查失败：${json.msg || '账号响应不完整'}` };
  } catch {
    return { ok: false, error: '搜狐号登录检查失败，请检查网络并重新打开创作中心' };
  }
}
