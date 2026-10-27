import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { chromium } from 'playwright';

async function load(name) {
  const source = await readFile(
    new URL(`../src/platforms/toutiao/${name}.ts`, import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { fillDraft } = await load('editor');
const { readAccount } = await load('api');
const editorUrl = 'https://mp.toutiao.com/profile_v4/graphic/publish';

test('Toutiao editor verifies complete text and fresh autosave without publishing', async (t) => {
  const browser = await chromium.launch({
    channel: process.env.YUZGEO_TEST_BROWSER || 'chromium',
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await page.route('https://mp.toutiao.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
    );
    await page.goto(editorUrl);
    const input = {
      title: 'yuzgeo 测试（请勿发布）',
      html: '<p>正文 <strong>重点</strong></p><pre><code>let x = 1;\nconsole.log(x)</code></pre><table><tr><td>A</td><td>B</td></tr></table>',
      timeoutMs: 2500,
    };
    async function fixture({
      existing = false,
      drop = false,
      save = true,
      old = false,
      disabled = false,
    } = {}) {
      await page.setContent(
        `<textarea placeholder="请输入文章标题（2～30个字）" ${disabled ? 'disabled' : ''}>${existing ? '已有文章' : ''}</textarea><div class="ProseMirror" contenteditable="true"><p><span class="syl-placeholder ProseMirror-widget" contenteditable="false" ignoreel="true">请输入正文</span><br></p></div><div class="footer-draft-save">${old ? '草稿已保存' : '草稿将自动保存'}</div><button>预览并发布</button><button>定时发布</button>`,
      );
      await page.evaluate(
        ({ drop, save }) => {
          window.published = 0;
          document
            .querySelectorAll('button')
            .forEach((el) => (el.onclick = () => window.published++));
          document.querySelector('.ProseMirror').addEventListener('paste', (event) => {
            event.preventDefault();
            event.currentTarget.innerHTML = drop
              ? '<p>部分正文</p>'
              : event.clipboardData.getData('text/html');
            if (save) {
              document.querySelector('.footer-draft-save').textContent = '草稿保存中...';
              setTimeout(
                () => (document.querySelector('.footer-draft-save').textContent = '草稿已保存'),
                100,
              );
            }
          });
        },
        { drop, save },
      );
    }
    await t.test('keeps code/table text and waits for a fresh saved state', async () => {
      await fixture();
      assert.equal((await page.evaluate(fillDraft, input)).ok, true);
      assert.match(await page.locator('.ProseMirror').innerText(), /A \| B/);
      assert.match(await page.locator('.ProseMirror').innerText(), /console.log/);
      assert.equal(await page.evaluate(() => window.published), 0);
    });
    await t.test('does not overwrite existing text', async () => {
      await fixture({ existing: true });
      assert.match((await page.evaluate(fillDraft, input)).error, /避免覆盖/);
      assert.equal(await page.locator('textarea').inputValue(), '已有文章');
    });
    await t.test('disabled editor is respected', async () => {
      await fixture({ disabled: true });
      assert.match((await page.evaluate(fillDraft, input)).error, /不可用/);
      assert.equal(await page.locator('.ProseMirror').textContent(), '请输入正文');
    });
    await t.test('missing text is not reported as success even with a saved label', async () => {
      await fixture({ drop: true });
      assert.match((await page.evaluate(fillDraft, input)).error, /未完整保留/);
    });
    await t.test('old success and timeout cannot confirm a new save', async () => {
      await fixture({ save: false, old: true });
      assert.match(
        (await page.evaluate(fillDraft, { ...input, timeoutMs: 200 })).error,
        /尚未确认/,
      );
      assert.equal(await page.evaluate(() => window.published), 0);
    });
    await t.test('refuses editing an existing draft URL', async () => {
      await page.goto(editorUrl + '?pgc_id=123');
      assert.match((await page.evaluate(fillDraft, input)).error, /新建文章/);
      await page.goto(editorUrl);
    });
    await t.test('login check requires the observed account link', async () => {
      await page.setContent('<a href="/profile_v4/manage/draft">草稿箱</a>');
      assert.equal((await page.evaluate(readAccount, 1)).ok, false);
      await page.setContent(
        '<a href="https://www.toutiao.com/c/user/123/" aria-label="测试账号的个人主页"></a>',
      );
      assert.deepEqual((await page.evaluate(readAccount, 1)).value, {
        loggedIn: true,
        username: '测试账号',
      });
      await page.setContent('扫码登录');
      assert.deepEqual((await page.evaluate(readAccount, 1)).value, { loggedIn: false });
    });
  } finally {
    await browser.close();
  }
});
