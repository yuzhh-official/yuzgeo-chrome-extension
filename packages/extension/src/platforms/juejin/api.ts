import { request } from '../../lib/http';

export const API_BASE = 'https://api.juejin.cn';
/** Juejin's web app id; most api.juejin.cn endpoints reject requests without it. */
export const AID = '2608';

export interface JuejinResponse<T> {
  err_no: number;
  err_msg?: string;
  data: T;
}

export class JuejinError extends Error {
  constructor(
    readonly errNo: number,
    message: string,
  ) {
    super(message);
    this.name = 'JuejinError';
  }
}

/** Juejin ids are 19-digit integers; quote them before JSON.parse so they keep full precision. */
export function parseJuejinJson<T>(text: string): T {
  return JSON.parse(text.replace(/("[\w]*id"\s*:\s*)(\d{16,})/g, '$1"$2"')) as T;
}

export function apiUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, API_BASE);
  url.searchParams.set('aid', AID);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** Calls an api.juejin.cn endpoint and unwraps `data`, throwing a JuejinError when err_no != 0. */
export async function callApi<T>(url: string, init: RequestInit, action: string): Promise<T> {
  const response = await request(url, init);
  const json = parseJuejinJson<JuejinResponse<T>>(await response.text());
  if (json.err_no !== 0) {
    throw new JuejinError(
      json.err_no,
      `掘金${action}失败：${json.err_msg || `err_no ${json.err_no}`}`,
    );
  }
  return json.data;
}
