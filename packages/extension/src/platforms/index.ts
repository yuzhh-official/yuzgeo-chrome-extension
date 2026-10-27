import type { PlatformId } from '@yuzgeo/core';
import { aliyun } from './aliyun';
import { baijiahao } from './baijiahao';
import { csdn } from './csdn';
import { douyin } from './douyin';
import { juejin } from './juejin';
import { sohu } from './sohu';
import { tencentcloud } from './tencentcloud';
import type { ExtensionAdapter } from './types';
import { xiaohongshu } from './xiaohongshu';
import { zhihu } from './zhihu';
import { weixin } from './weixin';
import { toutiao } from './toutiao';

export const adapters: Partial<Record<PlatformId, ExtensionAdapter>> = {
  juejin,
  zhihu,
  csdn,
  aliyun,
  tencentcloud,
  douyin,
  xiaohongshu,
  sohu,
  baijiahao,
  weixin,
  toutiao,
};

export function getAdapter(id: PlatformId): ExtensionAdapter {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`平台暂未支持：${id}`);
  return adapter;
}
