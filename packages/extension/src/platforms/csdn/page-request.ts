import type { PageResult } from '../../lib/page-context';

export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ApiResponse {
  status: number;
  text: string;
  gatewayError: string | null;
}

/** Self-contained: use CSDN's same-site session instead of a cross-site extension request. */
export async function requestInCsdn(input: SignedRequest): Promise<PageResult<ApiResponse>> {
  if (location.origin !== 'https://mp.csdn.net')
    return { ok: false, error: '请先登录 CSDN 创作中心后重试' };
  const url = new URL(input.url);
  const isSave = url.pathname === '/blog-console-api/v1/postedit/saveArticle';
  if (
    url.origin !== 'https://bizapi.csdn.net' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !isSave ||
    input.method !== 'POST'
  )
    return { ok: false, error: 'CSDN：拒绝非草稿接口请求' };
  try {
    const body = JSON.parse(input.body ?? '{}') as Record<string, unknown>;
    if (body.status !== 2 || body.article_id !== '')
      return { ok: false, error: 'CSDN：只允许新建草稿' };
    const response = await fetch(url.href, {
      method: 'POST',
      credentials: 'include',
      headers: input.headers,
      body: input.body,
      signal: AbortSignal.timeout(30_000),
    });
    return {
      ok: true,
      value: {
        status: response.status,
        text: await response.text(),
        gatewayError: response.headers.get('x-ca-error-message'),
      },
    };
  } catch {
    // Never retry a write after an unknown network outcome.
    return { ok: false, error: 'CSDN 请求未完成，请先检查草稿箱，再决定是否重试' };
  }
}
