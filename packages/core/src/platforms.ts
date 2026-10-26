export const PLATFORM_IDS = ['juejin', 'zhihu', 'csdn'] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export type ContentFormat = 'markdown' | 'html';

export interface PlatformMeta {
  id: PlatformId;
  name: string;
  homepage: string;
  /** Match patterns the adapter talks to; mirrored into the manifest's host permissions. */
  hostPermissions: string[];
  format: ContentFormat;
}

export const PLATFORMS: Record<PlatformId, PlatformMeta> = {
  juejin: {
    id: 'juejin',
    name: '掘金',
    homepage: 'https://juejin.cn',
    hostPermissions: [
      'https://juejin.cn/*',
      'https://api.juejin.cn/*',
      // ImageX upload: STS endpoints and the upload hosts it hands out.
      'https://*.bytedanceapi.com/*',
      'https://*.snssdk.com/*',
      'https://*.byteimg.com/*',
    ],
    format: 'markdown',
  },
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    homepage: 'https://www.zhihu.com',
    hostPermissions: [
      'https://www.zhihu.com/*',
      'https://zhuanlan.zhihu.com/*',
      'https://api.zhihu.com/*',
      'https://*.zhimg.com/*',
    ],
    format: 'html',
  },
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    homepage: 'https://mp.csdn.net',
    hostPermissions: [],
    format: 'markdown',
  },
};

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && (PLATFORM_IDS as readonly string[]).includes(value);
}
