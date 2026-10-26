import tailwindcss from '@tailwindcss/vite';
import { PLATFORMS } from '@yuzgeo/core';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'yuzgeo',
    description: '把本地 Markdown 一键保存为掘金、知乎、CSDN 等平台的草稿',
    minimum_chrome_version: '116',
    // No content scripts, no externally_connectable, no <all_urls>: only the platforms we post to.
    permissions: ['storage', 'cookies', 'declarativeNetRequestWithHostAccess'],
    host_permissions: [...new Set(Object.values(PLATFORMS).flatMap((p) => p.hostPermissions))],
    action: {},
  },
});
