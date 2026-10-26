export interface Aws4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface Aws4Request {
  method: string;
  url: string;
  /** Headers to sign; `host` is only signed when given here. */
  headers?: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  credentials: Aws4Credentials;
  date?: Date;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

/** RFC 3986 encoding; encodeURIComponent leaves !'()* alone, which SigV4 rejects. */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Signs a request with AWS Signature V4 and returns the headers to send: the given ones plus
 * X-Amz-Date, X-Amz-Security-Token (for STS credentials) and Authorization.
 */
export async function signAws4(req: Aws4Request): Promise<Record<string, string>> {
  const url = new URL(req.url);
  const timestamp = amzDate(req.date ?? new Date());
  const day = timestamp.slice(0, 8);

  const headers: Record<string, string> = { ...req.headers, 'X-Amz-Date': timestamp };
  if (req.credentials.sessionToken) headers['X-Amz-Security-Token'] = req.credentials.sessionToken;

  const canonical = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const signedHeaders = canonical.map(([k]) => k).join(';');

  const canonicalRequest = [
    req.method.toUpperCase(),
    url.pathname || '/',
    canonicalQuery(url.searchParams),
    canonical.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders,
    await sha256Hex(req.body ?? ''),
  ].join('\n');

  const scope = `${day}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  let key = await hmac(encoder.encode(`AWS4${req.credentials.secretAccessKey}`), day);
  for (const part of [req.region, req.service, 'aws4_request']) key = await hmac(key, part);
  const signature = toHex(await hmac(key, stringToSign));

  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${req.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
