import { describe, expect, it } from 'vitest';
import { isPlatformId } from './platforms';

describe('isPlatformId', () => {
  it('accepts the first-release platforms', () => {
    expect(isPlatformId('juejin')).toBe(true);
    expect(isPlatformId('zhihu')).toBe(true);
    expect(isPlatformId('csdn')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isPlatformId('weibo')).toBe(false);
    expect(isPlatformId(42)).toBe(false);
  });
});
