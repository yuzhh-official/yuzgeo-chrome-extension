import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { chromium } from 'playwright';

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const fixtures = new URL('../../../examples/test-post/', import.meta.url);

test('built dashboard imports Markdown and communicates with its worker', async (t) => {
  const context = await chromium.launchPersistentContext('', {
    channel: process.env.YUZGEO_TEST_BROWSER || 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: 1280, height: 960 },
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // Exercise real extension messaging, with deterministic login responses and
    // no real accounts, uploads, or platform drafts involved in this test.
    await worker.evaluate(() => {
      globalThis.testRequests = [];
      globalThis.fetch = async (url, init) => {
        globalThis.testRequests.push({ url: String(url), body: init?.body });
        if (String(url).includes('/content_api/v1/article_draft/create'))
          return Response.json({ err_no: 0, data: { id: 'test-draft' } });
        if (String(url).endsWith('/api/articles/drafts'))
          return Response.json({ id: 'test-zhihu' });
        if (String(url).endsWith('/api/articles/test-zhihu/draft'))
          return new Response(null, { status: 204 });
        if (String(url).includes('/user_api/v1/user/get'))
          return Response.json({ err_no: 0, data: { user_id: '1', user_name: '测试账号' } });
        if (String(url).includes('/api/v4/me')) return Response.json({ name: '测试账号' });
        throw new Error(`Unexpected network request: ${url}`);
      };
    });
    await context.addCookies([
      { name: '_xsrf', value: 'isolated-test-token', url: 'https://www.zhihu.com' },
    ]);
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.goto(`chrome-extension://${id}/dashboard.html`);

    await t.test('platforms load from the extension tab', async () => {
      await page.getByRole('checkbox', { name: '掘金' }).waitFor();
      assert.equal(await page.getByRole('checkbox', { name: '知乎' }).isEnabled(), true);
    });

    await t.test('real Markdown file renders text and tables without images', async () => {
      await page
        .locator('input[type=file]')
        .setInputFiles(fileURLToPath(new URL('hello-yuzgeo.md', fixtures)));
      await page
        .getByRole('heading', { name: 'yuzgeo 测试草稿（请勿发布）', exact: true })
        .waitFor();
      await page
        .getByRole('article', { name: '正文预览' })
        .getByRole('heading', { name: '从本地文章开始', exact: true })
        .waitFor();
      assert.match(
        await page.getByRole('article', { name: '正文预览' }).innerText(),
        /console.log/,
      );
      assert.equal(await page.locator('article img').count(), 0);
      await page.getByRole('button', { name: '查看 Markdown 原文' }).click();
      assert.match(await page.locator('pre').innerText(), /title: yuzgeo/);
      await page.getByRole('button', { name: '返回预览' }).click();
      await page.getByRole('article', { name: '正文预览' }).locator('table').waitFor();
    });

    await t.test('empty files show an error instead of a blank preview', async () => {
      await page
        .locator('input[type=file]')
        .setInputFiles({ name: 'empty.md', mimeType: 'text/markdown', buffer: Buffer.from('') });
      await page.getByRole('alert').filter({ hasText: '文件内容为空' }).waitFor();
      assert.equal(await page.getByRole('article', { name: '正文预览' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /保存为草稿/ }).isEnabled(), false);
    });

    await t.test(
      'untrusted HTML cannot run scripts, inject styles or navigate the extension',
      async () => {
        await page.locator('input[type=file]').setInputFiles({
          name: 'unsafe.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from(
            '# 安全测试\n\n正文保留。\n\n<script>window.__previewXss = true</script><style>body{display:none}</style><iframe srcdoc="injected"></iframe><form><input name="runtime"></form><svg onload="window.__previewXss = true"></svg><img src="missing.png" onerror="window.__previewXss = true"><a href="javascript:window.__previewXss = true">危险链接</a>\n\n[正常链接](https://example.com/)',
          ),
        });
        const preview = page.getByRole('article', { name: '正文预览' });
        await preview.getByText('正文保留。', { exact: true }).waitFor();
        assert.equal(
          await preview.locator('script,style,iframe,form,input,svg,[onerror],[onload]').count(),
          0,
        );
        assert.equal(await preview.getByText('危险链接').getAttribute('href'), null);
        assert.equal(
          await preview.getByRole('link', { name: '正常链接' }).getAttribute('rel'),
          'noopener noreferrer',
        );
        assert.equal(await page.evaluate(() => window.__previewXss), undefined);
      },
    );

    const files = await Promise.all(
      ['hello-yuzgeo.md', 'images/draft-flow.png', 'images/gradient.png'].map(async (path) => ({
        path,
        base64: (await readFile(new URL(path, fixtures))).toString('base64'),
      })),
    );
    // The native folder picker cannot be driven headlessly. Supply the same
    // FileSystemDirectoryHandle interface while exercising real File objects.
    async function selectFolder() {
      await page.evaluate(
        ({ files }) => {
          window.testImageReads = 0;
          const entries = new Map();
          for (const { path, base64 } of files) {
            const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
            const name = path.split('/').pop();
            const file = new File([bytes], name, {
              type: path.endsWith('.png') ? 'image/png' : 'text/markdown',
            });
            entries.set(path, {
              kind: 'file',
              name,
              getFile: async () => {
                if (path.endsWith('.png')) {
                  window.testImageReads++;
                  throw new Error('Images must never be read');
                }
                return file;
              },
            });
          }
          window.showDirectoryPicker = async () => ({
            kind: 'directory',
            name: 'test-post',
            async *values() {
              yield entries.get('hello-yuzgeo.md');
              yield {
                kind: 'directory',
                name: 'images',
                async *values() {
                  yield entries.get('images/draft-flow.png');
                  yield entries.get('images/gradient.png');
                },
              };
            },
          });
        },
        { files },
      );
      await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
    }

    await t.test('folder import never reads or renders image files', async () => {
      await selectFolder();
      await page
        .getByRole('article', { name: '正文预览' })
        .getByRole('heading', { name: '从本地文章开始', exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => window.testImageReads), 0);
      assert.equal(await page.locator('article img').count(), 0);
      const output = new URL('../.output/test-results/', import.meta.url);
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: fileURLToPath(new URL('dashboard-preview.png', output)),
        fullPage: true,
      });
    });

    await t.test('image-only articles are rejected before submission', async () => {
      await page.locator('input[type=file]').setInputFiles({
        name: 'images.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# 图片文章\n\n![](./missing.png)'),
      });
      await page.getByRole('alert').filter({ hasText: '去除图片后没有可同步的正文' }).waitFor();
      assert.equal(await page.getByRole('button', { name: /保存为草稿/ }).isEnabled(), false);
    });

    await t.test('both platforms receive text-only drafts without image requests', async () => {
      await page.locator('input[type=file]').setInputFiles({
        name: 'sync.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(
          '---\ntitle: 纯文字同步\ncover: ./cover.png\n---\n正文 **加粗** $x$\n\n![图注](./missing.png) ![](https://example.com/remote.png)\n\n<img src="https://example.com/html.png">\n\n| a |\n|---|\n| b |',
        ),
      });
      await page.getByRole('heading', { name: '纯文字同步', exact: true }).waitFor();
      await page.getByRole('checkbox', { name: '掘金' }).check();
      await page.getByRole('checkbox', { name: '知乎' }).check();
      // Reproduce a lost background response during the first progress query.
      await page.evaluate(() => {
        const runtime = globalThis.chrome.runtime;
        const sendMessage = runtime.sendMessage.bind(runtime);
        let failOnce = true;
        runtime.sendMessage = (...args) => {
          if (args[0]?.method === 'tasks/get' && failOnce) {
            failOnce = false;
            return Promise.resolve(undefined);
          }
          return sendMessage(...args);
        };
      });
      await page.getByRole('button', { name: /保存为草稿/ }).click();
      await page
        .getByRole('alert')
        .filter({ hasText: '无法查询同步进度：扩展后台未响应' })
        .waitFor();
      await page.getByRole('button', { name: '重新查询进度' }).click();
      await page.getByText('已保存草稿', { exact: true }).nth(1).waitFor();
      const requests = await worker.evaluate(() => globalThis.testRequests);
      // Retrying a read must never submit another draft.
      assert.equal(requests.filter((r) => r.url.includes('/article_draft/create')).length, 1);
      assert.equal(requests.filter((r) => r.url.endsWith('/api/articles/drafts')).length, 1);
      const juejin = JSON.parse(requests.find((r) => r.url.includes('/article_draft/create')).body);
      assert.equal(juejin.cover_image, '');
      assert.match(juejin.mark_content, /正文 \*\*加粗\*\*/);
      assert.match(juejin.mark_content, /图注/);
      assert.doesNotMatch(juejin.mark_content, /!\[|<img|\.png/);
      const zhihu = JSON.parse(requests.find((r) => r.url.endsWith('/test-zhihu/draft')).body);
      assert.match(zhihu.content, /<strong>加粗<\/strong>/);
      assert.match(zhihu.content, /<table>/);
      assert.doesNotMatch(zhihu.content, /<img|\.png|equation/);
      assert.equal(zhihu.titleImage, undefined);
      assert.ok(
        requests.every((r) =>
          // Login checks of the other platforms run when the platform list loads.
          /user_api|api\/v4\/me|article_draft\/create|api\/articles\/|my\/user\/getUser|api\/user\/session/.test(
            r.url,
          ),
        ),
        JSON.stringify(requests),
      );
      assert.equal(await page.locator('article img').count(), 0);
    });

    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
