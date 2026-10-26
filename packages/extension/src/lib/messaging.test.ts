import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTrustedSender, request } from './messaging';

const base = 'chrome-extension://test-extension/';
const sendMessage = vi.fn();

beforeEach(() => {
  vi.stubGlobal('browser', {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => base + path.replace(/^\//, ''),
      sendMessage,
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('extension messages', () => {
  it('accepts the dashboard opened in a browser tab', () => {
    expect(
      isTrustedSender({
        id: 'test-extension',
        url: base + 'dashboard.html',
        tab: { id: 1 } as Browser.tabs.Tab,
      }),
    ).toBe(true);
  });

  it('rejects web content scripts, missing URLs and other extensions', () => {
    for (const sender of [
      { id: 'test-extension', url: 'https://juejin.cn/' },
      { id: 'test-extension', url: 'chrome-extension://test-extension.evil/dashboard.html' },
      { id: 'other-extension', url: base + 'dashboard.html' },
      { id: 'test-extension' },
    ])
      expect(isTrustedSender(sender)).toBe(false);
  });

  it('reports a missing background response clearly', async () => {
    sendMessage.mockResolvedValue(undefined);
    await expect(request('tasks/list', {})).rejects.toThrow('扩展后台未响应');
  });

  it('returns a correlated background result', async () => {
    sendMessage.mockImplementation(async ({ id }) => ({ id, ok: true, result: [] }));
    await expect(request('tasks/list', {})).resolves.toEqual([]);
  });

  it.each([
    'Extension context invalidated.',
    'Could not establish connection. Receiving end does not exist.',
    'The message port closed before a response was received.',
  ])('explains how to reconnect after %s', async (message) => {
    sendMessage.mockRejectedValue(new Error(message));
    await expect(request('tasks/list', {})).rejects.toThrow('关闭旧页面');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { id: 'wrong', ok: true, result: [] }])(
    'rejects an invalid response %j',
    async (response) => {
      sendMessage.mockResolvedValue(response);
      await expect(request('tasks/list', {})).rejects.toThrow('扩展后台未响应');
    },
  );
});
