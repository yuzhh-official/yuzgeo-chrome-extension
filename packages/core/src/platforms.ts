export const PLATFORM_IDS = [
  'juejin',
  'zhihu',
  'csdn',
  'aliyun',
  'tencentcloud',
  'douyin',
  'xiaohongshu',
  'sohu',
  'baijiahao',
] as const;

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
    hostPermissions: [
      'https://mp.csdn.net/*',
      'https://bizapi.csdn.net/*',
      'https://me.csdn.net/*',
      'https://g.csdnimg.cn/*',
    ],
    format: 'markdown',
  },
  aliyun: {
    id: 'aliyun',
    name: '阿里云开发者社区',
    homepage: 'https://developer.aliyun.com',
    hostPermissions: ['https://developer.aliyun.com/*'],
    format: 'markdown',
  },
  tencentcloud: {
    id: 'tencentcloud',
    name: '腾讯云开发者社区',
    homepage: 'https://cloud.tencent.com/developer',
    hostPermissions: ['https://cloud.tencent.com/*'],
    format: 'markdown',
  },
  // The next two work inside a creator-center tab: Douyin signs requests with scripts only its own
  // pages have, and Xiaohongshu keeps long-article drafts in the browser, saved by its editor.
  douyin: {
    id: 'douyin',
    name: '抖音长文',
    homepage: 'https://creator.douyin.com',
    hostPermissions: ['https://creator.douyin.com/*', 'https://*.douyin.com/*'],
    format: 'markdown',
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    name: '小红书长文',
    homepage: 'https://creator.xiaohongshu.com',
    hostPermissions: ['https://creator.xiaohongshu.com/*', 'https://*.xiaohongshu.com/*'],
    format: 'markdown',
  },
  sohu: {
    id: 'sohu',
    name: '搜狐号',
    homepage: 'https://mp.sohu.com/home',
    hostPermissions: ['https://mp.sohu.com/*'],
    format: 'html',
  },
  baijiahao: {
    id: 'baijiahao',
    name: '百家号',
    homepage: 'https://baijiahao.baidu.com',
    hostPermissions: ['https://baijiahao.baidu.com/*'],
    format: 'html',
  },
};

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && (PLATFORM_IDS as readonly string[]).includes(value);
}
