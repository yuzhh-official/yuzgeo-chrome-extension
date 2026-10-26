import type { RequestMap, RequestMessage, RequestMethod, ResponseMessage } from '@yuzgeo/core';
import { errorMessage } from '@yuzgeo/core';
import { listPlatforms } from '@/background/auth';
import { createDrafts, getTask, listTasks } from '@/background/tasks';
import { installHeaderRules } from '@/lib/header-rules';
import { isTrustedSender } from '@/lib/messaging';
import { adapters } from '@/platforms';

type Handlers = {
  [M in RequestMethod]: (params: RequestMap[M]['params']) => Promise<RequestMap[M]['result']>;
};

const handlers: Handlers = {
  'platforms/list': ({ forceRefresh }) => listPlatforms(forceRefresh),
  'drafts/create': async (params) => ({ taskId: await createDrafts(params) }),
  'tasks/get': ({ taskId }) => getTask(taskId),
  'tasks/list': () => listTasks(),
};

export default defineBackground(() => {
  // Session rules survive worker restarts but not browser restarts; reinstalling is idempotent.
  const rulesReady = installHeaderRules(Object.values(adapters).flatMap((a) => a.headerRules));

  browser.runtime.onMessage.addListener((message: RequestMessage, sender, sendResponse) => {
    if (!isTrustedSender(sender) || !(message?.method in handlers)) return false;

    const handler = handlers[message.method] as (params: unknown) => Promise<unknown>;
    rulesReady
      .then(() => handler(message.params))
      .then(
        (result) => sendResponse({ id: message.id, ok: true, result } as ResponseMessage),
        (error: unknown) =>
          sendResponse({
            id: message.id,
            ok: false,
            error: errorMessage(error),
          } as ResponseMessage),
      );
    return true;
  });

  browser.action.onClicked.addListener(() => {
    void browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
  });
});
