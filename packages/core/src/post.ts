import type { PlatformId } from './platforms';

/** Fields parsed from a markdown file's front-matter. */
export interface FrontMatter {
  title?: string;
  summary?: string;
  tags?: string[];
  cover?: string;
  /** Per-platform overrides, e.g. `juejin: { category: 前端 }`. */
  platforms?: Partial<Record<PlatformId, Record<string, unknown>>>;
}

/** A local markdown document after front-matter extraction, before platform processing. */
export interface ParsedDocument {
  title: string;
  /** Markdown body without front-matter (and without the leading H1 when it supplied the title). */
  markdown: string;
  frontMatter: FrontMatter;
}

/** The post after rendering for one platform, ready for `createDraft`. */
export interface RenderedPost {
  title: string;
  summary?: string;
  tags: string[];
  coverUrl?: string;
  /** Markdown or HTML, depending on the platform's format. */
  body: string;
  /** The rewritten markdown, available even for HTML platforms. */
  markdown: string;
  /** The platform's front-matter overrides. */
  extra: Record<string, unknown>;
}
