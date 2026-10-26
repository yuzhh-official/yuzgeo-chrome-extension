import type { PlatformAdapter } from '@yuzgeo/core';

/** Request headers set on this extension's own requests to `requestDomains` (and subdomains). */
export interface HeaderRule {
  requestDomains: string[];
  setHeaders: Record<string, string>;
}

export interface ExtensionAdapter extends PlatformAdapter {
  /** Usually Origin/Referer, so the platform's CSRF/origin checks see its own site. */
  headerRules: HeaderRule[];
}
