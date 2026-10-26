import { describe, expect, it } from 'vitest';
import { zhihuCodeBlock, zhihuMath } from './html';

describe('zhihuMath', () => {
  it('renders inline math as an equation image', () => {
    expect(zhihuMath('a<b & c', false)).toBe(
      '<img eeimg="1" src="https://www.zhihu.com/equation?tex=a%3Cb%20%26%20c" alt="a&lt;b &amp; c">',
    );
  });

  it('wraps display math in its own paragraph', () => {
    expect(zhihuMath('x^2', true)).toBe(
      '<p><img eeimg="1" src="https://www.zhihu.com/equation?tex=x%5E2" alt="x^2"></p>',
    );
  });
});

describe('zhihuCodeBlock', () => {
  it('puts the language on <pre> and escapes the code', () => {
    expect(zhihuCodeBlock('if (a < b) "x";', 'ts')).toBe(
      '<pre lang="ts"><code>if (a &lt; b) &quot;x&quot;;</code></pre>',
    );
  });

  it('omits lang when unknown', () => {
    expect(zhihuCodeBlock('plain', undefined)).toBe('<pre><code>plain</code></pre>');
  });
});
