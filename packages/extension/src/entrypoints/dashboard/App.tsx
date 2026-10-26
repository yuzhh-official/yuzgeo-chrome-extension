import type { ParsedDocument, PlatformId, PlatformStatus, SyncTask } from '@yuzgeo/core';
import { errorMessage, parseDocument, PLATFORMS, renderHtml, rewriteImageUrls } from '@yuzgeo/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '@/lib/messaging';
import type { LocalImages, LocalSource } from './source';
import { fromDirectory, fromFiles, inspectImages, storeAssets } from './source';

const SELECTION_KEY = 'yuzgeo:selected-platforms';

interface OpenDocument {
  path: string;
  raw: string;
  doc: ParsedDocument;
  images: LocalImages;
}

export default function App() {
  const [source, setSource] = useState<LocalSource | null>(null);
  const [open, setOpen] = useState<OpenDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<PlatformId>>(loadSelection);

  const openFile = useCallback(async (src: LocalSource, path: string) => {
    setError(null);
    try {
      const file = await src.readFile(path);
      if (!file) throw new Error(`读取失败：${path}`);
      const raw = await file.text();
      const doc = parseDocument(raw, file.name.replace(/\.(md|markdown)$/i, ''));
      setOpen({ path, raw, doc, images: await inspectImages(src, path, doc) });
    } catch (e) {
      setOpen(null);
      setError(`解析 ${path} 失败：${errorMessage(e)}`);
    }
  }, []);

  const openSource = useCallback(
    (src: LocalSource) => {
      setSource(src);
      setOpen(null);
      setTaskId(null);
      const first = src.markdownFiles[0];
      if (first) void openFile(src, first);
      else setError('没有找到 Markdown 文件');
    },
    [openFile],
  );

  const pickDirectory = async () => {
    try {
      openSource(await fromDirectory(await window.showDirectoryPicker({ id: 'yuzgeo' })));
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(errorMessage(e));
    }
  };

  const togglePlatform = (id: PlatformId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveSelection(next);
      return next;
    });
  };

  const submit = async (platforms: PlatformId[]) => {
    if (!source || !open) return;
    setSubmitting(true);
    setError(null);
    try {
      const assets = await storeAssets(source, open.images.local);
      const { taskId } = await request('drafts/create', {
        markdown: open.raw,
        filePath: open.path,
        assets,
        platforms,
      });
      setTaskId(taskId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl p-6 font-sans text-gray-900">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">yuzgeo</h1>
        <p className="text-sm text-gray-500">本地 Markdown → 多平台草稿</p>
      </header>

      <section className="mt-6 flex flex-wrap items-center gap-3">
        <button className={buttonClass} onClick={pickDirectory}>
          选择文件夹
        </button>
        <label className={`${buttonClass} cursor-pointer`}>
          选择文件
          <input
            type="file"
            accept=".md,.markdown,image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) openSource(fromFiles(files));
              e.target.value = '';
            }}
          />
        </label>
        {source && <span className="text-sm text-gray-600">已打开：{source.name}</span>}
      </section>
      <p className="mt-2 text-xs text-gray-500">
        选择文件夹才能自动带上相对路径引用的本地图片；单选文件时可同时多选需要的图片。
      </p>

      {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {source && source.markdownFiles.length > 1 && (
        <select
          className="mt-4 w-full rounded border border-gray-300 p-2 text-sm"
          value={open?.path ?? ''}
          onChange={(e) => {
            setTaskId(null);
            void openFile(source, e.target.value);
          }}
        >
          {source.markdownFiles.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </select>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
        <div>{open ? <DocumentPreview source={source!} open={open} /> : <EmptyState />}</div>
        <aside className="space-y-6">
          <PlatformPicker selected={selected} onToggle={togglePlatform} />
          <button
            className={`${primaryButtonClass} w-full`}
            disabled={!open || selected.size === 0 || submitting}
            onClick={() => submit([...selected])}
          >
            {submitting ? '提交中…' : `保存为草稿（${selected.size} 个平台）`}
          </button>
          {taskId && <TaskProgress taskId={taskId} onRetry={submit} />}
        </aside>
      </div>

      <TaskHistory refreshKey={taskId} />
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded border border-dashed border-gray-300 p-10 text-center text-gray-500">
      选择一个包含 Markdown 的文件夹或文件开始
    </div>
  );
}

function DocumentPreview({ source, open }: { source: LocalSource; open: OpenDocument }) {
  const { doc, images } = open;
  const [html, setHtml] = useState('');

  useEffect(() => {
    // Local images are shown through object URLs; the preview runs in a script-less sandbox.
    const urls: string[] = [];
    let cancelled = false;
    void (async () => {
      const replacements = new Map<string, string>();
      for (const path of images.local) {
        const file = await source.readFile(path);
        if (!file) continue;
        const url = URL.createObjectURL(file);
        urls.push(url);
        for (const ref of refsFor(open, path)) replacements.set(ref, url);
      }
      if (!cancelled) setHtml(renderHtml(rewriteImageUrls(doc.markdown, replacements)));
    })();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [source, open, doc, images]);

  const srcDoc = useMemo(
    () =>
      `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.7 system-ui,sans-serif;margin:16px;color:#111}img{max-width:100%}pre{background:#f5f5f5;padding:12px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}</style>${html}`,
    [html],
  );

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">{doc.title || '（无标题）'}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {doc.frontMatter.summary && <Field label="摘要" value={doc.frontMatter.summary} />}
        {doc.frontMatter.tags?.length ? (
          <Field label="标签" value={doc.frontMatter.tags.join('、')} />
        ) : null}
        {doc.frontMatter.cover && <Field label="封面" value={doc.frontMatter.cover} />}
        <Field label="本地图片" value={`${images.local.length} 张`} />
      </dl>
      {images.missing.length > 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          以下图片找不到，将保留原链接：{images.missing.join('、')}
        </p>
      )}
      <iframe
        title="预览"
        sandbox=""
        srcDoc={srcDoc}
        className="h-[60vh] w-full rounded border border-gray-200 bg-white"
      />
    </div>
  );
}

/** The original refs in the document that resolve to `path`, for swapping in preview URLs. */
function refsFor(open: OpenDocument, path: string): string[] {
  const all = [
    ...open.doc.markdown.matchAll(/!\[[^\]]*\]\(<?([^)\s>]+)>?|src=["']([^"']+)["']/g),
  ].map((m) => m[1] ?? m[2] ?? '');
  const name = path.split('/').pop() ?? path;
  return all.filter((ref) => decodeURI(ref.split(/[?#]/)[0] ?? '').endsWith(name));
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}

function PlatformPicker({
  selected,
  onToggle,
}: {
  selected: Set<PlatformId>;
  onToggle(id: PlatformId): void;
}) {
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    (forceRefresh: boolean) =>
      request('platforms/list', { forceRefresh })
        .then(setPlatforms)
        .finally(() => setLoading(false)),
    [],
  );
  const refresh = () => {
    setLoading(true);
    void load(true);
  };

  useEffect(() => {
    void load(false);
    // Coming back from a platform's login page should pick up the new session.
    const onFocus = () => void load(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">目标平台</h2>
        <button
          className="text-sm text-blue-600 disabled:text-gray-400"
          disabled={loading}
          onClick={refresh}
        >
          {loading ? '检查中…' : '刷新登录状态'}
        </button>
      </div>
      <ul className="mt-2 space-y-2">
        {platforms?.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded border border-gray-200 p-2"
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                disabled={!p.loggedIn}
                onChange={() => onToggle(p.id)}
              />
              <span>{p.name}</span>
            </label>
            {p.loggedIn ? (
              <span className="text-xs text-green-700">{p.username ?? '已登录'}</span>
            ) : (
              <a
                className="text-xs text-blue-600"
                href={p.homepage}
                target="_blank"
                rel="noreferrer"
                title={p.error}
              >
                {p.error ? '检查失败' : '去登录'}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_TEXT = {
  pending: '等待中',
  running: '进行中',
  succeeded: '已保存草稿',
  failed: '失败',
} as const;

function TaskProgress({
  taskId,
  onRetry,
}: {
  taskId: string;
  onRetry(platforms: PlatformId[]): void;
}) {
  const [task, setTask] = useState<SyncTask | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const next = await request('tasks/get', { taskId });
      if (stopped) return;
      setTask(next);
      const done = next?.results.every((r) => r.status === 'succeeded' || r.status === 'failed');
      if (!done) timer.current = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer.current);
    };
  }, [taskId]);

  if (!task) return null;
  const failed = task.results.filter((r) => r.status === 'failed').map((r) => r.platform);

  return (
    <div className="space-y-2">
      <h2 className="font-medium">同步进度</h2>
      {task.results.map((r) => (
        <div key={r.platform} className="rounded border border-gray-200 p-2 text-sm">
          <div className="flex justify-between">
            <span>{PLATFORMS[r.platform].name}</span>
            <span
              className={
                r.status === 'failed'
                  ? 'text-red-600'
                  : r.status === 'succeeded'
                    ? 'text-green-700'
                    : ''
              }
            >
              {r.step ?? STATUS_TEXT[r.status]}
            </span>
          </div>
          {r.draft && (
            <a className="text-blue-600" href={r.draft.draftUrl} target="_blank" rel="noreferrer">
              打开草稿 →
            </a>
          )}
          {r.error && <p className="mt-1 text-red-600">{r.error}</p>}
          {r.warnings.map((w) => (
            <p key={w} className="mt-1 text-amber-700">
              {w}
            </p>
          ))}
        </div>
      ))}
      {failed.length > 0 && (
        <button className={`${buttonClass} w-full`} onClick={() => onRetry(failed)}>
          重试失败的平台
        </button>
      )}
    </div>
  );
}

function TaskHistory({ refreshKey }: { refreshKey: string | null }) {
  const [tasks, setTasks] = useState<SyncTask[]>([]);

  useEffect(() => {
    request('tasks/list', {}).then(setTasks, () => setTasks([]));
  }, [refreshKey]);

  if (tasks.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="font-medium">历史记录</h2>
      <table className="mt-2 w-full text-left text-sm">
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t border-gray-100 align-top">
              <td className="py-2 pr-4 whitespace-nowrap text-gray-500">
                {new Date(task.createdAt).toLocaleString()}
              </td>
              <td className="py-2 pr-4">{task.title}</td>
              <td className="py-2">
                {task.results.map((r) =>
                  r.draft ? (
                    <a
                      key={r.platform}
                      className="mr-3 text-blue-600"
                      href={r.draft.draftUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {PLATFORMS[r.platform].name}
                    </a>
                  ) : (
                    <span key={r.platform} className="mr-3 text-gray-400" title={r.error}>
                      {PLATFORMS[r.platform].name}（{STATUS_TEXT[r.status]}）
                    </span>
                  ),
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const buttonClass = 'rounded border border-gray-300 bg-white px-4 py-2 text-sm hover:bg-gray-50';
const primaryButtonClass =
  'rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300';

function loadSelection(): Set<PlatformId> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '[]') as PlatformId[]);
  } catch {
    return new Set();
  }
}

function saveSelection(selection: Set<PlatformId>) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...selection]));
  } catch {
    // Remembering the selection is a convenience only.
  }
}
