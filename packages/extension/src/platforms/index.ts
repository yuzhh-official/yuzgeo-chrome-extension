import type { PlatformId } from '@yuzgeo/core';
import { juejin } from './juejin';
import type { ExtensionAdapter } from './types';
import { zhihu } from './zhihu';

export const adapters: Partial<Record<PlatformId, ExtensionAdapter>> = { juejin, zhihu };

export function getAdapter(id: PlatformId): ExtensionAdapter {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`平台暂未支持：${id}`);
  return adapter;
}
