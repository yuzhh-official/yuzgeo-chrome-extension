export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} ${new URL(url).pathname}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'HttpError';
  }
}

/**
 * Fetches with the user's cookies for the target site. Extension requests to hosts listed in
 * host_permissions are treated as same-site, so the platform session cookies are sent.
 */
export async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { credentials: 'include', ...init });
  if (!response.ok)
    throw new HttpError(response.status, url, await response.text().catch(() => ''));
  return response;
}

export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await request(url, init);
  return (await response.json()) as T;
}

export function jsonBody(data: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  };
}

/** Reads one cookie of a platform the extension has host permission for. Never persisted or sent elsewhere. */
export async function getCookie(url: string, name: string): Promise<string | undefined> {
  const cookie = await browser.cookies.get({ url, name });
  return cookie?.value;
}
