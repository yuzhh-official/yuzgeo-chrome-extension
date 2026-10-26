import type { HtmlRenderOptions } from '@yuzgeo/core';
import { escapeHtml } from '@yuzgeo/core';

/** Zhihu renders formulas server-side as images; the editor recognises them by `eeimg`. */
export const ZHIHU_EQUATION_URL = 'https://www.zhihu.com/equation?tex=';

export function zhihuMath(tex: string, display: boolean): string {
  const img = `<img eeimg="1" src="${ZHIHU_EQUATION_URL}${encodeURIComponent(tex)}" alt="${escapeHtml(tex)}">`;
  return display ? `<p>${img}</p>` : img;
}

/** Zhihu's editor reads the language from `lang` on `<pre>`, not from a `language-*` class. */
export function zhihuCodeBlock(code: string, lang: string | undefined): string {
  const attr = lang ? ` lang="${escapeHtml(lang)}"` : '';
  return `<pre${attr}><code>${escapeHtml(code)}</code></pre>`;
}

export const zhihuHtmlOptions: HtmlRenderOptions = { math: zhihuMath, codeBlock: zhihuCodeBlock };
