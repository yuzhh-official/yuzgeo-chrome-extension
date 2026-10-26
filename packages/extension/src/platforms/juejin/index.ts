import type { AdapterContext, AuthState, RenderedPost } from '@yuzgeo/core';
import { PLATFORMS } from '@yuzgeo/core';
import { HttpError, jsonBody } from '../../lib/http';
import { apiUrl, callApi, JuejinError } from './api';
import { uploadToImagex } from './imagex';
import type { ExtensionAdapter } from '../types';

const EDIT_TYPE_MARKDOWN = 10;

interface JuejinUser {
  user_id: string;
  user_name: string;
}

interface CategoryBrief {
  category_id: string;
  category_name: string;
}

interface TagItem {
  tag_id: string;
  tag?: { tag_name?: string };
}

async function checkAuth(ctx: AdapterContext): Promise<AuthState> {
  try {
    const user = await callApi<JuejinUser>(
      apiUrl('/user_api/v1/user/get'),
      { signal: ctx.signal },
      '获取用户信息',
    );
    return { loggedIn: true, username: user.user_name };
  } catch (error) {
    if (error instanceof JuejinError) return { loggedIn: false };
    if (error instanceof HttpError && (error.status === 401 || error.status === 403))
      return { loggedIn: false };
    throw error;
  }
}

async function resolveCategoryId(name: string, ctx: AdapterContext): Promise<string | undefined> {
  const list = await callApi<CategoryBrief[]>(
    apiUrl('/tag_api/v1/query_category_briefs'),
    { signal: ctx.signal },
    '获取分类',
  );
  return list.find((c) => c.category_name === name)?.category_id;
}

async function resolveTagId(name: string, ctx: AdapterContext): Promise<string | undefined> {
  const list = await callApi<TagItem[]>(
    apiUrl('/tag_api/v1/query_tag_list'),
    { ...jsonBody({ cursor: '0', key_word: name, limit: 10, sort_type: 1 }), signal: ctx.signal },
    '搜索标签',
  );
  const lower = name.toLowerCase();
  return list.find((t) => t.tag?.tag_name?.toLowerCase() === lower)?.tag_id;
}

/** Category and tags are only needed at publish time, so any failure here just leaves them empty. */
async function resolveTaxonomy(post: RenderedPost, ctx: AdapterContext) {
  let categoryId = '0';
  const tagIds: string[] = [];
  const category = post.extra.category;
  if (typeof category === 'string' && category) {
    try {
      const id = await resolveCategoryId(category, ctx);
      if (id) categoryId = id;
      else ctx.log(`掘金分类「${category}」不存在，已忽略`);
    } catch (error) {
      ctx.log(`掘金分类解析失败：${(error as Error).message}`);
    }
  }
  for (const tag of post.tags) {
    try {
      const id = await resolveTagId(tag, ctx);
      if (id) tagIds.push(id);
      else ctx.log(`掘金标签「${tag}」不存在，已忽略`);
    } catch (error) {
      ctx.log(`掘金标签「${tag}」解析失败：${(error as Error).message}`);
    }
  }
  return { categoryId, tagIds };
}

export const juejin: ExtensionAdapter = {
  meta: PLATFORMS.juejin,
  headerRules: [
    {
      requestDomains: ['juejin.cn'],
      setHeaders: { Origin: 'https://juejin.cn', Referer: 'https://juejin.cn/editor/drafts/new' },
    },
  ],
  checkAuth,
  uploadImage: (image, ctx) => uploadToImagex(image, ctx.signal),
  async createDraft(post, ctx) {
    const { categoryId, tagIds } = await resolveTaxonomy(post, ctx);
    const draft = await callApi<{ id: string }>(
      apiUrl('/content_api/v1/article_draft/create'),
      {
        ...jsonBody({
          category_id: categoryId,
          tag_ids: tagIds,
          link_url: '',
          cover_image: post.coverUrl ?? '',
          title: post.title,
          brief_content: post.summary ?? '',
          edit_type: EDIT_TYPE_MARKDOWN,
          html_content: 'deprecated',
          mark_content: post.body,
          theme_ids: [],
        }),
        signal: ctx.signal,
      },
      '创建草稿',
    );
    const id = String(draft.id);
    return { id, draftUrl: `https://juejin.cn/editor/drafts/${id}` };
  },
};
