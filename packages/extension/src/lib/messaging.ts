import type { RequestMap, RequestMessage, RequestMethod, ResponseMessage } from '@yuzgeo/core';

/** Sends a typed request to the background worker. Only usable from extension pages. */
export async function request<M extends RequestMethod>(
  method: M,
  params: RequestMap[M]['params'],
): Promise<RequestMap[M]['result']> {
  const message: RequestMessage<M> = { id: crypto.randomUUID(), method, params };
  const response = (await browser.runtime.sendMessage(message)) as ResponseMessage<M>;
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

/** Accepts messages only from this extension's own pages, never from content scripts or web pages. */
export function isTrustedSender(sender: Browser.runtime.MessageSender): boolean {
  return (
    sender.id === browser.runtime.id &&
    sender.tab === undefined &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(browser.runtime.getURL('/'))
  );
}
