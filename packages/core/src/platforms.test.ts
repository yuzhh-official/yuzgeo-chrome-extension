import { describe, expect, it } from 'vitest';
import { isPlatformId } from './platforms';

describe('isPlatformId', () => {
  it('accepts every registered platform', () => {
    for (const id of [
      'juejin',
      'zhihu',
      'csdn',
      'aliyun',
      'tencentcloud',
      'douyin',
      'xiaohongshu',
      'sohu',
      'baijiahao',
      'weixin',
      'toutiao',
    ]) {
      expect(isPlatformId(id)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isPlatformId('weibo')).toBe(false);
    expect(isPlatformId(42)).toBe(false);
  });
});
