import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { caStringToSign, hmacSha256Base64, pathAndParameters, signCaRequest } from './sign';

// Dummy values for tests only; real material is extracted at runtime.
const material = { appKey: '1234567', appSecret: 'test-secret+测试/value' };

describe('pathAndParameters', () => {
  it('sorts query params and keeps bare keys', () => {
    expect(pathAndParameters('https://bizapi.csdn.net/a/b?z=1&a=2&flag')).toBe('/a/b?a=2&flag&z=1');
    expect(pathAndParameters('https://bizapi.csdn.net/a/b')).toBe('/a/b');
  });
});

describe('caStringToSign', () => {
  it('follows the gateway layout', () => {
    const req = {
      method: 'post',
      url: 'https://bizapi.csdn.net/blog-console-api/v1/postedit/saveArticle',
      accept: '*/*',
      contentType: 'application/json',
      nonce: 'n-1',
    };
    expect(caStringToSign(req, material.appKey)).toBe(
      'POST\n*/*\n\napplication/json\n\nx-ca-key:1234567\nx-ca-nonce:n-1\n' +
        '/blog-console-api/v1/postedit/saveArticle',
    );
  });

  it('leaves content-type empty for GET', () => {
    const req = { method: 'GET', url: 'https://x.test/p?b=2&a=1', accept: '*/*', nonce: 'n' };
    expect(caStringToSign(req, 'k')).toBe('GET\n*/*\n\n\n\nx-ca-key:k\nx-ca-nonce:n\n/p?a=1&b=2');
  });
});

describe('hmacSha256Base64 / signCaRequest', () => {
  it('matches node:crypto', async () => {
    const message = 'POST\n*/*\n\napplication/json\n\nx-ca-key:1\n/路径';
    const expected = createHmac('sha256', material.appSecret).update(message).digest('base64');
    expect(await hmacSha256Base64(material.appSecret, message)).toBe(expected);
  });

  it('emits all x-ca headers', async () => {
    const req = {
      method: 'POST',
      url: 'https://bizapi.csdn.net/p?x=1',
      accept: 'application/json',
      contentType: 'application/json',
      nonce: 'abc',
    };
    const headers = await signCaRequest(req, material);
    expect(headers).toEqual({
      'x-ca-key': '1234567',
      'x-ca-nonce': 'abc',
      'x-ca-signature-headers': 'x-ca-key,x-ca-nonce',
      'x-ca-signature': createHmac('sha256', material.appSecret)
        .update(caStringToSign(req, material.appKey))
        .digest('base64'),
    });
  });
});
