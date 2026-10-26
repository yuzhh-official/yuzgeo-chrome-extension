import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmacSha1Base64, ossHeaders, ossStringToSign, signOssPut } from './oss';
import type { OssCredentials, OssPutRequest } from './oss';

const credentials: OssCredentials = {
  accessKeyId: 'STS.testid',
  accessKeySecret: 'secret/key+测试',
  securityToken: 'token-123',
};

const req: OssPutRequest = {
  bucket: 'zhihu-pics',
  objectKey: 'v2-abc123',
  contentType: 'image/png',
  date: 'Sun, 26 Oct 2026 12:00:00 GMT',
  ossHeaders: { 'x-oss-user-agent': 'aliyun-sdk-js/6.8.0' },
};

describe('ossStringToSign', () => {
  it('sorts x-oss-* headers and appends the bucket resource', () => {
    expect(ossStringToSign(req, ossHeaders(req, credentials))).toBe(
      'PUT\n\nimage/png\nSun, 26 Oct 2026 12:00:00 GMT\n' +
        'x-oss-date:Sun, 26 Oct 2026 12:00:00 GMT\n' +
        'x-oss-security-token:token-123\n' +
        'x-oss-user-agent:aliyun-sdk-js/6.8.0\n' +
        '/zhihu-pics/v2-abc123',
    );
  });
});

describe('hmacSha1Base64', () => {
  it('matches node:crypto', async () => {
    const message = 'PUT\n\nimage/png\n日期\n/zhihu-pics/x';
    const expected = createHmac('sha1', credentials.accessKeySecret)
      .update(message)
      .digest('base64');
    expect(await hmacSha1Base64(credentials.accessKeySecret, message)).toBe(expected);
  });
});

describe('signOssPut', () => {
  it('builds the Authorization header from the string to sign', async () => {
    const stringToSign = ossStringToSign(req, ossHeaders(req, credentials));
    const signature = createHmac('sha1', credentials.accessKeySecret)
      .update(stringToSign)
      .digest('base64');
    const headers = await signOssPut(req, credentials);
    expect(headers.authorization).toBe(`OSS STS.testid:${signature}`);
    expect(headers['content-type']).toBe('image/png');
    expect(headers['x-oss-security-token']).toBe('token-123');
    expect(headers['x-oss-date']).toBe(req.date);
  });
});
