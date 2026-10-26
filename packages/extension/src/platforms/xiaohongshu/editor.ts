import type { PageResult } from '../../lib/page-context';

export interface FillDraftInput {
  title: string;
  /** Body as HTML, handed to the editor as a paste so it keeps headings, lists and code. */
  html: string;
  /** Plain-text body, used as the paste's text fallback and to check the editor took it. */
  text: string;
  timeoutMs: number;
}

/**
 * Runs in a fresh tab of the long-article editor (serialized by `runInPage`: self-contained, never
 * throws). Fills the title and body the way a user would, then clicks the editor's own "save
 * draft" button, so the creator center writes the draft in its own format. It only ever clicks
 * draft-saving controls; anything mentioning publishing is excluded by construction.
 */
export async function fillAndSaveDraft(input: FillDraftInput): Promise<PageResult<null>> {
  const fail = (error: string): PageResult<null> => ({ ok: false, error });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + input.timeoutMs;
  const compact = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, '');

  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  /** Innermost visible elements whose text matches, so wrappers don't count as the control. */
  const findAll = (pattern: RegExp): HTMLElement[] => {
    const matches = [
      ...document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span'),
    ]
      .filter((el) => isVisible(el) && pattern.test(compact(el.textContent)))
      .filter((el) => !/发布/.test(compact(el.textContent)));
    return matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
  };
  /** The control itself: its buttons ignore clicks dispatched on their inner text spans. */
  const findControl = (pattern: RegExp): HTMLElement | undefined => {
    const [match] = findAll(pattern);
    return match?.closest<HTMLElement>('button, [role="button"], a') ?? match;
  };
  /**
   * The editor keeps H1/H2, quotes and lists but flattens code blocks and tables into a single
   * line and drops deeper headings, so hand it one paragraph per line or row and H2 headings.
   */
  const adaptHtml = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const paragraph = (text: string) => {
      const p = doc.createElement('p');
      p.textContent = text;
      return p;
    };
    for (const pre of doc.querySelectorAll('pre')) {
      const lines = (pre.textContent ?? '').replace(/\n$/, '').split('\n');
      // Leading spaces would be collapsed; non-breaking spaces keep the indentation.
      pre.replaceWith(
        ...lines.map((line) => paragraph(line.replace(/^ +/, (s) => ' '.repeat(s.length)))),
      );
    }
    for (const table of doc.querySelectorAll('table')) {
      table.replaceWith(
        ...[...table.rows].map((row) =>
          paragraph([...row.cells].map((cell) => (cell.textContent ?? '').trim()).join(' | ')),
        ),
      );
    }
    for (const heading of doc.querySelectorAll('h3, h4, h5, h6')) {
      const h2 = doc.createElement('h2');
      h2.append(...heading.childNodes);
      heading.replaceWith(h2);
    }
    return doc.body.innerHTML;
  };
  const SAVED = /(保存成功|已保存|已存草稿|已存入草稿箱|草稿已保存)/;
  const findTitle = (): HTMLInputElement | HTMLTextAreaElement | HTMLElement | undefined =>
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'input[placeholder*="标题"], textarea[placeholder*="标题"]',
    ) ??
    document.querySelector<HTMLElement>(
      '[contenteditable="true"][data-placeholder*="标题"], [contenteditable="true"][placeholder*="标题"]',
    ) ??
    undefined;
  const findBody = (title: Element | undefined): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[contenteditable="true"]')]
      .filter((el) => el !== title && !el.contains(title ?? null) && isVisible(el))
      .sort((a, b) => {
        const area = (el: HTMLElement) => el.offsetWidth * el.offsetHeight;
        return area(b) - area(a);
      })[0];

  try {
    // The page opens on a landing view: "新的创作" opens the editor, and the "写长文" tab leads to
    // it from another tab. Retry, since a click made before the page is interactive is lost.
    let lastEntryClick = 0;
    let title = findTitle();
    let body = findBody(title);
    while (!(title && body) && Date.now() < deadline) {
      if (Date.now() - lastEntryClick > 1500) {
        const entry = findControl(/^(新的创作|新建长文|开始创作)$/) ?? findControl(/^写长文$/);
        if (entry) {
          entry.click();
          lastEntryClick = Date.now();
        }
      }
      await sleep(300);
      title = findTitle();
      body = findBody(title);
    }
    if (!title || !body)
      return fail('小红书长文编辑器没有加载出标题或正文输入框，请确认已登录创作者中心');

    if (title instanceof HTMLInputElement || title instanceof HTMLTextAreaElement) {
      // Frameworks track the value through the native setter; assigning `.value` alone is ignored.
      const proto = title instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(title, input.title);
      title.dispatchEvent(new Event('input', { bubbles: true }));
      title.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      title.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, input.title);
    }

    body.focus();
    const html = adaptHtml(input.html);
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', input.text);
    body.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
    await sleep(600);
    const probe = compact(input.text).slice(0, 12);
    if (probe && !compact(body.textContent).includes(probe)) {
      // Editors without a paste handler still accept a plain HTML insertion.
      document.execCommand('insertHTML', false, html);
      await sleep(400);
    }
    if (probe && !compact(body.textContent).includes(probe))
      return fail('正文没有成功写入小红书编辑器');

    const save = findControl(/^(存草稿|保存草稿|存为草稿|暂存离开)$/);
    if (!save) return fail('没有找到小红书编辑器的“存草稿”按钮');
    const startUrl = location.href;
    // An autosave indicator may already say "已保存"; only a newly shown message counts.
    const shownBefore = new Set(findAll(SAVED));
    save.click();

    const saveDeadline = Date.now() + 10_000;
    while (Date.now() < saveDeadline) {
      await sleep(300);
      const confirmed = findAll(SAVED).some((el) => !shownBefore.has(el));
      if (confirmed || location.href !== startUrl) {
        // Give the page time to finish writing the draft before the tab is closed.
        await sleep(1000);
        return { ok: true, value: null };
      }
    }
    return fail('已点击“存草稿”，但没有确认保存成功，请到小红书草稿箱查看，避免重复保存');
  } catch (error) {
    return fail(`操作小红书编辑器时出错：${String(error)}`);
  }
}
