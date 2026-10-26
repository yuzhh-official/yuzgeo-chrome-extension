import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('built background starts without a DOM and opens the dashboard on click', async () => {
  const source = await readFile(
    new URL('../.output/chrome-mv3/background.js', import.meta.url),
    'utf8',
  );
  let onClick;
  let onMessage;
  const openedTabs = [];
  const chrome = {
    runtime: {
      id: 'test-extension',
      getURL: (path) => `chrome-extension://test-extension${path}`,
      onMessage: {
        addListener: (listener) => {
          onMessage = listener;
        },
      },
    },
    declarativeNetRequest: {
      getSessionRules: async () => [],
      updateSessionRules: async () => {},
    },
    action: {
      onClicked: {
        addListener: (listener) => {
          onClick = listener;
        },
      },
    },
    tabs: {
      create: async (options) => {
        openedTabs.push(options);
      },
    },
  };

  // MV3 service workers have no window or document. Execute the actual bundle
  // so dependency export-resolution mistakes are caught as well as source errors.
  runInNewContext(source, { chrome, console, TextEncoder, TextDecoder, URL }, { timeout: 5000 });
  assert.equal(typeof onMessage, 'function');
  assert.equal(typeof onClick, 'function');
  onClick();
  assert.equal(openedTabs.length, 1);
  assert.equal(openedTabs[0].url, 'chrome-extension://test-extension/dashboard.html');
});
