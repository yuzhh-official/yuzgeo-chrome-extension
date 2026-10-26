import type { AuthState, DraftResult } from './adapter';
import type { PlatformId } from './platforms';

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface PlatformTaskResult {
  platform: PlatformId;
  status: TaskStatus;
  /** Human-readable current step while running. */
  step?: string;
  draft?: DraftResult;
  error?: string;
  warnings: string[];
}

export interface SyncTask {
  id: string;
  title: string;
  createdAt: number;
  results: PlatformTaskResult[];
}

export interface PlatformStatus extends AuthState {
  id: PlatformId;
  name: string;
  homepage: string;
  error?: string;
}

export interface CreateDraftsParams {
  /** Raw file content, front-matter included. */
  markdown: string;
  /** Path of the markdown file relative to the asset root, used to resolve relative image refs. */
  filePath: string;
  /** Local assets already stored in the extension's asset store: root-relative path → asset id. */
  assets: Record<string, string>;
  platforms: PlatformId[];
}

/**
 * Requests accepted by the background worker, from extension pages or the paired MCP bridge.
 * Each request maps to its response type below.
 */
export interface RequestMap {
  'platforms/list': { params: { forceRefresh?: boolean }; result: PlatformStatus[] };
  'drafts/create': { params: CreateDraftsParams; result: { taskId: string } };
  'tasks/get': { params: { taskId: string }; result: SyncTask | null };
  'tasks/list': { params: Record<string, never>; result: SyncTask[] };
}

export type RequestMethod = keyof RequestMap;

export interface RequestMessage<M extends RequestMethod = RequestMethod> {
  id: string;
  method: M;
  params: RequestMap[M]['params'];
}

export type ResponseMessage<M extends RequestMethod = RequestMethod> =
  | { id: string; ok: true; result: RequestMap[M]['result'] }
  | { id: string; ok: false; error: string };
