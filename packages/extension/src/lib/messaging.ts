import type { RequestMap, RequestMessage, RequestMethod, ResponseMessage } from '@yuzgeo/core';

const RECONNECT_MESSAGE =
  '扩展后台未响应，请在扩展管理页面重新加载 yuzgeo，关闭旧页面后点击扩展图标重新打开';

/** Sends a typed request to the background worker. Only usable from extension pages. */
export async function request<M extends RequestMethod>(
  method: M,
  params: RequestMap[M]['params'],
): Promise<RequestMap[M]['result']> {
  const message: RequestMessage<M> = { id: crypto.randomUUID(), method, params };
  let response: ResponseMessage<M> | undefined;
  try {
    response = (await browser.runtime.sendMessage(message)) as ResponseMessage<M> | undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (
      /context invalidated|receiving end does not exist|message (port|channel) closed|could not establish connection/i.test(
        detail,
      )
    ) {
      throw new Error(RECONNECT_MESSAGE, { cause: error });
    }
    throw error;
  }
  if (!response || response.id !== message.id || typeof response.ok !== 'boolean') {
    throw new Error(RECONNECT_MESSAGE);
  }
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

/** Accepts messages only from this extension's own pages, never from content scripts or web pages. */
export function isTrustedSender(sender: Browser.runtime.MessageSender): boolean {
  return (
    sender.id === browser.runtime.id &&
    // Extension pages opened in a tab also have sender.tab. Their URL, rather
    // than the presence of a tab, distinguishes them from web content scripts.
    typeof sender.url === 'string' &&
    sender.url.startsWith(browser.runtime.getURL('/'))
  );
}
