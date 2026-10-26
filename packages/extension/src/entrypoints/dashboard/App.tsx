import type { ParsedDocument, PlatformId, PlatformStatus, SyncTask } from '@yuzgeo/core';
import { errorMessage, parseDocument, PLATFORMS, textOnlyMarkdown } from '@yuzgeo/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '@/lib/messaging';
import type { LocalSource } from './source';
import { fromDirectory, fromFiles } from './source';
import { renderPreview } from './preview';

const SELECTION_KEY = 'yuzgeo:selected-platforms';

interface OpenDocument {
  path: string;
  raw: string;
  doc: ParsedDocument;
}

export default function App() {
  const [source, setSource] = useState<LocalSource | null>(null);
  const [open, setOpen] = useState<OpenDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);
  const readId = useRef(0);
  const [selected, setSelected] = useState<Set<PlatformId>>(loadSelection);

  const openFile = useCallback(async (src: LocalSource, path: string) => {
    const id = ++readId.current;
    setError(null);
    setOpen(null);
    setReading(true);
    try {
      const file = await src.readFile(path);
      if (!file) throw new Error(`读取失败：${path}`);
      const raw = await file.text();
      if (!raw.trim()) throw new Error('文件内容为空，请确认 Markdown 已保存后重新选择');
      const parsed = parseDocument(raw, file.name.replace(/\.(md|markdown)$/i, ''));
      const doc = { ...parsed, markdown: textOnlyMarkdown(parsed.markdown) };
      if (!doc.markdown.trim())
        throw new Error('去除图片后没有可同步的正文，请补充内容并保存后重新选择');
      if (id !== readId.current) return;
      setOpen({ path, raw, doc });
    } catch (e) {
      if (id === readId.current) {
        setOpen(null);
        setError(`解析 ${path} 失败：${errorMessage(e)}`);
      }
    } finally {
      if (id === readId.current) setReading(false);
    }
  }, []);

  const openSource = useCallback(
    (src: LocalSource) => {
      ++readId.current;
      setSource(src);
      setOpen(null);
      setTaskId(null);
      const first = src.markdownFiles[0];
      if (first) void openFile(src, first);
      else {
        setReading(false);
        setError('没有找到 Markdown 文件');
      }
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
    if (!open) return;
    setSubmitting(true);
    setError(null);
    try {
      const { taskId } = await request('drafts/create', {
        markdown: open.raw,
        filePath: open.path,
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
            accept=".md,.markdown"
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
        当前仅同步 Markdown 文字内容：保留排版和图片说明，跳过图片与封面；本地原文件不会修改。
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

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
        <div>
          {reading ? (
            <p role="status">正在读取 Markdown…</p>
          ) : open ? (
            <DocumentPreview open={open} />
          ) : (
            <EmptyState />
          )}
        </div>
        <aside className="space-y-6">
          <PlatformPicker selected={selected} onToggle={togglePlatform} />
          <button
            className={`${primaryButtonClass} w-full`}
            disabled={!open || selected.size === 0 || submitting}
            onClick={() => submit([...selected])}
          >
            {submitting ? '提交中…' : `保存为草稿（${selected.size} 个平台）`}
          </button>
          {taskId && <TaskProgress key={taskId} taskId={taskId} onRetry={submit} />}
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

function DocumentPreview({ open }: { open: OpenDocument }) {
  const { doc } = open;
  const [showSource, setShowSource] = useState(false);
  const rendered = useMemo(() => {
    try {
      return { html: renderPreview(doc.markdown), error: null };
    } catch (e) {
      return { html: '', error: `预览生成失败：${errorMessage(e)}。请查看 Markdown 原文。` };
    }
  }, [doc.markdown]);

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">{doc.title || '（无标题）'}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {doc.frontMatter.summary && <Field label="摘要" value={doc.frontMatter.summary} />}
        {doc.frontMatter.tags?.length ? (
          <Field label="标签" value={doc.frontMatter.tags.join('、')} />
        ) : null}
        <Field label="正文" value={`${doc.markdown.length} 字符`} />
      </dl>
      {rendered.error && (
        <p role="alert" className="text-sm text-red-700">
          {rendered.error}
        </p>
      )}
      <button className={buttonClass} onClick={() => setShowSource(!showSource)}>
        {showSource ? '返回预览' : '查看 Markdown 原文'}
      </button>
      {showSource || rendered.error ? (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 p-4 text-sm">
          {open.raw}
        </pre>
      ) : (
        <article
          aria-label="正文预览"
          className="markdown-preview max-h-[60vh] overflow-auto rounded border border-gray-200 bg-white p-4"
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      )}
    </div>
  );
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (forceRefresh: boolean) =>
      request('platforms/list', { forceRefresh })
        .then((next) => {
          setPlatforms(next);
          setError(null);
        })
        .catch((e: unknown) => {
          setPlatforms(null);
          setError(errorMessage(e));
        })
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
      {error && (
        <p role="alert" className="mt-2 rounded bg-red-50 p-3 text-sm text-red-700">
          平台列表加载失败：{error}
        </p>
      )}
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
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const next = await request('tasks/get', { taskId });
        if (stopped) return;
        if (!next) throw new Error('未找到该同步任务，请查看历史记录或平台草稿箱');
        setTask(next);
        setError(null);
        const done = next.results.every((r) => r.status === 'succeeded' || r.status === 'failed');
        if (!done) timer.current = window.setTimeout(poll, 1000);
      } catch (e) {
        if (!stopped) setError(errorMessage(e));
      }
    };
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer.current);
    };
  }, [taskId, refreshKey]);

  if (error)
    return (
      <div className="space-y-2">
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          无法查询同步进度：{error}。草稿可能已创建，请先查询结果。
        </p>
        <button className={buttonClass} onClick={() => setRefreshKey((value) => value + 1)}>
          重新查询进度
        </button>
      </div>
    );
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
