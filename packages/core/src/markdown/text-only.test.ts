import { describe, expect, it } from 'vitest';
import { textOnlyMarkdown } from './text-only';
import { renderHtml } from './render';

describe('textOnlyMarkdown', () => {
  it('keeps code, links, headings and tables unchanged', () => {
    const md =
      '# Heading\n\n[link](https://example.com)\n\n`![literal](x.png)`\n\n```html\n<img src="x">\n```\n\n| a |\n|---|\n| b |';
    expect(textOnlyMarkdown(md)).toBe(md);
  });

  it('drops local, remote, data and reference images but retains alt text', () => {
    const md =
      '![本地](./a.png) ![](https://example.com/a) ![数据](data:image/png;base64,AA) ![引用][ref]\n\n[ref]: ./b.png';
    expect(textOnlyMarkdown(md)).toBe('本地  数据 引用\n\n');
  });

  it('retains reference definitions shared by normal links', () => {
    expect(textOnlyMarkdown('![图][shared] [下载][shared]\n\n[shared]: ./a.png')).toBe(
      '图 [下载][shared]\n\n[shared]: ./a.png',
    );
  });

  it('handles raw HTML with quoted angle brackets and media wrappers', () => {
    const md =
      '<div style="background:url(remote.png)">正文<img src="a>b.png" alt="图注"><picture><source srcset="a.png"><img src="b.png"></picture><svg><image href="c.png"/></svg><video poster="d.png"></video></div>';
    const output = textOnlyMarkdown(md);
    expect(output).toContain('正文图注');
    expect(output).not.toMatch(/img|picture|svg|video|\.png/);
    expect(renderHtml(output)).toContain('<div >正文图注</div>');
  });

  it('keeps image-looking alt text literal and transformation idempotent', () => {
    const output = textOnlyMarkdown('<img src="x.png" alt="&lt;img src=x&gt; &amp; [text]">');
    expect(renderHtml(output)).not.toContain('<img');
    expect(textOnlyMarkdown(output)).toBe(output);
  });
});
