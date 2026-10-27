import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, RenderedPost } from '@yuzgeo/core';
import { runInPage } from '../../lib/page-context';
import { toutiao } from './index';
import { DRAFTS_URL, EDITOR_URL } from './api';

vi.mock('../../lib/page-context', () => ({ runInPage: vi.fn() }));
const run = vi.mocked(runInPage);
const ctx: AdapterContext = { signal: new AbortController().signal, log: vi.fn() };
const post: RenderedPost = {
  title: '测试文章（请勿发布）',
  body: '<p>正文</p>',
  markdown: '正文',
  tags: [],
  extra: { publish: true },
};
beforeEach(() => {
  run.mockReset();
});

describe('Toutiao adapter', () => {
  it('always opens a fresh editor and returns the observed draft list, not an invented server id', async () => {
    run.mockResolvedValue(null);
    const result = await toutiao.createDraft(post, ctx);
    expect(run.mock.calls[0]?.[0]).toEqual({
      url: EDITOR_URL,
      match: 'https://mp.toutiao.com/*',
      fresh: true,
    });
    expect(run.mock.calls[0]?.[2]).toEqual([
      { title: post.title, html: post.body, timeoutMs: 20000 },
    ]);
    expect(result.draftUrl).toBe(DRAFTS_URL);
    expect(result.id).toMatch(/^local-/);
  });
  it('validates titles and cancellation before opening any editor', async () => {
    for (const title of ['短', '长'.repeat(31)])
      await expect(toutiao.createDraft({ ...post, title }, ctx)).rejects.toThrow('2–30');
    const controller = new AbortController();
    controller.abort();
    await expect(
      toutiao.createDraft(post, { ...ctx, signal: controller.signal }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('surfaces failed saves without retrying and rejects images', async () => {
    run.mockRejectedValue(new Error('尚未确认保存成功'));
    await expect(toutiao.createDraft(post, ctx)).rejects.toThrow('尚未确认');
    expect(run).toHaveBeenCalledTimes(1);
    await expect(toutiao.uploadImage(new Blob(), ctx)).rejects.toThrow('暂不支持');
  });
});
