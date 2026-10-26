import { getCookie, HttpError, request } from '../../lib/http';

// All endpoint/field details below are best guesses about the community's web APIs and are kept
// here so they can be corrected after capturing the editor's real traffic.
export const ORIGIN = 'https://developer.aliyun.com';
export const EDITOR_URL = `${ORIGIN}/article/new`;
export const USER_URL = `${ORIGIN}/developer/api/my/user/getUser`;
export const SAVE_DRAFT_URL = `${ORIGIN}/developer/api/article/saveDraft`;
/** Editor page that reopens an existing draft. */
export const draftEditorUrl = (id: string) => `${EDITOR_URL}?id=${encodeURIComponent(id)}`;
/** Cookie holding the CSRF token, and how it is echoed back on write requests. */
export const CSRF_COOKIE = 'c_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_PARAM = '_csrf';

/** Common envelope: `{ success, code, message, data }`; some endpoints omit `success`. */
export interface AliyunResponse<T> {
  success?: boolean;
  code?: string | number;
  message?: string;
  msg?: string;
  data?: T;
}

export class AliyunError extends Error {
  constructor(
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'AliyunError';
  }
}

const OK_CODES = new Set(['200', '0', 'SUCCESS', 'success']);

function isSuccess(json: AliyunResponse<unknown>): boolean {
  if (typeof json.success === 'boolean') return json.success;
  if (json.code === undefined) return json.data !== undefined;
  return OK_CODES.has(String(json.code));
}

function platformMessage(json: AliyunResponse<unknown>): string {
  return json.message || json.msg || (json.code !== undefined ? `code ${json.code}` : '未知错误');
}

function httpErrorMessage(error: HttpError): string {
  try {
    const parsed = JSON.parse(error.body) as AliyunResponse<unknown>;
    const message = parsed.message || parsed.msg;
    if (message) return `${message}（HTTP ${error.status}）`;
  } catch {
    // Not JSON; fall through to the generic message.
  }
  return `HTTP ${error.status}`;
}

/** Calls a developer.aliyun.com API, unwraps `data` and throws readable Chinese errors. */
export async function callApi<T>(url: string, init: RequestInit, action: string): Promise<T> {
  let text: string;
  try {
    text = await (await request(url, init)).text();
  } catch (error) {
    if (error instanceof HttpError)
      throw new Error(`阿里云开发者社区${action}失败：${httpErrorMessage(error)}`, {
        cause: error,
      });
    throw error;
  }
  let json: AliyunResponse<T>;
  try {
    json = JSON.parse(text) as AliyunResponse<T>;
  } catch {
    // Login redirects and WAF pages come back as HTML.
    throw new AliyunError(
      undefined,
      `阿里云开发者社区${action}失败：返回内容不是 JSON，可能未登录`,
    );
  }
  if (!isSuccess(json)) {
    const code = json.code === undefined ? undefined : String(json.code);
    throw new AliyunError(code, `阿里云开发者社区${action}失败：${platformMessage(json)}`);
  }
  return json.data as T;
}

export async function csrfToken(): Promise<string> {
  const token = await getCookie(ORIGIN, CSRF_COOKIE);
  if (!token)
    throw new Error(
      `未找到阿里云开发者社区的 ${CSRF_COOKIE} Cookie，请先在浏览器中打开一次 developer.aliyun.com 并登录后重试`,
    );
  return token;
}
