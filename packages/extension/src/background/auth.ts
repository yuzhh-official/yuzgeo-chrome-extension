import type { AuthState, PlatformId, PlatformStatus } from '@yuzgeo/core';
import { errorMessage, PLATFORMS } from '@yuzgeo/core';
import { adapters } from '@/platforms';

const LOGGED_IN_TTL = 10 * 60_000;
// Short, so logging in on the platform shows up almost immediately.
const LOGGED_OUT_TTL = 10_000;

const cache = new Map<PlatformId, { state: AuthState; at: number }>();

export async function checkAuth(id: PlatformId, forceRefresh = false): Promise<AuthState> {
  const cached = cache.get(id);
  const ttl = cached?.state.loggedIn ? LOGGED_IN_TTL : LOGGED_OUT_TTL;
  if (!forceRefresh && cached && Date.now() - cached.at < ttl) return cached.state;

  const adapter = adapters[id];
  if (!adapter) return { loggedIn: false };
  const state = await adapter.checkAuth({
    signal: AbortSignal.timeout(15_000),
    log: (message) => console.info(`[${id}]`, message),
  });
  cache.set(id, { state, at: Date.now() });
  return state;
}

export async function listPlatforms(forceRefresh = false): Promise<PlatformStatus[]> {
  const ids = Object.keys(adapters) as PlatformId[];
  return Promise.all(
    ids.map(async (id) => {
      const { name, homepage } = PLATFORMS[id];
      try {
        return { id, name, homepage, ...(await checkAuth(id, forceRefresh)) };
      } catch (error) {
        return { id, name, homepage, loggedIn: false, error: errorMessage(error) };
      }
    }),
  );
}
