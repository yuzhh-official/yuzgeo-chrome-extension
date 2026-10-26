import type { HtmlRenderOptions } from './markdown/render';
import type { PlatformMeta } from './platforms';
import type { RenderedPost } from './post';

export interface AuthState {
  loggedIn: boolean;
  username?: string;
}

export interface DraftResult {
  id: string;
  draftUrl: string;
}

export interface AdapterContext {
  signal: AbortSignal;
  log(message: string): void;
}

export interface PlatformAdapter {
  meta: PlatformMeta;
  /** Platform-specific HTML rendering; only used when `meta.format` is `html`. */
  htmlOptions?: HtmlRenderOptions;
  checkAuth(ctx: AdapterContext): Promise<AuthState>;
  /** Uploads one image to the platform's image host and returns its URL there. */
  uploadImage(image: Blob, ctx: AdapterContext): Promise<string>;
  createDraft(post: RenderedPost, ctx: AdapterContext): Promise<DraftResult>;
}
