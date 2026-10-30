import type { ParsedDocument, PlatformId, PlatformStatus, SyncTask } from '@yuzgeo/core';
import {
  collectImageUrls,
  errorMessage,
  parseDocument,
  PLATFORMS,
  textOnlyMarkdown,
} from '@yuzgeo/core';
import type { ReactNode } from 'react';
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
  /** Images in the original body; they are stripped before syncing. */
  imageCount: number;
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
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [toutiaoTitle, setToutiaoTitle] = useState('');

  const openFile = useCallback(async (src: LocalSource, path: string) => {
    const id = ++readId.current;
    setError(null);
    setOpen(null);
    setTaskId(null);
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
      setOpen({ path, raw, doc, imageCount: collectImageUrls(parsed.markdown).length });
      const platformTitle = doc.frontMatter.platforms?.toutiao?.title;
      setToutiaoTitle(typeof platformTitle === 'string' ? platformTitle : doc.title);
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

  const pickFiles = (files: File[]) => {
    if (files.length) openSource(fromFiles(files));
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

  // Remembered platforms that are now logged out can't be synced; don't count or send them.
  const ready = platforms
    ? platforms.filter((p) => p.loggedIn && selected.has(p.id)).map((p) => p.id)
    : [];

  const submit = async (targets: PlatformId[]) => {
    if (!open) return;
    if (
      targets.includes('toutiao') &&
      ([...toutiaoTitle.trim()].length < 2 || [...toutiaoTitle.trim()].length > 30)
    ) {
      setError('请将“头条号标题”调整为 2–30 字后重试；也可以取消勾选头条号，先同步其他平台。');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { taskId } = await request('drafts/create', {
        markdown: open.raw,
        filePath: open.path,
        platforms: targets,
        ...(targets.includes('toutiao')
          ? { platformTitles: { toutiao: toutiaoTitle.trim() } }
          : {}),
      });
      setTaskId(taskId);
      setHistoryKey((key) => key + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas font-sans text-sm leading-relaxed text-ink">
      <Header onPickDirectory={pickDirectory} onPickFiles={pickFiles} />

      <div className="mx-auto flex max-w-[1440px] flex-wrap gap-5 px-4 py-5 sm:px-8">
        {source && source.markdownFiles.length > 0 && (
          <FileList
            source={source}
            current={open?.path ?? null}
            onOpen={(path) => void openFile(source, path)}
          />
        )}

        <main className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-bad-strong">
              {error}
            </p>
          )}
          {reading ? (
            <Card>
              <p role="status" className="p-6 text-muted">
                正在读取 Markdown…
              </p>
            </Card>
          ) : open ? (
            <DocumentView open={open} platforms={platforms} selected={ready} />
          ) : (
            <EmptyState />
          )}
        </main>

        <aside
          aria-label="同步设置"
          className="flex min-w-[280px] flex-[1_1_300px] flex-col gap-4 lg:max-w-[360px]"
        >
          <Card className="p-4">
            <PlatformPicker
              platforms={platforms}
              onPlatforms={setPlatforms}
              selected={selected}
              onToggle={togglePlatform}
            />
            {open && selected.has('toutiao') && (
              <div className="mt-4 border-t border-line-soft pt-3">
                <label htmlFor="toutiao-title" className="font-medium">
                  头条号标题
                </label>
                <input
                  id="toutiao-title"
                  className="mt-1 w-full rounded-lg border border-control bg-surface px-3 py-2"
                  value={toutiaoTitle}
                  onChange={(event) => setToutiaoTitle(event.target.value)}
                  aria-describedby="toutiao-title-help"
                  aria-invalid={
                    [...toutiaoTitle.trim()].length < 2 || [...toutiaoTitle.trim()].length > 30
                  }
                />
                <p
                  id="toutiao-title-help"
                  className={`mt-1 text-xs ${[...toutiaoTitle.trim()].length < 2 || [...toutiaoTitle.trim()].length > 30 ? 'text-bad' : 'text-muted'}`}
                >
                  {[...toutiaoTitle.trim()].length}/30 字，需 2–30
                  字。只影响头条号，其他平台保留原标题。
                </p>
              </div>
            )}
            <button
              type="button"
              className="mt-3.5 min-h-11 w-full rounded-lg bg-accent font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-control disabled:text-muted"
              disabled={!open || ready.length === 0 || submitting}
              onClick={() => submit(ready)}
            >
              {submitting ? '提交中…' : `保存为草稿（${ready.length} 个平台）`}
            </button>
            <p className="mt-2 text-center text-xs text-muted">
              只创建草稿，发布需要你到平台上确认
            </p>
          </Card>
          {taskId && (
            <TaskProgress
              key={taskId}
              taskId={taskId}
              onRetry={submit}
              onSettled={() => setHistoryKey((key) => key + 1)}
            />
          )}
        </aside>

        <TaskHistory refreshKey={historyKey} />
      </div>
    </div>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {children}
    </section>
  );
}

function Header({
  onPickDirectory,
  onPickFiles,
}: {
  onPickDirectory(): void;
  onPickFiles(files: File[]): void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3.5 sm:px-8">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white"
        >
          y
        </div>
        <div className="flex flex-col">
          <h1 className="text-base leading-tight font-bold">yuzgeo</h1>
          <span className="text-xs leading-snug text-muted">本地 Markdown → 多平台草稿</span>
        </div>
      </div>
      <PickButtons onPickDirectory={onPickDirectory} onPickFiles={onPickFiles} />
    </header>
  );
}

function PickButtons({
  onPickDirectory,
  onPickFiles,
}: {
  onPickDirectory(): void;
  onPickFiles(files: File[]): void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={secondaryButtonClass} onClick={onPickDirectory}>
        <FolderIcon />
        选择文件夹
      </button>
      <label
        className={`${secondaryButtonClass} cursor-pointer focus-within:ring-2 focus-within:ring-accent`}
      >
        <FileIcon />
        选择文件
        <input
          type="file"
          accept=".md,.markdown"
          multiple
          className="sr-only"
          onChange={(e) => {
            onPickFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

function FileList({
  source,
  current,
  onOpen,
}: {
  source: LocalSource;
  current: string | null;
  onOpen(path: string): void;
}) {
  return (
    <nav
      aria-label="文章列表"
      className="min-w-[200px] flex-[1_1_220px] self-start rounded-xl border border-line bg-surface p-3 lg:max-w-[260px]"
    >
      <div className="mb-2 flex items-center gap-2 border-b border-line-soft px-2 pt-1 pb-3">
        <FolderIcon className="text-muted" />
        <span className="truncate font-semibold" title={source.name}>
          {source.name}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted">
          {source.markdownFiles.length} 篇
        </span>
      </div>
      <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-auto">
        {source.markdownFiles.map((path) => {
          const active = path === current;
          return (
            <li key={path}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                className={`w-full truncate rounded-lg px-2.5 py-2 text-left ${
                  active
                    ? 'bg-accent-soft font-medium text-accent-strong'
                    : 'text-ink hover:bg-canvas'
                }`}
                title={path}
                onClick={() => onOpen(path)}
              >
                {path}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <FileIcon />
      </div>
      <div>
        <h2 className="text-base font-semibold">从本地文章开始</h2>
        <p className="mt-1 text-muted">
          点右上角“选择文件夹”浏览其中所有 Markdown，或“选择文件”只打开一篇。本地原文件不会被修改。
        </p>
      </div>
    </Card>
  );
}

type ViewTab = 'preview' | 'source' | 'platforms';

const TABS: { id: ViewTab; label: string }[] = [
  { id: 'preview', label: '预览' },
  { id: 'source', label: 'Markdown 原文' },
  { id: 'platforms', label: '各平台差异' },
];

function DocumentView({
  open,
  platforms,
  selected,
}: {
  open: OpenDocument;
  platforms: PlatformStatus[] | null;
  selected: PlatformId[];
}) {
  const { doc } = open;
  const [tab, setTab] = useState<ViewTab>('preview');
  const rendered = useMemo(() => {
    try {
      return { html: renderPreview(doc.markdown), error: null };
    } catch (e) {
      return { html: '', error: `预览生成失败：${errorMessage(e)}。请查看 Markdown 原文。` };
    }
  }, [doc.markdown]);
  const shown = rendered.error && tab === 'preview' ? 'source' : tab;

  return (
    <>
      <Card className="px-6 py-5">
        <h2 className="text-[22px] leading-snug font-bold">{doc.title || '（无标题）'}</h2>
        {doc.frontMatter.summary && <p className="mt-1.5 text-muted">{doc.frontMatter.summary}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {doc.frontMatter.tags?.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
          <Chip>约 {countWords(doc.markdown)} 字</Chip>
          <Chip>{open.path}</Chip>
        </div>
        {open.imageCount > 0 && (
          <div
            role="note"
            className="mt-4 flex items-start gap-2.5 rounded-lg bg-warn-soft px-3 py-2.5 text-warn"
          >
            <InfoIcon />
            <span>当前只同步文字：本文的 {open.imageCount} 张图片不会上传，草稿中仅保留图注。</span>
          </div>
        )}
        {rendered.error && (
          <p role="alert" className="mt-3 text-bad">
            {rendered.error}
          </p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div
          role="tablist"
          aria-label="预览模式"
          className="flex flex-wrap gap-1 border-b border-line-soft px-3 py-2"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={shown === t.id}
              className={`min-h-9 rounded-md px-3.5 ${
                shown === t.id
                  ? 'bg-accent-soft font-semibold text-accent-strong'
                  : 'text-ink-soft hover:bg-canvas'
              }`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {shown === 'source' ? (
          <pre className="max-h-[70vh] overflow-auto px-6 py-5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
            {open.raw}
          </pre>
        ) : shown === 'platforms' ? (
          <PlatformDifferences platforms={platforms} selected={selected} />
        ) : (
          <article
            aria-label="正文预览"
            className="markdown-preview max-h-[70vh] overflow-auto px-8 pt-6 pb-8"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        )}
      </Card>
    </>
  );
}

/** What each platform's draft will contain, given the current text-only pipeline. */
function PlatformDifferences({
  platforms,
  selected,
}: {
  platforms: PlatformStatus[] | null;
  selected: PlatformId[];
}) {
  const ids = platforms?.map((p) => p.id) ?? [];
  if (ids.length === 0) return <p className="px-6 py-5 text-muted">平台列表加载中…</p>;
  return (
    <ul className="divide-y divide-line-soft">
      {ids.map((id) => {
        const html = PLATFORMS[id].format === 'html';
        return (
          <li key={id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-6 py-3.5">
            <span className="w-36 shrink-0 font-medium">
              {PLATFORMS[id].name}
              {selected.includes(id) && <span className="ml-2 text-xs text-accent">已选</span>}
            </span>
            <span className="min-w-0 flex-1 text-ink-soft">
              {id === 'weixin'
                ? '转换为公众号富文本，链接保留文字；不上传封面。接入待真实账号验证，可能需要在后台补充封面。'
                : id === 'toutiao'
                  ? '由头条编辑器自动保存；标题 2–30 字，代码和表格按行转为段落，不点击发布。'
                  : id === 'sohu'
                    ? '由搜狐编辑器保存：代码按行、表格按行转为段落，公式保留为文本；需账号具备存草稿权限。'
                    : html
                      ? '转换为富文本：代码块按平台编辑器格式，公式保留为文本。'
                      : 'Markdown 原样保存：代码块、表格和公式源码保留。'}
              <span className="text-muted"> 图片不同步，标签需在平台编辑器中确认。</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="max-w-full truncate rounded-full bg-chip px-2.5 py-0.5 text-xs text-ink-soft">
      {children}
    </span>
  );
}

function PlatformPicker({
  platforms,
  onPlatforms,
  selected,
  onToggle,
}: {
  platforms: PlatformStatus[] | null;
  onPlatforms(platforms: PlatformStatus[] | null): void;
  selected: Set<PlatformId>;
  onToggle(id: PlatformId): void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (forceRefresh: boolean) =>
      request('platforms/list', { forceRefresh })
        .then((next) => {
          onPlatforms(next);
          setError(null);
        })
        .catch((e: unknown) => {
          onPlatforms(null);
          setError(errorMessage(e));
        })
        .finally(() => setLoading(false)),
    [onPlatforms],
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
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">目标平台</h2>
        <button
          type="button"
          className="min-h-8 px-2 text-[13px] text-accent hover:text-accent-strong disabled:text-muted"
          disabled={loading}
          onClick={refresh}
        >
          {loading ? '检查中…' : '刷新登录状态'}
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-bad-soft px-3 py-2 text-bad-strong">
          平台列表加载失败：{error}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {platforms?.map((p) => {
          const checked = p.loggedIn && selected.has(p.id);
          return (
            <li
              key={p.id}
              className={`flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 ${
                checked ? 'border-accent-line bg-accent-wash' : 'border-line'
              }`}
            >
              <label
                className={`flex min-w-0 items-center gap-2.5 ${
                  p.loggedIn ? 'cursor-pointer' : 'text-muted'
                }`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={checked}
                  disabled={!p.loggedIn}
                  onChange={() => onToggle(p.id)}
                />
                <span className="truncate">{p.name}</span>
              </label>
              {p.loggedIn ? (
                <span className="truncate text-xs text-ok" title={p.username}>
                  ● {p.username ?? '已登录'}
                </span>
              ) : (
                <a
                  className="shrink-0 text-xs text-accent hover:text-accent-strong"
                  href={p.homepage}
                  target="_blank"
                  rel="noreferrer"
                  title={p.error}
                >
                  {p.error ? '检查失败' : '去登录'}
                </a>
              )}
            </li>
          );
        })}
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

const STATUS_STYLE = {
  pending: { box: 'bg-canvas', text: 'text-ink-soft' },
  running: { box: 'bg-canvas', text: 'text-ink-soft' },
  succeeded: { box: 'bg-ok-soft', text: 'text-ok' },
  failed: { box: 'bg-bad-soft', text: 'text-bad' },
} as const;

function TaskProgress({
  taskId,
  onRetry,
  onSettled,
}: {
  taskId: string;
  onRetry(platforms: PlatformId[]): void;
  /** Called once every platform has finished, so the history shows final results. */
  onSettled(): void;
}) {
  const [task, setTask] = useState<SyncTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

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
        if (done) onSettledRef.current();
        else timer.current = window.setTimeout(poll, 1000);
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
      <Card className="flex flex-col gap-2 p-4">
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-bad-strong">
          无法查询同步进度：{error}。草稿可能已创建，请先查询结果。
        </p>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          重新查询进度
        </button>
      </Card>
    );
  if (!task) return null;
  const failed = task.results.filter((r) => r.status === 'failed').map((r) => r.platform);

  return (
    <Card className="p-4">
      <h2 className="mb-2.5 text-[15px] font-semibold">同步进度</h2>
      <div className="flex flex-col gap-2.5">
        {task.results.map((r) => {
          const style = STATUS_STYLE[r.status];
          const busy = r.status === 'pending' || r.status === 'running';
          return (
            <div key={r.platform} className={`rounded-lg px-3 py-2.5 ${style.box}`}>
              <div className="flex justify-between gap-2">
                <span className="font-medium">{PLATFORMS[r.platform].name}</span>
                <span className={`text-[13px] ${style.text}`}>
                  {r.step ? `${r.step}…` : STATUS_TEXT[r.status]}
                </span>
              </div>
              {busy && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-1 w-1/3 animate-pulse rounded-full bg-accent" />
                </div>
              )}
              {r.draft && (
                <a
                  className="text-[13px] text-accent hover:text-accent-strong"
                  href={r.draft.draftUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开草稿 →
                </a>
              )}
              {r.error && <p className="mt-1 text-[13px] text-bad-strong">{r.error}</p>}
              {r.warnings.map((w) => (
                <p key={w} className="mt-1 text-[13px] text-warn">
                  {w}
                </p>
              ))}
            </div>
          );
        })}
        {failed.length > 0 && (
          <button type="button" className={secondaryButtonClass} onClick={() => onRetry(failed)}>
            重试失败的平台
          </button>
        )}
      </div>
    </Card>
  );
}

function TaskHistory({ refreshKey }: { refreshKey: number }) {
  const [tasks, setTasks] = useState<SyncTask[]>([]);

  useEffect(() => {
    request('tasks/list', {}).then(setTasks, () => setTasks([]));
  }, [refreshKey]);

  if (tasks.length === 0) return null;
  return (
    <Card className="min-w-0 flex-[1_1_100%] px-5 py-4">
      <h2 className="mb-2 text-[15px] font-semibold">历史记录</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="text-muted">
              <th className="py-2 pr-3 font-medium">时间</th>
              <th className="py-2 pr-3 font-medium">文章</th>
              <th className="py-2 font-medium">结果</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className="border-t border-line-soft align-top">
                <td className="py-2.5 pr-3 whitespace-nowrap text-muted">
                  {new Date(task.createdAt).toLocaleString()}
                </td>
                <td className="py-2.5 pr-3">{task.title}</td>
                <td className="py-2.5">
                  {task.results.map((r) =>
                    r.draft ? (
                      <a
                        key={r.platform}
                        className="mr-3 text-accent hover:text-accent-strong"
                        href={r.draft.draftUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {PLATFORMS[r.platform].name}
                      </a>
                    ) : (
                      <span
                        key={r.platform}
                        className={`mr-3 ${r.status === 'failed' ? 'text-bad' : 'text-muted'}`}
                        title={r.error}
                      >
                        {PLATFORMS[r.platform].name} {STATUS_TEXT[r.status]}
                      </span>
                    ),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Rough reading length: CJK characters plus Latin words, ignoring Markdown punctuation. */
function countWords(markdown: string): number {
  const cjk = markdown.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0;
  const words = markdown.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + words;
}

function FolderIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

const secondaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-control bg-surface px-4 font-medium text-ink hover:bg-canvas disabled:text-muted';

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
