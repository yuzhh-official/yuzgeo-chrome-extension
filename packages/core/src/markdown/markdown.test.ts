import { describe, expect, it, vi } from 'vitest';
import { parseDocument, splitFrontMatter } from './document';
import { collectImageUrls, rewriteImageUrls } from './images';
import { resolveAssetPath } from './paths';
import { preparePost } from './pipeline';
import { renderHtml } from './render';

describe('splitFrontMatter', () => {
  it('parses known fields and accepts comma-separated tags', () => {
    const { frontMatter, body } = splitFrontMatter(
      '---\ntitle: 你好\ndescription: 摘要\ntags: a, b，c\ncover: ./c.png\n---\n正文\n',
    );
    expect(frontMatter).toEqual({
      title: '你好',
      summary: '摘要',
      tags: ['a', 'b', 'c'],
      cover: './c.png',
    });
    expect(body).toBe('正文\n');
  });

  it('returns the text unchanged without front-matter', () => {
    expect(splitFrontMatter('# Hi\n')).toEqual({ frontMatter: {}, body: '# Hi\n' });
  });

  it('throws on invalid YAML', () => {
    expect(() => splitFrontMatter('---\ntitle: [\n---\n')).toThrow();
  });
});

describe('parseDocument', () => {
  it('takes the title from a leading H1 and removes it', () => {
    expect(parseDocument('# 标题\n\n正文')).toMatchObject({ title: '标题', markdown: '正文' });
  });

  it('prefers the front-matter title and keeps a different H1', () => {
    const doc = parseDocument('---\ntitle: A\n---\n# B\n\ntext');
    expect(doc.title).toBe('A');
    expect(doc.markdown).toBe('# B\n\ntext');
  });

  it('falls back to the given title', () => {
    expect(parseDocument('text', 'file').title).toBe('file');
  });
});

describe('resolveAssetPath', () => {
  it('resolves relative refs against the file directory', () => {
    expect(resolveAssetPath('posts/a.md', './img/x.png')).toBe('posts/img/x.png');
    expect(resolveAssetPath('posts/a.md', '../img/x%20y.png?v=1')).toBe('img/x y.png');
    expect(resolveAssetPath('posts/a.md', '/root.png')).toBe('root.png');
  });

  it('rejects external refs and refs escaping the root', () => {
    expect(resolveAssetPath('a.md', 'https://x.com/a.png')).toBeNull();
    expect(resolveAssetPath('a.md', 'data:image/png;base64,AA')).toBeNull();
    expect(resolveAssetPath('a.md', '../x.png')).toBeNull();
  });
});

describe('image refs', () => {
  const md = [
    '![a](./a.png) and ![b](<./b c.png> "t")',
    '',
    '[ref]: ./d.png',
    '',
    '<img src="./e.png" alt="e">',
    '',
    '```',
    '![not](./code.png)',
    '```',
  ].join('\n');

  it('collects markdown, definition and HTML images but not code', () => {
    expect(collectImageUrls(md)).toEqual(['./a.png', './b c.png', './d.png', './e.png']);
  });

  it('rewrites only the URLs and preserves the rest of the source', () => {
    const out = rewriteImageUrls(
      md,
      new Map([
        ['./a.png', 'https://cdn/a'],
        ['./b c.png', 'https://cdn/b'],
        ['./d.png', 'https://cdn/d'],
        ['./e.png', 'https://cdn/e'],
      ]),
    );
    expect(out).toBe(
      md
        .replace('./a.png', 'https://cdn/a')
        .replace('./b c.png', 'https://cdn/b')
        .replace('[ref]: ./d.png', '[ref]: https://cdn/d')
        .replace('src="./e.png"', 'src="https://cdn/e"'),
    );
  });
});

describe('renderHtml', () => {
  it('renders GFM and passes math and code through hooks', () => {
    const html = renderHtml('| a |\n|---|\n| 1 |\n\n$x$\n\n```js\nlet a\n```', {
      math: (tex, display) => `<m d="${display}">${tex}</m>`,
      codeBlock: (code, lang) => `<pre lang="${lang}">${code}</pre>`,
    });
    expect(html).toContain('<table>');
    expect(html).toContain('<m d="false">x</m>');
    expect(html).toContain('<pre lang="js">let a</pre>');
  });
});

describe('preparePost', () => {
  it('omits images and cover while keeping text, tags and platform settings', async () => {
    const post = await preparePost(
      {
        title: 'T',
        markdown: '正文 ![图注](./missing.png) ![](https://example.com/a.png)',
        frontMatter: {
          tags: ['t'],
          cover: './cover.png',
          platforms: { juejin: { category: '前端' } },
        },
      },
      { platform: 'juejin', format: 'markdown' },
    );
    expect(post.body).toBe('正文 图注 ');
    expect(post.coverUrl).toBeUndefined();
    expect(post.tags).toEqual(['t']);
    expect(post.extra).toEqual({ category: '前端' });
  });

  it('renders HTML without the platform image-based math hook', async () => {
    const math = vi.fn(() => '<img src="https://example.com/equation">');
    const post = await preparePost(
      { title: 'T', markdown: '**hi** $x$ ![说明](data:image/png;base64,AA)', frontMatter: {} },
      { platform: 'zhihu', format: 'html', html: { math } },
    );
    expect(post.body).toContain('<strong>hi</strong>');
    expect(post.body).toContain('x');
    expect(post.body).toContain('说明');
    expect(post.body).not.toContain('<img');
    expect(math).not.toHaveBeenCalled();
  });

  it('rejects a document containing only images without alternative text', async () => {
    await expect(
      preparePost(
        { title: 'T', markdown: '![](./a.png)', frontMatter: {} },
        { platform: 'juejin', format: 'markdown' },
      ),
    ).rejects.toThrow('去除图片后没有可同步的正文');
  });
});
