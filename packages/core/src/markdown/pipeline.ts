import type { ContentFormat, PlatformId } from '../platforms';
import type { ParsedDocument, RenderedPost } from '../post';
import type { HtmlRenderOptions } from './render';
import { renderHtml } from './render';
import { textOnlyMarkdown } from './text-only';

export interface PrepareOptions {
  platform: PlatformId;
  format: ContentFormat;
  html?: HtmlRenderOptions;
  title?: string;
}

/** Text-only draft preparation: no image reads, downloads, uploads or cover. */
export async function preparePost(
  doc: ParsedDocument,
  options: PrepareOptions,
): Promise<RenderedPost> {
  const markdown = textOnlyMarkdown(doc.markdown);
  const extra = doc.frontMatter.platforms?.[options.platform] ?? {};
  if (!markdown.trim()) throw new Error('去除图片后没有可同步的正文');
  // Keep formulas as text; some platform math hooks generate remote images.
  const body =
    options.format === 'html'
      ? renderHtml(markdown, { codeBlock: options.html?.codeBlock })
      : markdown;
  return {
    title:
      options.title?.trim() ||
      (typeof extra.title === 'string' ? extra.title.trim() : '') ||
      doc.title,
    summary: doc.frontMatter.summary,
    tags: doc.frontMatter.tags ?? [],
    body,
    markdown,
    extra,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
