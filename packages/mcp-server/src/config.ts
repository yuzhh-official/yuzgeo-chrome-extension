export const DEFAULT_PORT = 17321;

export interface BridgeConfig {
  port: number;
  /** Pairing token shown in the extension; required on every bridge connection. */
  token: string;
  /** Extension IDs allowed to connect, checked against the WebSocket Origin header. */
  allowedExtensionIds: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const token = env.YUZGEO_TOKEN;
  if (!token) throw new Error('YUZGEO_TOKEN is required; copy it from the extension settings');

  const port = env.YUZGEO_PORT ? Number(env.YUZGEO_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid YUZGEO_PORT: ${env.YUZGEO_PORT}`);
  }

  const allowedExtensionIds = (env.YUZGEO_EXTENSION_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return { port, token, allowedExtensionIds };
}
