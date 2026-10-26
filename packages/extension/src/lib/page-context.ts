// Some platforms sign API requests with scripts that only exist on their own pages. For those,
// the request has to be made from inside a tab of that platform, in the page's MAIN world.

const LOAD_TIMEOUT_MS = 30_000;

/** What a page function returns: never throw inside it, report failure as `ok: false`. */
export type PageResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PageTarget {
  /** Opened in a background tab when no matching tab is already open. */
  url: string;
  /** Match pattern for reusing an open tab, e.g. `https://creator.example.com/*`. */
  match: string;
  /**
   * Always open a fresh tab instead of reusing one, for page functions that edit page state the
   * user may be working in (e.g. a half-written post in an editor).
   */
  fresh?: boolean;
}

/**
 * Runs `func` in the MAIN world of a tab on the platform and returns its value. Reuses an open
 * matching tab (unless `target.fresh`), otherwise opens one in the background and closes it
 * afterwards. `func` is serialized, so it must be self-contained: no closures, only its
 * JSON-serializable `args`.
 */
export async function runInPage<A extends unknown[], T>(
  target: PageTarget,
  func: (...args: A) => Promise<PageResult<T>> | PageResult<T>,
  args: A,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  const [existing] = target.fresh
    ? []
    : await browser.tabs.query({ url: target.match, status: 'complete' });
  const tab = existing ?? (await browser.tabs.create({ url: target.url, active: false }));
  if (tab.id === undefined) throw new Error('无法打开平台页面');

  try {
    if (!existing) await waitForLoad(tab.id, signal);
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: func as (...args: unknown[]) => unknown,
      args,
    });
    const result = injection?.result as PageResult<T> | undefined;
    if (!result) throw new Error('平台页面没有返回结果，请确认已登录后重试');
    if (!result.ok) throw new Error(result.error);
    return result.value;
  } finally {
    if (!existing) void browser.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForLoad(tabId: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('平台页面加载超时')), LOAD_TIMEOUT_MS);
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const onAbort = () => finish(signal.reason);

    function finish(error?: unknown) {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }

    browser.tabs.onUpdated.addListener(onUpdated);
    signal.addEventListener('abort', onAbort, { once: true });
    // The tab may have finished loading before the listener was attached.
    void browser.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish();
    }, finish);
  });
}
