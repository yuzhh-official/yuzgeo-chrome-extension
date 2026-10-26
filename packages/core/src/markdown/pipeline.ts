import type { ContentFormat, PlatformId } from '../platforms';
import type { ParsedDocument, RenderedPost } from '../post';
import { collectImageUrls, rewriteImageUrls } from './images';
import type { HtmlRenderOptions } from './render';
import { renderHtml } from './render';

export interface PrepareOptions {
  platform: PlatformId;
  format: ContentFormat;
  html?: HtmlRenderOptions;
  /** Loads an image ref (local path, data URI or remote URL); `null` keeps the original ref. */
  resolveImage(ref: string): Promise<Blob | null>;
  /** Uploads one image to the platform and returns its URL there. */
  uploadImage(image: Blob): Promise<string>;
  warn(message: string): void;
  onStep?(step: string): void;
}

/**
 * Turns a parsed document into a platform-ready post: every image (and the cover) is uploaded to
 * the platform's image host once, refs are rewritten, and the body is rendered in the platform's
 * format. A failed image is reported through `warn` and keeps its original ref.
 */
export async function preparePost(
  doc: ParsedDocument,
  options: PrepareOptions,
): Promise<RenderedPost> {
  const upload = createUploader(options);

  const refs = collectImageUrls(doc.markdown);
  const replacements = new Map<string, string>();
  for (const [index, ref] of refs.entries()) {
    options.onStep?.(`上传图片 ${index + 1}/${refs.length}`);
    const url = await upload(ref);
    if (url) replacements.set(ref, url);
  }

  let coverUrl: string | undefined;
  if (doc.frontMatter.cover) {
    options.onStep?.('上传封面');
    coverUrl = (await upload(doc.frontMatter.cover)) ?? undefined;
  }

  const markdown = rewriteImageUrls(doc.markdown, replacements);
  const body = options.format === 'html' ? renderHtml(markdown, options.html) : markdown;
  const extra = doc.frontMatter.platforms?.[options.platform] ?? {};

  return {
    title: doc.title,
    summary: doc.frontMatter.summary,
    tags: doc.frontMatter.tags ?? [],
    coverUrl,
    body,
    markdown,
    extra,
  };
}

/** Uploads each ref at most once, and identical image bytes at most once even under different refs. */
function createUploader(options: PrepareOptions) {
  const byRef = new Map<string, Promise<string | null>>();
  const byHash = new Map<string, Promise<string>>();

  async function uploadRef(ref: string): Promise<string | null> {
    let blob: Blob | null;
    try {
      blob = await options.resolveImage(ref);
    } catch (error) {
      options.warn(`读取图片失败，保留原链接：${ref}（${errorMessage(error)}）`);
      return null;
    }
    if (!blob) {
      options.warn(`找不到图片，保留原链接：${ref}`);
      return null;
    }

    const hash = await sha256(blob);
    let pending = byHash.get(hash);
    if (!pending) {
      pending = options.uploadImage(blob);
      byHash.set(hash, pending);
    }
    try {
      return await pending;
    } catch (error) {
      options.warn(`上传图片失败，保留原链接：${ref}（${errorMessage(error)}）`);
      return null;
    }
  }

  return (ref: string) => {
    let pending = byRef.get(ref);
    if (!pending) {
      pending = uploadRef(ref);
      byRef.set(ref, pending);
    }
    return pending;
  };
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
