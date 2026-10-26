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

/** Select Markdown files only; image files are ignored. */
export function fromFiles(files: File[]): LocalSource {
  files = files.filter((file) => MARKDOWN.test(file.name));
  const byName = new Map(files.map((file) => [file.name, file]));
  return {
    name: files.length === 1 ? files[0]!.name : `${files.length} 个文件`,
    markdownFiles: [...byName.keys()].filter((p) => MARKDOWN.test(p)).sort(),
    readFile: async (path) => byName.get(path) ?? null,
  };
}
