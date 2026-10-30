import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { chromium } from 'playwright';

// Exercise the actual self-contained function with a real DOM, without a platform account.
const source = await readFile(new URL('../src/platforms/sohu/editor.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { fillDraft } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const editorUrl = 'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle';

test('Sohu draft editor respects platform controls and verifies text before saving', async (t) => {
  const browser = await chromium.launch({
    channel: process.env.YUZGEO_TEST_BROWSER || 'chromium',
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await page.route('https://mp.sohu.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
    );
    await page.goto(editorUrl);
    async function fixture({
      disabled = false,
      existing = false,
      drop = false,
      success = true,
      oldSuccess = false,
    } = {}) {
      await page.setContent(
        `<input placeholder="请输入标题（5-72字）" value="${existing ? '已有标题' : ''}"><textarea placeholder="请输入摘要"></textarea><div class="ql-editor" contenteditable="true" style="width:500px;height:200px"></div><ul class="button-list"><li class="publish">发布</li><li class="draft ${disabled ? 'disable-button' : ''}">存草稿</li></ul>${disabled ? '<div>未实名暂无法发布文章</div>' : ''}${oldSuccess ? '<div role="alert">保存成功</div>' : ''}`,
      );
      await page.evaluate(
        ({ drop, success }) => {
          window.saved = 0;
          window.published = 0;
          document.querySelector('.ql-editor').addEventListener('paste', (e) => {
            e.preventDefault();
            e.currentTarget.innerHTML = drop
              ? '<p>截断的内容</p>'
              : e.clipboardData.getData('text/html');
          });
          document.querySelector('.publish').onclick = () => window.published++;
          document.querySelector('.draft').onclick = () => {
            window.saved++;
            if (success) {
              const alert = document.createElement('div');
              alert.setAttribute('role', 'alert');
              alert.textContent = '保存成功';
              document.body.append(alert);
            }
          };
        },
        { drop, success },
      );
    }
    const input = {
      title: 'yuzgeo 草稿测试（请勿发布）',
      html: '<h2>标题</h2><p>正文 <strong>加粗</strong></p><pre><code>let x = 1;\n  console.log(x);</code></pre><table><tr><td>A</td><td>B</td></tr></table>',
      summary: '摘要',
      timeoutMs: 400,
    };
    await t.test(
      'saves complete text including code lines/table rows and never clicks publish',
      async () => {
        await fixture();
        assert.equal((await page.evaluate(fillDraft, input)).ok, true);
        const state = await page.evaluate(() => ({
          saved: window.saved,
          published: window.published,
          html: document.querySelector('.ql-editor').innerHTML,
        }));
        assert.equal(state.saved, 1);
        assert.equal(state.published, 0);
        assert.match(state.html, /console.log/);
        assert.match(state.html, /A \| B/);
      },
    );
    await t.test('disabled draft controls stop before filling any content', async () => {
      await fixture({ disabled: true });
      assert.match((await page.evaluate(fillDraft, input)).error, /未实名认证/);
      assert.equal(await page.locator('.ql-editor').textContent(), '');
      assert.equal(await page.evaluate(() => window.saved), 0);
    });
    await t.test('existing content is not overwritten', async () => {
      await fixture({ existing: true });
      assert.match((await page.evaluate(fillDraft, input)).error, /避免覆盖/);
      assert.equal(await page.locator('input').inputValue(), '已有标题');
    });
    await t.test('uses only the official recovery undo before filling a fresh draft', async () => {
      await fixture({ existing: true });
      await page.evaluate(() => {
        window.oldDraftId = 'existing-draft';
        const notice = document.createElement('div');
        notice.innerHTML = '<p>已从草稿箱中恢复</p><p>撤销</p>';
        notice.lastChild.onclick = () => {
          window.oldDraftId = null;
          document.querySelector('input').value = '';
          document.querySelector('.ql-editor').textContent = '';
          notice.remove();
        };
        document.body.append(notice);
      });
      assert.equal((await page.evaluate(fillDraft, input)).ok, true);
      assert.equal(await page.evaluate(() => window.oldDraftId), null);
      assert.equal(await page.evaluate(() => window.saved), 1);
    });
    await t.test(
      'unrelated undo and unsuccessful recovery cancellation never overwrite content',
      async () => {
        for (const message of ['可撤销操作', '已从草稿箱中恢复']) {
          await fixture({ existing: true });
          await page.evaluate((message) => {
            const notice = document.createElement('div');
            notice.innerHTML = `<p>${message}</p><p>撤销</p>`;
            notice.lastChild.onclick = () => {
              window.undoClicked = true;
            };
            window.undoClicked = false;
            document.body.append(notice);
          }, message);
          assert.equal((await page.evaluate(fillDraft, input)).ok, false);
          assert.equal(await page.locator('input').inputValue(), '已有标题');
          assert.equal(await page.evaluate(() => window.saved), 0);
          assert.equal(
            await page.evaluate(() => window.undoClicked),
            message === '已从草稿箱中恢复',
          );
        }
      },
    );
    await t.test('incomplete paste is never saved', async () => {
      await fixture({ drop: true });
      assert.match((await page.evaluate(fillDraft, input)).error, /未完整保留/);
      assert.equal(await page.evaluate(() => window.saved), 0);
    });
    await t.test('old success messages cannot prove a new save', async () => {
      await fixture({ success: false, oldSuccess: true });
      assert.match((await page.evaluate(fillDraft, input)).error, /未确认/);
      assert.equal(await page.evaluate(() => window.saved), 1);
    });
    await t.test('executable markup and images are removed from editor HTML', async () => {
      await fixture();
      assert.equal(
        (
          await page.evaluate(fillDraft, {
            ...input,
            html: '<p onclick="window.injected=1">正文</p><img src="https://invalid/image.png"><script>window.injected=1</script><a href="javascript:alert(1)">链接</a>',
          })
        ).ok,
        true,
      );
      const html = await page.locator('.ql-editor').innerHTML();
      assert.doesNotMatch(html, /script|onclick|<img|javascript:/);
      assert.equal(await page.evaluate(() => window.injected), undefined);
    });
  } finally {
    await browser.close();
  }
});
