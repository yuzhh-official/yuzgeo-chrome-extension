import type { ParsedDocument } from '@yuzgeo/core';
import { collectImageUrls, isExternalRef, resolveAssetPath } from '@yuzgeo/core';
import { putAsset } from '@/lib/assets';

/** A picked folder or set of files, addressed by `/`-separated paths relative to its root. */
export interface LocalSource {
  name: string;
  markdownFiles: string[];
  readFile(path: string): Promise<File | null>;
}

const MARKDOWN = /\.(md|markdown)$/i;
const SKIPPED_DIRS = new Set(['node_modules', '.git']);
const MAX_ENTRIES = 10_000;

export async function fromDirectory(root: FileSystemDirectoryHandle): Promise<LocalSource> {
  const handles = new Map<string, FileSystemFileHandle>();

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const entry of dir.values()) {
      if (handles.size >= MAX_ENTRIES) return;
      const path = prefix + entry.name;
      if (entry.kind === 'file') handles.set(path, entry as FileSystemFileHandle);
      else if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await walk(entry as FileSystemDirectoryHandle, `${path}/`);
      }
    }
  }
  await walk(root, '');

  return {
    name: root.name,
    markdownFiles: [...handles.keys()].filter((p) => MARKDOWN.test(p)).sort(),
    readFile: async (path) => (await handles.get(path)?.getFile()) ?? null,
  };
}

/** Loose files have no directory around them, so relative images can only match sibling picks. */
export function fromFiles(files: File[]): LocalSource {
  const byName = new Map(files.map((file) => [file.name, file]));
  return {
    name: files.length === 1 ? files[0]!.name : `${files.length} 个文件`,
    markdownFiles: [...byName.keys()].filter((p) => MARKDOWN.test(p)).sort(),
    readFile: async (path) => byName.get(path) ?? null,
  };
}

export interface LocalImages {
  local: string[];
  missing: string[];
}

/** Lists the local images a document references (cover included) and which of them are missing. */
export async function inspectImages(
  source: LocalSource,
  filePath: string,
  doc: ParsedDocument,
): Promise<LocalImages> {
  const refs = [
    ...collectImageUrls(doc.markdown),
    ...(doc.frontMatter.cover ? [doc.frontMatter.cover] : []),
  ];
  const local: string[] = [];
  const missing: string[] = [];
  for (const ref of new Set(refs)) {
    if (isExternalRef(ref)) continue;
    const path = resolveAssetPath(filePath, ref);
    if (path && (await source.readFile(path))) local.push(path);
    else missing.push(ref);
  }
  return { local, missing };
}

/** Copies the given local images into the extension's asset store for the background worker. */
export async function storeAssets(
  source: LocalSource,
  paths: string[],
): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  for (const path of paths) {
    const file = await source.readFile(path);
    if (file) assets[path] = await putAsset(file);
  }
  return assets;
}
