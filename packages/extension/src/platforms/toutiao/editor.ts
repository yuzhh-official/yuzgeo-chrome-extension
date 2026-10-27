import type { PageResult } from '../../lib/page-context';

export interface DraftInput {
  title: string;
  html: string;
  timeoutMs: number;
}

/** Self-contained MAIN-world function. The site's editor autosaves; no publish control is clicked. */
export async function fillDraft(input: DraftInput): Promise<PageResult<null>> {
  const fail = (error: string): PageResult<null> => ({ ok: false, error });
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  const normalize = (text: string) => text.replace(/\s+/g, '');
  const editorText = (element: HTMLElement) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll(
        '.syl-placeholder.ProseMirror-widget[contenteditable="false"][ignoreel="true"]',
      )
      .forEach((el) => el.remove());
    return clone.textContent ?? '';
  };
  let observer: MutationObserver | undefined;
  try {
    if (
      location.origin !== 'https://mp.toutiao.com' ||
      location.pathname !== '/profile_v4/graphic/publish' ||
      location.search ||
      location.hash
    )
      return fail('头条号：只允许操作空白的新建文章页面');
    if ([...input.title].length < 2 || [...input.title].length > 30)
      return fail('头条号标题需为 2–30 个字符');
    const deadline = Date.now() + input.timeoutMs;
    let title: HTMLTextAreaElement | null = null;
    let body: HTMLElement | null = null;
    let status: HTMLElement | null = null;
    do {
      title = document.querySelector('textarea[placeholder="请输入文章标题（2～30个字）"]');
      body = document.querySelector('.ProseMirror[contenteditable="true"]');
      status = document.querySelector('.footer-draft-save');
      if (title && body && status) break;
      await pause();
    } while (Date.now() < deadline);
    if (!title || !body || !status) return fail('头条号编辑器未就绪，请登录后台后重试');
    if (title.value.trim() || editorText(body).trim())
      return fail('头条号编辑器已有内容，已停止操作以避免覆盖');
    if (title.disabled || title.readOnly || body.closest('[inert], [aria-disabled="true"]'))
      return fail('头条号编辑器不可用，请在平台检查账号权限');

    // Preserve all text in code blocks/tables as paragraphs supported by the editor schema.
    const doc = new DOMParser().parseFromString(input.html, 'text/html');
    doc
      .querySelectorAll('script,style,iframe,object,embed,img,picture,svg,video,audio,form')
      .forEach((el) => el.remove());
    const paragraph = (text: string) => {
      const node = doc.createElement('p');
      node.textContent = text;
      return node;
    };
    doc
      .querySelectorAll('pre')
      .forEach((el) =>
        el.replaceWith(...(el.textContent ?? '').replace(/\n$/, '').split('\n').map(paragraph)),
      );
    doc
      .querySelectorAll('table')
      .forEach((table) =>
        table.replaceWith(
          ...[...table.rows].map((row) =>
            paragraph([...row.cells].map((cell) => cell.textContent?.trim() ?? '').join(' | ')),
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
        if (el.tagName === 'A' && attr.name === 'href' && /^https?:/i.test(attr.value)) continue;
        el.removeAttribute(attr.name);
      }
    }
    const expected = normalize(doc.body.textContent ?? '');
    if (!expected) return fail('头条号没有可保存的文字正文');
    // Observe the status only after this import starts. An old "saved" label is not proof.
    let savingSeen = false;
    let savedAt = 0;
    observer = new MutationObserver(() => {
      const text = status?.textContent ?? '';
      if (/草稿保存中/.test(text)) {
        savingSeen = true;
        savedAt = 0;
      } else if (savingSeen && /草稿已保存/.test(text)) savedAt = Date.now();
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      title,
      input.title,
    );
    title.dispatchEvent(new Event('input', { bubbles: true }));
    title.dispatchEvent(new Event('change', { bubbles: true }));
    body.focus();
    const clipboard = new DataTransfer();
    clipboard.setData('text/html', doc.body.innerHTML);
    clipboard.setData('text/plain', doc.body.textContent ?? '');
    body.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
    await pause();
    if (!editorText(body).trim()) document.execCommand('insertHTML', false, doc.body.innerHTML);
    await pause();
    if (title.value !== input.title || normalize(editorText(body)) !== expected)
      return fail('头条号编辑器未完整保留文字，请检查已生成的自动草稿，避免重复导入');
    const saveDeadline = Date.now() + input.timeoutMs;
    while (Date.now() < saveDeadline) {
      await pause();
      if (/保存失败|保存出错/.test(status.textContent ?? ''))
        return fail('头条号自动保存失败，请在编辑器检查账号与内容要求');
      if (
        savedAt &&
        Date.now() - savedAt >= 1500 &&
        /草稿已保存/.test(status.textContent ?? '') &&
        title.value === input.title &&
        normalize(editorText(body)) === expected
      )
        return { ok: true, value: null };
    }
    return fail('尚未确认头条号自动保存成功，请先查看草稿箱，避免重复创建');
  } catch {
    return fail('头条号编辑器操作失败，请先检查自动草稿是否已生成');
  } finally {
    observer?.disconnect();
  }
}
