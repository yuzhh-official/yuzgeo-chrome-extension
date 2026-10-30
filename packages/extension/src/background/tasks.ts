import type {
  CreateDraftsParams,
  ParsedDocument,
  PlatformId,
  PlatformTaskResult,
  SyncTask,
} from '@yuzgeo/core';
import { errorMessage, parseDocument, preparePost, textOnlyMarkdown } from '@yuzgeo/core';
import { getAdapter } from '@/platforms';
import { checkAuth } from './auth';

const STORAGE_KEY = 'tasks';
const MAX_TASKS = 50;

let tasks: SyncTask[] | null = null;

async function loadTasks(): Promise<SyncTask[]> {
  if (tasks) return tasks;
  const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
    SyncTask[] | undefined;
  // A worker restart kills in-flight work; don't leave those results spinning forever.
  tasks = (stored ?? []).map((task) => ({
    ...task,
    results: task.results.map((r) =>
      r.status === 'pending' || r.status === 'running'
        ? { ...r, status: 'failed', step: undefined, error: '扩展后台被中断，请重试' }
        : r,
    ),
  }));
  return tasks;
}

async function saveTasks(): Promise<void> {
  if (tasks) await browser.storage.local.set({ [STORAGE_KEY]: tasks.slice(0, MAX_TASKS) });
}

export async function listTasks(): Promise<SyncTask[]> {
  return loadTasks();
}

export async function getTask(id: string): Promise<SyncTask | null> {
  return (await loadTasks()).find((task) => task.id === id) ?? null;
}

export async function createDrafts(params: CreateDraftsParams): Promise<string> {
  if (params.platforms.length === 0) throw new Error('请至少选择一个平台');
  if (params.platformTitles !== undefined) {
    if (
      !params.platformTitles ||
      typeof params.platformTitles !== 'object' ||
      Array.isArray(params.platformTitles)
    )
      throw new Error('平台标题格式无效');
    for (const title of Object.values(params.platformTitles)) {
      if (typeof title !== 'string' || !title.trim() || [...title].length > 200)
        throw new Error('平台标题必须是 1–200 字的文字');
    }
  }
  const fallbackTitle =
    params.filePath
      .split('/')
      .pop()
      ?.replace(/\.(md|markdown)$/i, '') ?? '';
  const doc = parseDocument(params.markdown, fallbackTitle);
  if (!doc.title) throw new Error('缺少标题：请在 front-matter 写 title，或以一级标题开头');

  if (!textOnlyMarkdown(doc.markdown).trim()) throw new Error('去除图片后没有可同步的正文');

  const task: SyncTask = {
    id: crypto.randomUUID(),
    title: doc.title,
    createdAt: Date.now(),
    results: params.platforms.map((platform) => ({ platform, status: 'pending', warnings: [] })),
  };
  const all = await loadTasks();
  all.unshift(task);
  await saveTasks();

  void Promise.allSettled(
    task.results.map((result) =>
      runPlatform(task, result, doc, params.platformTitles?.[result.platform]),
    ),
  );
  return task.id;
}

async function runPlatform(
  task: SyncTask,
  result: PlatformTaskResult,
  doc: ParsedDocument,
  title?: string,
): Promise<void> {
  const update = (patch: Partial<PlatformTaskResult>) => {
    Object.assign(result, patch);
    void saveTasks();
  };
  const platform: PlatformId = result.platform;

  try {
    const adapter = getAdapter(platform);
    const ctx = {
      signal: AbortSignal.timeout(5 * 60_000),
      log: (message: string) => console.info(`[${platform}] ${task.id}`, message),
    };

    update({ status: 'running', step: '检查登录状态' });
    const auth = await checkAuth(platform, true);
    if (!auth.loggedIn) throw new Error(`未登录${adapter.meta.name}，请先在浏览器中登录`);

    const post = await preparePost(doc, {
      platform,
      format: adapter.meta.format,
      html: adapter.htmlOptions,
      title,
    });

    update({ step: '创建草稿' });
    const draft = await adapter.createDraft(post, ctx);
    update({ status: 'succeeded', step: undefined, draft });
  } catch (error) {
    update({ status: 'failed', step: undefined, error: errorMessage(error) });
  }
}
