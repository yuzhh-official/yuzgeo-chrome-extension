import type { AuthState } from '@yuzgeo/core';
import type { PageResult } from '../../lib/page-context';

export const ORIGIN = 'https://mp.toutiao.com';
export const HOME_URL = `${ORIGIN}/profile_v4/index`;
// This is the observed editor page, not a request to publish an article.
export const EDITOR_URL = `${ORIGIN}/profile_v4/graphic/publish`;
export const DRAFTS_URL = `${ORIGIN}/profile_v4/manage/draft`;

/** MAIN-world read-only account check; do not treat the public app shell as a login. */
export async function readAccount(timeoutMs: number): Promise<PageResult<AuthState>> {
  if (location.origin !== 'https://mp.toutiao.com')
    return { ok: false, error: '头条号页面来源不正确' };
  const deadline = Date.now() + timeoutMs;
  do {
    const account = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find((a) => {
      const url = new URL(a.href, location.href);
      return (
        url.hostname === 'www.toutiao.com' &&
        /^\/c\/user\/\d+\/?$/.test(url.pathname) &&
        (a.getAttribute('aria-label') || a.getAttribute('title') || a.textContent || '').includes(
          '的个人主页',
        )
      );
    });
    if (account) {
      const label =
        account.getAttribute('aria-label') ||
        account.getAttribute('title') ||
        account.textContent ||
        '';
      return {
        ok: true,
        value: { loggedIn: true, username: label.replace(/的个人主页$/, '').trim() },
      };
    }
    if (/登录头条号|验证码登录|扫码登录/.test(document.body.innerText))
      return { ok: true, value: { loggedIn: false } };
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  return { ok: false, error: '未能确认头条号登录状态，请打开创作后台确认账号后重试' };
}
