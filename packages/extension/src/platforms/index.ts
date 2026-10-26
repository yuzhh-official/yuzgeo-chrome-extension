import type { PlatformId } from '@yuzgeo/core';
import { aliyun } from './aliyun';
import { csdn } from './csdn';
import { juejin } from './juejin';
import { tencentcloud } from './tencentcloud';
import type { ExtensionAdapter } from './types';
import { zhihu } from './zhihu';

export const adapters: Partial<Record<PlatformId, ExtensionAdapter>> = {
  juejin,
  zhihu,
  csdn,
  aliyun,
  tencentcloud,
};

export function getAdapter(id: PlatformId): ExtensionAdapter {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`平台暂未支持：${id}`);
  return adapter;
}
