import { describe, expect, it } from 'vitest';
import { amzDate, signAws4 } from './aws4';
import { crc32, crc32Hex } from './crc32';

describe('signAws4', () => {
  it('matches the AWS SigV4 IAM ListUsers example', async () => {
    const headers = await signAws4({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Host: 'iam.amazonaws.com',
      },
      region: 'us-east-1',
      service: 'iam',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      date: new Date('2015-08-30T12:36:00Z'),
    });
    expect(headers['X-Amz-Date']).toBe('20150830T123600Z');
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  it('signs the STS session token', async () => {
    const headers = await signAws4({
      method: 'GET',
      url: 'https://imagex.bytedanceapi.com/?Action=ApplyImageUpload',
      region: 'cn-north-1',
      service: 'imagex',
      credentials: { accessKeyId: 'ak', secretAccessKey: 'sk', sessionToken: 'token' },
    });
    expect(headers['X-Amz-Security-Token']).toBe('token');
    expect(headers.Authorization).toContain('SignedHeaders=x-amz-date;x-amz-security-token,');
  });

  it('formats amz dates', () => {
    expect(amzDate(new Date('2024-01-02T03:04:05.678Z'))).toBe('20240102T030405Z');
  });
});

describe('crc32', () => {
  it('matches the standard check value', () => {
    const data = new TextEncoder().encode('123456789');
    expect(crc32(data)).toBe(0xcbf43926);
    expect(crc32Hex(data)).toBe('cbf43926');
    expect(crc32Hex(new Uint8Array())).toBe('00000000');
  });
});
