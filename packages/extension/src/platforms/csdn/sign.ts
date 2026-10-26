/**
 * Aliyun API Gateway style request signature (HmacSHA256) as used by bizapi.csdn.net.
 * Pure and WebCrypto-based so it runs in the MV3 service worker. Holds no key material.
 */

export interface SigningMaterial {
  /** Sent as `x-ca-key`. */
  appKey: string;
  /** HMAC key; never sent. */
  appSecret: string;
}

export interface CaSignRequest {
  method: string;
  url: string;
  /** Must equal the `accept` header actually sent. */
  accept: string;
  /** Must equal the `content-type` header actually sent; empty for bodiless requests. */
  contentType?: string;
  nonce: string;
}

/** `path` plus query params sorted by key; params without a value appear as the bare key. */
export function pathAndParameters(url: string): string {
  const { pathname, searchParams } = new URL(url);
  const entries = [...searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return pathname;
  const query = entries.map(([key, value]) => (value === '' ? key : `${key}=${value}`)).join('&');
  return `${pathname}?${query}`;
}

/** Signed headers, sorted by lowercase name. Only x-ca-key and x-ca-nonce are signed. */
export function caSignedHeaders(appKey: string, nonce: string): [string, string][] {
  return [
    ['x-ca-key', appKey],
    ['x-ca-nonce', nonce],
  ];
}

/**
 * METHOD \n Accept \n Content-MD5 \n Content-Type \n Date \n signed-headers… path?query
 * Content-MD5 and Date are left empty (CSDN's editor does not send them).
 */
export function caStringToSign(req: CaSignRequest, appKey: string): string {
  const headers = caSignedHeaders(appKey, req.nonce)
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
  return [
    req.method.toUpperCase(),
    req.accept,
    '',
    req.contentType ?? '',
    '',
    `${headers}${pathAndParameters(req.url)}`,
  ].join('\n');
}

export async function hmacSha256Base64(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
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

/** Returns the x-ca-* headers to add to the request. */
export async function signCaRequest(
  req: CaSignRequest,
  material: SigningMaterial,
): Promise<Record<string, string>> {
  const headers = caSignedHeaders(material.appKey, req.nonce);
  const signature = await hmacSha256Base64(
    material.appSecret,
    caStringToSign(req, material.appKey),
  );
  return {
    ...Object.fromEntries(headers),
    'x-ca-signature-headers': headers.map(([key]) => key).join(','),
    'x-ca-signature': signature,
  };
}
