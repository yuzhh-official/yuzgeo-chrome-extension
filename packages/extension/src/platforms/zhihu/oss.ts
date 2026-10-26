/** Aliyun OSS header-signature (V1) for a single PUT, using WebCrypto so it runs in a service worker. */

export interface OssCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
}

export interface OssPutRequest {
  bucket: string;
  objectKey: string;
  contentType: string;
  /** RFC 1123 date, e.g. `new Date().toUTCString()`. */
  date: string;
  /** Extra `x-oss-*` headers besides x-oss-date and x-oss-security-token. */
  ossHeaders?: Record<string, string>;
}

/** All `x-oss-*` headers that go on the request and into the signature. */
export function ossHeaders(
  req: OssPutRequest,
  credentials: OssCredentials,
): Record<string, string> {
  return {
    ...req.ossHeaders,
    'x-oss-date': req.date,
    'x-oss-security-token': credentials.securityToken,
  };
}

export function ossStringToSign(req: OssPutRequest, headers: Record<string, string>): string {
  const canonicalHeaders = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase().trim(), value.trim()] as const)
    .filter(([key]) => key.startsWith('x-oss-'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
  // Browsers cannot set `Date`, so x-oss-date carries it; OSS accepts the same value in the Date slot.
  return `PUT\n\n${req.contentType}\n${req.date}\n${canonicalHeaders}/${req.bucket}/${req.objectKey}`;
}

export async function hmacSha1Base64(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)),
  );
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Returns every header the PUT needs (content-type, x-oss-*, authorization). */
export async function signOssPut(
  req: OssPutRequest,
  credentials: OssCredentials,
): Promise<Record<string, string>> {
  const headers = ossHeaders(req, credentials);
  const signature = await hmacSha1Base64(
    credentials.accessKeySecret,
    ossStringToSign(req, headers),
  );
  return {
    ...headers,
    'content-type': req.contentType,
    authorization: `OSS ${credentials.accessKeyId}:${signature}`,
  };
}
