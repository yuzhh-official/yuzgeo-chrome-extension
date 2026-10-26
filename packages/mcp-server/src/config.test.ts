import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, loadConfig } from './config';

describe('loadConfig', () => {
  it('requires a pairing token', () => {
    expect(() => loadConfig({})).toThrow(/YUZGEO_TOKEN/);
  });

  it('applies defaults and parses extension ids', () => {
    expect(loadConfig({ YUZGEO_TOKEN: 't', YUZGEO_EXTENSION_IDS: 'a, b,' })).toEqual({
      port: DEFAULT_PORT,
      token: 't',
      allowedExtensionIds: ['a', 'b'],
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ YUZGEO_TOKEN: 't', YUZGEO_PORT: 'abc' })).toThrow(/YUZGEO_PORT/);
  });
});
