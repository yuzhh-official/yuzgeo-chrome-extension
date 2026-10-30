import { runInPage } from '../../lib/page-context';
import { EDITOR_PAGE_URL, getSigningMaterial, invalidateSigningMaterial } from './credentials';
import { requestInCsdn } from './page-request';
import { signCaRequest } from './sign';

export const BIZAPI = 'https://bizapi.csdn.net';
/** Sent and signed verbatim; the gateway compares the signed value with the received header. */
export const ACCEPT = 'application/json, text/plain, */*';
export const JSON_CONTENT_TYPE = 'application/json;';

/** bizapi responses look like `{ code: 200, msg: 'success', data: … }`. */
export interface CsdnResponse<T> {
  code: number;
  msg?: string;
  message?: string;
  data: T;
}

const CODE_OK = 200;

export class CsdnError extends Error {
  constructor(
    readonly code: number | string,
    message: string,
  ) {
    super(message);
    this.name = 'CsdnError';
  }
}

function newNonce(): string {
  return crypto.randomUUID();
}

function describeBody(text: string): string | undefined {
  try {
    const json = JSON.parse(text) as { msg?: string; message?: string };
    return json.msg || json.message || undefined;
  } catch {
    return text.trim().slice(0, 200) || undefined;
  }
}

async function send(
  url: string,
  method: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const material = await getSigningMaterial(signal);
  const contentType = body === undefined ? undefined : JSON_CONTENT_TYPE;
  const signed = await signCaRequest(
    { method, url, accept: ACCEPT, contentType, nonce: newNonce() },
    material,
  );
  const result = await runInPage(
    { url: EDITOR_PAGE_URL, match: 'https://mp.csdn.net/*' },
    requestInCsdn,
    [
      {
        url,
        method,
        headers: {
          accept: ACCEPT,
          ...(contentType ? { 'content-type': contentType } : {}),
          ...signed,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ],
    signal,
  );
  return new Response(result.text, {
    status: result.status,
    headers: result.gatewayError ? { 'x-ca-error-message': result.gatewayError } : {},
  });
}

/**
 * Calls a signed bizapi endpoint and unwraps `data`. A gateway rejection (it reports the reason
 * in `x-ca-error-message`) drops the cached signing material and retries once with fresh values.
 */
export async function callBizapi<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  action: string,
): Promise<T> {
  const url = new URL(path, BIZAPI).toString();
  const method = body === undefined ? 'GET' : 'POST';
  let response = await send(url, method, body, signal);
  if (response.headers.get('x-ca-error-message')) {
    invalidateSigningMaterial();
    response = await send(url, method, body, signal);
  }

  const text = await response.text().catch(() => '');
  const gatewayError = response.headers.get('x-ca-error-message');
  if (gatewayError) {
    invalidateSigningMaterial();
    throw new CsdnError(response.status, `CSDN ${action}失败：接口签名被拒绝（${gatewayError}）`);
  }
  if (!response.ok) {
    const detail = describeBody(text);
    throw new CsdnError(
      response.status,
      `CSDN ${action}失败：HTTP ${response.status}${detail ? `，${detail}` : ''}`,
    );
  }

  let json: CsdnResponse<T>;
  try {
    json = JSON.parse(text) as CsdnResponse<T>;
  } catch {
    throw new CsdnError(response.status, `CSDN ${action}失败：返回内容无法解析`);
  }
  if (json.code !== CODE_OK) {
    throw new CsdnError(
      json.code,
      `CSDN ${action}失败：${json.msg || json.message || `code ${json.code}`}`,
    );
  }
  return json.data;
}
