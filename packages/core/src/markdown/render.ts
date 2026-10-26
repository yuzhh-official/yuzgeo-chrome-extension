import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/** Hooks for platforms whose editors expect specific HTML for math or code. Each returns raw HTML. */
export interface HtmlRenderOptions {
  math?(tex: string, display: boolean): string;
  codeBlock?(code: string, lang: string | undefined): string;
}

interface ValueNode {
  value: string;
  lang?: string | null;
}

type RawHandler = (state: unknown, node: ValueNode) => { type: 'raw'; value: string };

/** Renders markdown (GFM + `$` math, raw HTML passed through) to an HTML fragment. */
export function renderHtml(markdown: string, options: HtmlRenderOptions = {}): string {
  const handlers: Record<string, RawHandler> = {};
  const { math, codeBlock } = options;
  if (math) {
    handlers.math = (_, node) => ({ type: 'raw', value: math(node.value, true) });
    handlers.inlineMath = (_, node) => ({ type: 'raw', value: math(node.value, false) });
  }
  if (codeBlock) {
    handlers.code = (_, node) => ({
      type: 'raw',
      value: codeBlock(node.value, node.lang ?? undefined),
    });
  }

  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    // The handler signature is mdast-util-to-hast's; its types are a transitive dependency.
    .use(remarkRehype, { allowDangerousHtml: true, handlers: handlers as never })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .processSync(markdown);
  return String(file);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
