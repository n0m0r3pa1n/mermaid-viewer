// Run with: npm test
const assert = require('assert');
const { extract, replaceBlocks } = require('../src/renderer/extract.js');

const codes = (text, opts) => extract(text, opts).map((d) => d.code);
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('✓', name);
}

test('markdown fences', () => {
  assert.deepStrictEqual(codes('# T\n\n```mermaid\ngraph TD\n  A-->B\n```\n'), ['graph TD\n  A-->B']);
});

test('indented fences from terminal / chat output', () => {
  const text = '⏺ Here:\n\n  ```mermaid\n  flowchart LR\n      A --> B\n  ```\n\n  Done.';
  assert.deepStrictEqual(codes(text), ['flowchart LR\n    A --> B']);
});

test('terminal box borders', () => {
  const text = '│ ```mermaid │\n│ graph TD   │\n│   A-->B    │\n│ ```        │';
  assert.deepStrictEqual(codes(text), ['graph TD\n  A-->B']);
});

test('timestamped log lines keep indentation', () => {
  const p = (n) => `2024-05-01T10:00:00.12${n}Z INFO [gen] `;
  const text = [p(1) + '```mermaid', p(2) + 'graph TD', p(3) + '  A-->B', p(4) + '```'].join('\n');
  assert.deepStrictEqual(codes(text), ['graph TD\n  A-->B']);
});

test('JSON-escaped diagram in a log line', () => {
  assert.deepStrictEqual(codes('{"msg":"x","d":"graph TD\\n  A-->B\\n"}'), ['graph TD\n  A-->B']);
});

test('quoted markdown', () => {
  assert.deepStrictEqual(codes('> ```mermaid\n> pie\n>   "a": 1\n> ```'), ['pie\n  "a": 1']);
});

test('HTML <pre class="mermaid">', () => {
  assert.deepStrictEqual(codes('<pre class="mermaid">\ngraph LR\nA --&gt; B\n</pre>'), ['graph LR\nA --> B']);
});

test('raw diagram, with preamble in loose mode only', () => {
  assert.deepStrictEqual(codes('Output:\nsequenceDiagram\n  A->>B: hi'), ['sequenceDiagram\n  A->>B: hi']);
  assert.deepStrictEqual(codes('Output:\nsequenceDiagram\n  A->>B: hi', { strict: true }), []);
  assert.deepStrictEqual(codes('graphics are fun', { strict: true }), []);
});

test('front matter and titles', () => {
  const [d] = extract('---\ntitle: My Flow\n---\nflowchart TD\n A-->B');
  assert.strictEqual(d.title, 'My Flow');
  assert.strictEqual(extract('sequenceDiagram\nA->>B: x')[0].title, 'Sequence');
});

test('multiple diagrams, duplicates removed', () => {
  const t = '```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\npie\n"a":1\n```\n\n```mermaid\ngraph TD\nA-->B\n```';
  assert.strictEqual(extract(t).length, 2);
});

test('markdown write-back preserves surrounding text and indentation', () => {
  const md = 'Intro\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nMid\n\n  ```mermaid\n  pie\n    "a": 1\n  ```\nEnd\n';
  const blocks = extract(md);
  const out = replaceBlocks(md, blocks, ['graph LR\n  X-->Y\n\n  Y-->Z', 'pie\n  "b": 2']);
  assert.strictEqual(out, 'Intro\n\n```mermaid\ngraph LR\n  X-->Y\n\n  Y-->Z\n```\n\nMid\n\n  ```mermaid\n  pie\n    "b": 2\n  ```\nEnd\n');
  assert.deepStrictEqual(extract(out).map((d) => d.code), ['graph LR\n  X-->Y\n\n  Y-->Z', 'pie\n  "b": 2']);
});

test('repeated diagrams are kept when dedupe is off', () => {
  const t = '```mermaid\npie\n"a":1\n```\n\n```mermaid\npie\n"a":1\n```';
  assert.strictEqual(extract(t, { dedupe: false }).length, 2);
});

test('bare diagrams back to back are split', () => {
  const t = [
    'flowchart LR', '    A[Terminal error] --> B[Cancel]', '    B --> C{Error?}', '    C -- No --> D[Report]', '',
    '', 'flowchart LR', '    commit([Commit]) --> ci[CI build]', '    ci --> tests{Tests pass?}',
  ].join('\n');
  const ds = codes(t, { strict: true });
  assert.strictEqual(ds.length, 2);
  assert.ok(ds[0].startsWith('flowchart LR\n    A[Terminal error]') && ds[0].endsWith('D[Report]'));
  assert.ok(ds[1].startsWith('flowchart LR\n    commit'));
});

test('split without a blank line on unambiguous headers, with front matter', () => {
  const t = 'graph TD\n  A-->B\nsequenceDiagram\n  A->>B: x\n\n---\ntitle: Pie\n---\npie\n  "a": 1';
  assert.deepStrictEqual(codes(t), ['graph TD\n  A-->B', 'sequenceDiagram\n  A->>B: x', '---\ntitle: Pie\n---\npie\n  "a": 1']);
});

test('statements inside a diagram are not mistaken for new diagrams', () => {
  const block = 'block-beta\ncolumns 3\n\nblock:group1\n  a b\nend';
  assert.deepStrictEqual(codes(block), [block]);
  const nested = 'flowchart TD\n  subgraph S\n    graph TD\n  end';
  assert.strictEqual(codes(nested).length, 1);
});

console.log(`\n${passed} passed`);
