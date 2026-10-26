import type { HeaderRule } from '@/platforms/types';

/**
 * Installs the adapters' header rules as DNR session rules. Every rule is limited to requests
 * initiated by this extension, so browsing the platforms themselves is never affected.
 */
export async function installHeaderRules(rules: HeaderRule[]): Promise<void> {
  const existing = await browser.declarativeNetRequest.getSessionRules();
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules.map((rule, index) => ({
      id: index + 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: Object.entries(rule.setHeaders).map(([header, value]) => ({
          header,
          operation: 'set',
          value,
        })),
      },
      condition: {
        requestDomains: rule.requestDomains,
        initiatorDomains: [browser.runtime.id],
        resourceTypes: ['xmlhttprequest'],
      },
    })) as Browser.declarativeNetRequest.Rule[],
  });
}
