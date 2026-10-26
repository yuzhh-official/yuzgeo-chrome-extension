import { renderHtml } from '@yuzgeo/core';
import DOMPurify from 'dompurify';

/** Markdown is untrusted, including raw HTML and URLs embedded by the author. */
export function renderPreview(markdown: string): string {
  const html = DOMPurify.sanitize(renderHtml(markdown), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'style',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'img',
      'picture',
      'source',
      'video',
      'audio',
      'object',
      'embed',
    ],
    FORBID_ATTR: ['style'],
    SANITIZE_NAMED_PROPS: true,
  });
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const link of template.content.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  return template.innerHTML;
}
