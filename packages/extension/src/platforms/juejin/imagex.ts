import { request, requestJson } from '../../lib/http';
import { apiUrl, callApi } from './api';
import type { Aws4Credentials } from './aws4';
import { signAws4 } from './aws4';
import { crc32Hex } from './crc32';

const IMAGEX_HOST = 'https://imagex.bytedanceapi.com/';
const IMAGEX_VERSION = '2018-08-01';
const IMAGEX_REGION = 'cn-north-1';
const IMAGEX_SIGN_SERVICE = 'imagex';
/** Juejin's ImageX service; used when gen_token doesn't report one. Unverified, see report. */
export const JUEJIN_IMAGEX_SERVICE_ID = '73owjymdk6';

export interface ImagexToken extends Aws4Credentials {
  serviceId: string;
}

type Loose = Record<string, unknown>;

function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const value = (obj as Loose)[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** gen_token's shape has varied (`data.token.*`, flat `data.*`, snake_case); accept all of them. */
export function parseToken(data: unknown): ImagexToken {
  const token = pick(data, 'token', 'Token', 'credentials') ?? data;
  const accessKeyId = str(
    pick(token, 'AccessKeyId', 'AccessKeyID', 'access_key_id', 'accessKeyId'),
  );
  const secretAccessKey = str(
    pick(token, 'SecretAccessKey', 'secret_access_key', 'secretAccessKey'),
  );
  const sessionToken = str(pick(token, 'SessionToken', 'session_token', 'sessionToken'));
  if (!accessKeyId || !secretAccessKey || !sessionToken)
    throw new Error('掘金图片上传凭证格式无法识别');
  const serviceId =
    str(pick(token, 'ServiceId', 'service_id', 'serviceId')) ??
    str(pick(data, 'ServiceId', 'service_id', 'serviceId')) ??
    JUEJIN_IMAGEX_SERVICE_ID;
  return { accessKeyId, secretAccessKey, sessionToken, serviceId };
}

export async function genToken(signal: AbortSignal): Promise<ImagexToken> {
  const data = await callApi<unknown>(
    apiUrl('/imagex/v2/gen_token', { client: 'web' }),
    { signal },
    '获取图片上传凭证',
  );
  return parseToken(data);
}

interface ImagexResponse<T> {
  ResponseMetadata?: { Error?: { Code?: string; Message?: string } };
  Result?: T;
}

async function imagexCall<T>(
  token: ImagexToken,
  method: 'GET' | 'POST',
  params: Record<string, string>,
  body: string | undefined,
  signal: AbortSignal,
): Promise<T> {
  const url = new URL(IMAGEX_HOST);
  url.search = new URLSearchParams({
    Version: IMAGEX_VERSION,
    ServiceId: token.serviceId,
    ...params,
  }).toString();
  const headers = await signAws4({
    method,
    url: url.toString(),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body,
    region: IMAGEX_REGION,
    service: IMAGEX_SIGN_SERVICE,
    credentials: token,
  });
  // ImageX authenticates with the STS signature only; sending juejin cookies would be pointless.
  const json = await requestJson<ImagexResponse<T>>(url.toString(), {
    method,
    headers,
    body,
    signal,
    credentials: 'omit',
  });
  const error = json.ResponseMetadata?.Error;
  if (error?.Code || !json.Result) {
    throw new Error(
      `掘金图片上传失败（${params.Action}）：${error?.Message ?? error?.Code ?? '无返回结果'}`,
    );
  }
  return json.Result;
}

export interface UploadTarget {
  host: string;
  storeUri: string;
  auth: string;
  sessionKey: string;
}

/** ApplyImageUpload returns `UploadAddress` (classic) and sometimes `InnerUploadAddress.UploadNodes`. */
export function parseApply(result: unknown): UploadTarget {
  const address = pick(result, 'UploadAddress');
  const store = (pick(address, 'StoreInfos') as unknown[] | undefined)?.[0];
  const host = str((pick(address, 'UploadHosts') as unknown[] | undefined)?.[0]);
  const sessionKey = str(pick(address, 'SessionKey'));
  const storeUri = str(pick(store, 'StoreUri'));
  const auth = str(pick(store, 'Auth'));
  if (host && sessionKey && storeUri && auth) return { host, storeUri, auth, sessionKey };

  const node = (
    pick(pick(result, 'InnerUploadAddress'), 'UploadNodes') as unknown[] | undefined
  )?.[0];
  const nodeStore = (pick(node, 'StoreInfos') as unknown[] | undefined)?.[0];
  const fallback = {
    host: str(pick(node, 'UploadHost')),
    sessionKey: str(pick(node, 'SessionKey')),
    storeUri: str(pick(nodeStore, 'StoreUri')),
    auth: str(pick(nodeStore, 'Auth')),
  };
  if (fallback.host && fallback.sessionKey && fallback.storeUri && fallback.auth)
    return fallback as UploadTarget;
  throw new Error('掘金图片上传地址格式无法识别');
}

/** Pulls the stored image URI out of CommitImageUpload's result. */
export function parseCommit(result: unknown, fallbackUri: string): string {
  const first = (pick(result, 'Results') as unknown[] | undefined)?.[0];
  const plugin = (pick(result, 'PluginResult') as unknown[] | undefined)?.[0];
  return str(pick(first, 'Uri')) ?? str(pick(plugin, 'ImageUri')) ?? fallbackUri;
}

/** get_img_url resolves a stored URI to a public CDN URL on *.byteimg.com. */
export async function getImageUrl(uri: string, signal: AbortSignal): Promise<string> {
  const data = await callApi<unknown>(
    apiUrl('/imagex/v2/get_img_url', { uri }),
    { signal },
    '获取图片地址',
  );
  const url =
    str(pick(data, 'main_url', 'MainUrl', 'url')) ??
    str((pick(data, 'url_list') as unknown[] | undefined)?.[0]);
  if (!url) throw new Error('掘金图片地址格式无法识别');
  return url;
}

export async function uploadToImagex(image: Blob, signal: AbortSignal): Promise<string> {
  const token = await genToken(signal);
  const target = parseApply(
    await imagexCall<unknown>(token, 'GET', { Action: 'ApplyImageUpload' }, undefined, signal),
  );

  const bytes = new Uint8Array(await image.arrayBuffer());
  await request(`https://${target.host}/${target.storeUri}`, {
    method: 'PUT',
    headers: {
      Authorization: target.auth,
      'Content-CRC32': crc32Hex(bytes),
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
    signal,
    credentials: 'omit',
  });

  const commit = await imagexCall<unknown>(
    token,
    'POST',
    { Action: 'CommitImageUpload', SessionKey: target.sessionKey },
    JSON.stringify({ SessionKey: target.sessionKey }),
    signal,
  );
  return getImageUrl(parseCommit(commit, target.storeUri), signal);
}
