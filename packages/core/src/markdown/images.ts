import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

interface ImageRef {
  url: string;
  start: number;
  end: number;
  /** Raw HTML `<img>` refs are rewritten inside the HTML source rather than as markdown nodes. */
  kind: 'markdown' | 'html';
}

const HTML_IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;

function findImageRefs(markdown: string): ImageRef[] {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown) as Root;
  const refs: ImageRef[] = [];

  visit(tree, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;

    if ((node.type === 'image' || node.type === 'definition') && node.url) {
      refs.push({ url: node.url, start, end, kind: 'markdown' });
    } else if (node.type === 'html') {
      for (const match of node.value.matchAll(HTML_IMG_SRC)) {
        const url = match[2];
        if (url) refs.push({ url, start, end, kind: 'html' });
      }
    }
  });
  return refs;
}

/** Returns every distinct image URL referenced by markdown images, definitions and raw `<img>`. */
export function collectImageUrls(markdown: string): string[] {
  return [...new Set(findImageRefs(markdown).map((ref) => ref.url))];
}

/**
 * Replaces image URLs according to `replacements` without re-serializing the document, so the
 * author's markdown style is preserved byte for byte outside the rewritten URLs.
 */
export function rewriteImageUrls(markdown: string, replacements: Map<string, string>): string {
  const refs = findImageRefs(markdown).filter((ref) => replacements.has(ref.url));
  // Rewrite each source range once, last range first so earlier offsets stay valid.
  const ranges = new Map<number, { end: number; urls: Set<string> }>();
  for (const ref of refs) {
    const range = ranges.get(ref.start) ?? { end: ref.end, urls: new Set<string>() };
    range.urls.add(ref.url);
    ranges.set(ref.start, range);
  }

  let output = markdown;
  for (const [start, { end, urls }] of [...ranges].sort((a, b) => b[0] - a[0])) {
    let slice = output.slice(start, end);
    for (const url of urls) slice = replaceUrl(slice, url, replacements.get(url)!);
    output = output.slice(0, start) + slice + output.slice(end);
  }
  return output;
}

function replaceUrl(source: string, url: string, next: string): string {
  // The node's URL is decoded; the source may hold the raw or the percent-encoded form.
  for (const candidate of [url, encodeURI(url)]) {
    const index = source.lastIndexOf(candidate);
    if (index !== -1) return source.slice(0, index) + next + source.slice(index + candidate.length);
  }
  return source;
}
