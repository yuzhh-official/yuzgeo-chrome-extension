import type { PageResult } from '../../lib/page-context';

export interface DraftInput {
  title: string;
  html: string;
  summary: string;
  timeoutMs: number;
}

/** Self-contained MAIN-world function. Only fills a fresh editor and clicks exactly 存草稿. */
export async function fillDraft(input: DraftInput): Promise<PageResult<{ id?: string }>> {
  const fail = (error: string): PageResult<{ id?: string }> => ({ ok: false, error });
  const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
  const visible = (el: Element) =>
    el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const saveButton = () =>
    [...document.querySelectorAll<HTMLElement>('.button-list li, button, [role="button"]')].find(
      (el) => visible(el) && el.textContent?.trim() === '存草稿',
    );
  const disabled = (el: HTMLElement) =>
    el.matches('[disabled], [aria-disabled="true"], .disable-button, .disabled') ||
    !!el.closest('[inert]');
  const setText = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
    const prototype =
      el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  try {
    if (
      location.origin !== 'https://mp.sohu.com' ||
      location.pathname !== '/mpfe/v4/contentManagement/news/addarticle' ||
      location.search
    )
      return fail('搜狐号：拒绝操作非新建文章页面');
    const deadline = Date.now() + input.timeoutMs;
    let title: HTMLInputElement | null = null;
    let body: HTMLElement | null = null;
    let save: HTMLElement | undefined;
    do {
      title = document.querySelector<HTMLInputElement>('input[placeholder*="请输入标题"]');
      body = document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]');
      save = saveButton();
      if (title && body && save) break;
      await pause();
    } while (Date.now() < deadline);
    if (!title || !body || !save) return fail('搜狐号编辑器未就绪，请登录创作中心后重试');
    // Respect platform eligibility restrictions, including the disabled draft control for an
    // unverified account. Never remove disabled classes or call the site's private save handler.
    if (disabled(save))
      return fail(
        document.body.innerText.includes('未实名')
          ? '搜狐号当前账号未实名认证，“存草稿”不可用；请在平台完成认证后重试'
          : '搜狐号“存草稿”暂不可用，请在创作中心检查账号权限',
      );
    // A fresh route can restore the last saved draft. Only the platform's explicitly labelled
    // recovery undo is safe here: clearing fields ourselves could overwrite that old draft ID.
    const recoveryUndo = () =>
      [...document.querySelectorAll<HTMLElement>('p')].find(
        (el) =>
          visible(el) &&
          el.textContent?.trim() === '撤销' &&
          el.parentElement?.textContent?.replace(/\s+/g, '') === '已从草稿箱中恢复撤销',
      );
    let undo = recoveryUndo();
    if (title.value.trim() || body.textContent?.trim() || undo) {
      const recoveryDeadline = Date.now() + Math.min(input.timeoutMs, 1500);
      while (!undo && Date.now() < recoveryDeadline) {
        await pause();
        undo = recoveryUndo();
      }
      if (undo) {
        undo.click();
        do {
          await pause();
          title = document.querySelector<HTMLInputElement>('input[placeholder*="请输入标题"]');
          body = document.querySelector<HTMLElement>('.ql-editor[contenteditable="true"]');
          if (title && body && !title.value.trim() && !body.textContent?.trim()) break;
        } while (Date.now() < recoveryDeadline);
      }
      if (!title || !body || title.value.trim() || body.textContent?.trim() || !undo)
        return fail(
          '搜狐号恢复了已有内容，已停止操作以避免覆盖。请在新建文章页点击“已从草稿箱中恢复”旁的“撤销”，再重试',
        );
    }

    // Quill does not reliably preserve tables/code blocks. Convert them to readable paragraphs,
    // retaining each row/line; allow only non-executable text markup in the editor paste.
    const doc = new DOMParser().parseFromString(input.html, 'text/html');
    doc
      .querySelectorAll(
        'script,style,iframe,object,embed,img,picture,svg,video,audio,form,input,button',
      )
      .forEach((el) => el.remove());
    const p = (text: string) => {
      const node = doc.createElement('p');
      node.textContent = text;
      return node;
    };
    doc.querySelectorAll('pre').forEach((pre) =>
      pre.replaceWith(
        ...(pre.textContent ?? '')
          .replace(/\n$/, '')
          .split('\n')
          .map((line) => p(line.replace(/^ +/, (spaces) => '\u00a0'.repeat(spaces.length)))),
      ),
    );
    doc
      .querySelectorAll('table')
      .forEach((table) =>
        table.replaceWith(
          ...[...table.rows].map((row) =>
            p([...row.cells].map((cell) => cell.textContent?.trim() ?? '').join(' | ')),
          ),
        ),
      );
    const allowed = new Set([
      'P',
      'BR',
      'STRONG',
      'B',
      'EM',
      'I',
      'U',
      'S',
      'DEL',
      'BLOCKQUOTE',
      'UL',
      'OL',
      'LI',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'A',
      'CODE',
      'HR',
    ]);
    for (const el of [...doc.body.querySelectorAll('*')].reverse()) {
      if (!allowed.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const attr of [...el.attributes]) {
        if (el.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:|#)/i.test(attr.value))
          continue;
        el.removeAttribute(attr.name);
      }
    }
    const expected = (doc.body.textContent ?? '').replace(/\s+/g, '');
    if (!expected) return fail('搜狐号没有可保存的文字正文');
    setText(title, input.title);
    const summary = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="请输入摘要"]',
    );
    if (summary && input.summary) setText(summary, input.summary.slice(0, 120));
    body.focus();
    const clipboard = new DataTransfer();
    clipboard.setData('text/html', doc.body.innerHTML);
    clipboard.setData('text/plain', doc.body.textContent ?? '');
    body.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
    await pause();
    if (!(body.textContent ?? '').trim())
      document.execCommand('insertHTML', false, doc.body.innerHTML);
    await pause();
    if (title.value !== input.title || (body.textContent ?? '').replace(/\s+/g, '') !== expected)
      return fail('搜狐号编辑器未完整保留正文，已停止保存，请检查平台编辑器的格式限制');
    save = saveButton();
    if (!save || disabled(save)) return fail('搜狐号暂不允许保存草稿，请检查账号权限');

    // Only a new, visible success message or the draft list containing this title proves a save.
    const messages = () =>
      [
        ...document.querySelectorAll<HTMLElement>('.el-message, [role="alert"], .el-notification'),
      ].filter(visible);
    const oldMessages = new Set(messages());
    save.click();
    const saveDeadline = Date.now() + Math.min(input.timeoutMs, 10000);
    while (Date.now() < saveDeadline) {
      await pause();
      const newMessages = messages().filter((el) => !oldMessages.has(el));
      if (newMessages.some((el) => /保存成功|草稿已保存|存草稿成功/.test(el.innerText)))
        return { ok: true, value: {} };
      const error = newMessages.find((el) => /失败|验证|实名|无权限|错误/.test(el.innerText));
      if (error) return fail(`搜狐号保存草稿失败：${error.innerText}`);
      if (
        String(location.pathname) === '/mpfe/v4/contentManagement/first/page' &&
        document.body.innerText.includes(input.title)
      )
        return { ok: true, value: {} };
    }
    return fail('搜狐号未确认草稿保存成功，请先到草稿箱检查，避免重复创建');
  } catch {
    return fail('操作搜狐号编辑器失败，请检查登录状态并在平台确认是否已生成草稿');
  }
}
