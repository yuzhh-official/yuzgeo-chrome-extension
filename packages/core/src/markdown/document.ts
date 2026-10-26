import type { Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';
import type { FrontMatter, ParsedDocument } from '../post';

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits off YAML front-matter. Invalid YAML throws, since silently dropping it would lose the title. */
export function splitFrontMatter(text: string): { frontMatter: FrontMatter; body: string } {
  const source = text.replace(/^\uFEFF/, '');
  const match = FRONT_MATTER.exec(source);
  if (!match) return { frontMatter: {}, body: source };

  const data: unknown = parseYaml(match[1] ?? '');
  return { frontMatter: normalizeFrontMatter(data), body: source.slice(match[0].length) };
}

function normalizeFrontMatter(data: unknown): FrontMatter {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const raw = data as Record<string, unknown>;
  const fm: FrontMatter = {};

  if (typeof raw.title === 'string' && raw.title.trim()) fm.title = raw.title.trim();
  const summary = raw.summary ?? raw.description;
  if (typeof summary === 'string' && summary.trim()) fm.summary = summary.trim();
  if (typeof raw.cover === 'string' && raw.cover.trim()) fm.cover = raw.cover.trim();

  const tags = raw.tags;
  if (Array.isArray(tags)) fm.tags = tags.map(String).filter(Boolean);
  else if (typeof tags === 'string')
    fm.tags = tags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);

  if (raw.platforms && typeof raw.platforms === 'object' && !Array.isArray(raw.platforms)) {
    fm.platforms = raw.platforms as FrontMatter['platforms'];
  }
  return fm;
}

/**
 * Parses a markdown file into title, body and front-matter. The title comes from front-matter,
 * else from a leading H1 (which is then removed from the body), else from `fallbackTitle`.
 */
export function parseDocument(text: string, fallbackTitle = ''): ParsedDocument {
  const { frontMatter, body } = splitFrontMatter(text);
  let markdown = body;
  let title = frontMatter.title;

  const tree = unified().use(remarkParse).parse(body) as Root;
  const first = tree.children[0];
  if (first?.type === 'heading' && first.depth === 1) {
    const end = first.position?.end.offset;
    if (!title) title = toString(first).trim();
    // Drop the H1 either way when it duplicates the title, so it isn't rendered twice.
    if (end !== undefined && toString(first).trim() === title) {
      markdown = body.slice(end).replace(/^\s*\n/, '');
    }
  }

  return { title: title || fallbackTitle, markdown, frontMatter };
}
