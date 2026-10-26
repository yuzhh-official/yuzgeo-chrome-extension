import type { Root } from 'mdast';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

interface Edit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(source: string, edits: Edit[]): string {
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}

// Escape alt text so it cannot introduce Markdown or HTML of its own.
function literal(text: string): string {
  return text.replace(/[&<>\\`*_[\]!~]/g, (char) => `&#${char.charCodeAt(0)};`);
}

const MEDIA = new Set([
  'img',
  'picture',
  'svg',
  'source',
  'video',
  'audio',
  'object',
  'embed',
  'iframe',
  'style',
]);

/** Removes rendered media from raw HTML without reserializing surrounding text/markup. */
function withoutHtmlImages(html: string): string {
  const tree = parseFragment(html, { sourceCodeLocationInfo: true });
  const edits: Edit[] = [];
  function walk(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node) {
      const loc = node.sourceCodeLocation;
      const imageInput =
        node.tagName === 'input' &&
        node.attrs.some((a) => a.name === 'type' && a.value.toLowerCase() === 'image');
      if (loc && (MEDIA.has(node.tagName) || imageInput)) {
        edits.push({
          start: loc.startOffset,
          end: loc.endOffset,
          text: literal(node.attrs.find((a) => a.name === 'alt')?.value ?? ''),
        });
        return;
      }
      for (const attr of node.attrs) {
        if (!['style', 'background', 'poster'].includes(attr.name)) continue;
        const range = loc?.attrs?.[attr.name];
        if (range) edits.push({ start: range.startOffset, end: range.endOffset, text: '' });
      }
      if ('content' in node) walk(node.content);
    }
    if ('childNodes' in node) node.childNodes.forEach(walk);
  }
  walk(tree);
  return applyEdits(html, edits);
}

/** Keeps article text and formatting; skips images while retaining their alternative text. */
export function textOnlyMarkdown(markdown: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown) as Root;
  const imageRefs = new Set<string>();
  const linkRefs = new Set<string>();
  visit(tree, (node) => {
    if (node.type === 'imageReference') imageRefs.add(node.identifier);
    if (node.type === 'linkReference') linkRefs.add(node.identifier);
  });
  const edits: Edit[] = [];
  visit(tree, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === 'image' || node.type === 'imageReference') {
      edits.push({ start, end, text: literal(node.alt ?? '') });
    } else if (
      node.type === 'definition' &&
      imageRefs.has(node.identifier) &&
      !linkRefs.has(node.identifier)
    ) {
      edits.push({ start, end, text: '' });
    } else if (node.type === 'html') {
      edits.push({ start, end, text: withoutHtmlImages(node.value) });
    }
  });
  return applyEdits(markdown, edits);
}
