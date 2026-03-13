'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ─── Assertion helpers ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function pass(msg)        { console.log(`    \x1b[32m✓\x1b[0m ${msg}`); passed++; }
function fail(msg, extra) {
  console.error(`    \x1b[31m✗\x1b[0m ${msg}`);
  if (extra) extra.split('\n').forEach(l => console.error(`        ${l}`));
  failed++;
}

function assert(cond, msg) {
  cond ? pass(msg) : fail(msg);
}

function assertEqual(actual, expected, msg) {
  actual === expected
    ? pass(msg)
    : fail(msg, `expected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`);
}

function assertContains(str, sub, msg) {
  typeof str === 'string' && str.includes(sub)
    ? pass(msg)
    : fail(msg, `expected to contain: ${JSON.stringify(sub)}\nin: ${JSON.stringify((str || '').slice(0, 250))}`);
}

function assertNotContains(str, sub, msg) {
  typeof str === 'string' && !str.includes(sub)
    ? pass(msg)
    : fail(msg, `expected NOT to contain: ${JSON.stringify(sub)}`);
}

function describe(name, fn) {
  const before = failed;
  console.log(`\n  \x1b[1m${name}\x1b[0m`);
  fn();
  const delta = failed - before;
  if (delta > 0) console.log(`    \x1b[33m↳ ${delta} failure(s)\x1b[0m`);
}

// ─── Load MarkdownParser via vm (convert top-level const → var so it leaks) ──
const parserSrc    = fs.readFileSync(path.join(__dirname, 'markdown-parser.js'), 'utf8');
const parserVmCode = parserSrc.replace(/^\s*const MarkdownParser\s*=/m, 'var MarkdownParser =');
const parserCtx    = {};
vm.createContext(parserCtx);
vm.runInContext(parserVmCode, parserCtx);
const MarkdownParser = parserCtx.MarkdownParser;

if (!MarkdownParser || typeof MarkdownParser.parse !== 'function') {
  console.error('FATAL: MarkdownParser could not be loaded');
  process.exit(1);
}

// ─── Mock DOM environment for editor.js ───────────────────────────────────────

const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem:    (k)    => store.hasOwnProperty(k) ? store[k] : null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { store = {}; },
    _store:     ()     => ({ ...store }),
  };
})();

const mockEditor = {
  value:          '',
  selectionStart: 0,
  selectionEnd:   0,
  focus:          () => {},
  _listeners:     {},
  addEventListener(ev, fn) { this._listeners[ev] = fn; },
};

const mockPreview   = { innerHTML: '' };
const mockEditorPane  = { offsetWidth: 500, style: { flex: '' } };
const mockPreviewPane = { offsetWidth: 500, style: { flex: '' } };

let toolbarClickHandler = null;
let exportClickHandler  = null;
let capturedBlob        = null;

// 리사이저 mock: keydown 핸들러 캡처
const mockResizer = {
  _listeners: {},
  offsetWidth:  6,
  offsetHeight: 6,
  addEventListener(ev, fn) { this._listeners[ev] = fn; },
};

const mockElements = {
  'editor':       mockEditor,
  'preview':      mockPreview,
  'resizer':      mockResizer,
  'editor-pane':  mockEditorPane,
  'preview-pane': mockPreviewPane,
  'toolbar':      { addEventListener: (ev, fn) => { if (ev === 'click') toolbarClickHandler = fn; } },
  'export-btn':   { addEventListener: (ev, fn) => { if (ev === 'click') exportClickHandler  = fn; } },
};

const editorCtx = {
  MarkdownParser,
  document: {
    getElementById: (id) => mockElements[id],
    createElement: (tag) => {
      if (tag === 'a') {
        const a = { href: '', download: 'document.html', style: {}, click() { capturedBlob._filename = this.download; } };
        return a;
      }
      return {};
    },
    body: {
      appendChild:  () => {},
      removeChild:  () => {},
      classList: { add: () => {}, remove: () => {} },
      style: {},
    },
    addEventListener(ev, fn) {
      if (ev === 'DOMContentLoaded') fn(); // 즉시 init() 호출
      // mousemove / mouseup 은 저장만 (리사이저 테스트에 불필요)
    },
  },
  localStorage: mockLocalStorage,
  URL: {
    createObjectURL: (blob) => { capturedBlob = blob; return 'blob:mock'; },
    revokeObjectURL: () => {},
  },
  Blob: class MockBlob {
    constructor(parts, opts) {
      this.content = parts.join('');
      this.type    = (opts && opts.type) || '';
    }
  },
  // setTimeout을 즉시 실행으로 오버라이드 → 디바운스 없이 테스트 가능
  setTimeout:   (fn) => { fn(); return 1; },
  clearTimeout: () => {},
  // initResizer의 isVerticalLayout()이 호출하는 getComputedStyle mock
  window: {
    getComputedStyle: () => ({ flexDirection: 'row' }),
    innerWidth: 1280,
  },
  console,
};

// 로드 전 localStorage 초기화 (DOMContentLoaded 시 loadFromStorage 호출 대비)
mockLocalStorage.clear();

const editorSrc = fs.readFileSync(path.join(__dirname, 'editor.js'), 'utf8');
vm.createContext(editorCtx);
vm.runInContext(editorSrc, editorCtx);
// init()이 DOMContentLoaded mock을 통해 이미 실행됨

// ─── Test helpers ─────────────────────────────────────────────────────────────

function setEditorState(value, selStart, selEnd) {
  mockEditor.value          = value;
  mockEditor.selectionStart = selStart !== undefined ? selStart : value.length;
  mockEditor.selectionEnd   = selEnd   !== undefined ? selEnd   : (selStart !== undefined ? selStart : value.length);
}

function clickToolbar(action) {
  if (!toolbarClickHandler) throw new Error('toolbar click handler not registered');
  const btn = { dataset: { action } };
  toolbarClickHandler({ target: { closest: (sel) => sel === '[data-action]' ? btn : null } });
}

function simulateKeydown(key, ctrl = true) {
  const h = mockEditor._listeners['keydown'];
  if (h) h({ key, ctrlKey: ctrl, metaKey: false, preventDefault: () => {} });
}

function simulateInput() {
  const h = mockEditor._listeners['input'];
  if (h) h();
}

// ─── 1. Parser: Headings ─────────────────────────────────────────────────────
const p = MarkdownParser.parse;

console.log('\n\x1b[1m========================================\x1b[0m');
console.log('\x1b[1m Markdown Editor Test Suite\x1b[0m');
console.log('\x1b[1m========================================\x1b[0m');

describe('Parser: Headings h1-h6', () => {
  for (let i = 1; i <= 6; i++) {
    const r = p(`${'#'.repeat(i)} Heading ${i}`);
    assertContains(r, `<h${i}>`,    `H${i} opening tag`);
    assertContains(r, `Heading ${i}`, `H${i} content`);
    assertContains(r, `</h${i}>`,   `H${i} closing tag`);
  }
  assertContains(p('# Title **bold**'), '<strong>bold</strong>', 'Inline bold inside heading');
  assertContains(p('## Code `snippet`'), '<code>snippet</code>',  'Inline code inside heading');
});

// ─── 2. Parser: Bold / Italic / Bold+Italic ───────────────────────────────────
describe('Parser: Bold', () => {
  assertContains(p('**bold**'),         '<strong>bold</strong>',    '** bold');
  assertContains(p('__bold__'),         '<strong>bold</strong>',    '__ bold');
  assertContains(p('word **x** end'),   '<strong>x</strong>',       'Bold mid-sentence');
  assertContains(p('**a** and **b**'),  '<strong>a</strong>',       'Two bold spans (first)');
  assertContains(p('**a** and **b**'),  '<strong>b</strong>',       'Two bold spans (second)');
});

describe('Parser: Italic', () => {
  assertContains(p('*italic*'),        '<em>italic</em>',           '* italic');
  assertContains(p('_italic_'),        '<em>italic</em>',           '_ italic');
  assertContains(p('word *x* end'),    '<em>x</em>',                'Italic mid-sentence');
});

describe('Parser: Bold + Italic', () => {
  assertContains(p('***bold italic***'), '<strong><em>bold italic</em></strong>', '*** bold+italic');
  assertContains(p('___bold italic___'), '<strong><em>bold italic</em></strong>', '___ bold+italic');
  assertContains(p('**bold** *italic*'), '<strong>bold</strong>',                 'Bold then italic');
  assertContains(p('**bold** *italic*'), '<em>italic</em>',                       'Italic after bold');
});

// ─── 3. Parser: Inline Code ───────────────────────────────────────────────────
describe('Parser: Inline Code', () => {
  assertContains(p('use `var x`'),          '<code>var x</code>',          'Basic inline code');
  assertContains(p('`<div>`'),              '<code>&lt;div&gt;</code>',    'HTML escaped inside code');
  assertNotContains(p('`**no bold**`'),      '<strong>',                    'No bold inside inline code');
  assertNotContains(p('`_no italic_`'),      '<em>',                        'No italic inside inline code');
  assertContains(p('`a` and `b`'),          '<code>a</code>',              'First of two inline codes');
  assertContains(p('`a` and `b`'),          '<code>b</code>',              'Second of two inline codes');
});

// ─── 4. Parser: Fenced Code Blocks ───────────────────────────────────────────
describe('Parser: Code Blocks', () => {
  const jsBlock = p('```javascript\nconst x = 1;\n```');
  assertContains(jsBlock, '<pre',          'Code block has <pre>');
  assertContains(jsBlock, '<code',         'Code block has <code>');
  assertContains(jsBlock, 'const x = 1;', 'Code block preserves content');
  assertContains(jsBlock, 'javascript',   'Code block shows language label');
  assertNotContains(jsBlock, '<strong>',  'No markdown inside code block');

  assertContains(p('```\nno lang\n```'),           'no lang',         'Code block without language');
  assertContains(p('~~~python\nprint("x")\n~~~'),  'print',           'Tilde fence block');
  assertContains(p('```\n<b>&amp;</b>\n```'),      '&lt;b&gt;',       'HTML escaped in code block');
});

// ─── 5. Parser: Links & Images ───────────────────────────────────────────────
describe('Parser: Links', () => {
  assertContains(p('[click](https://x.com)'),          '<a href="https://x.com">click</a>', 'Basic link');
  assertContains(p('[t](https://x.com "My Title")'),   'title="My Title"',                  'Link with title');
  assertContains(p('# [Heading Link](url)'),           'href="url"',                        'Link inside heading');
});

describe('Parser: Images', () => {
  assertContains(p('![alt](img.png)'),            '<img',          'Image tag');
  assertContains(p('![alt](img.png)'),            'src="img.png"', 'Image src');
  assertContains(p('![alt text](img.png)'),       'alt="alt text"','Image alt');
  assertContains(p('![a](i.png "Cap")'),          'title="Cap"',   'Image with title');
});

// ─── 6. Parser: Unordered Lists ──────────────────────────────────────────────
describe('Parser: Unordered Lists', () => {
  const ul = p('- one\n- two\n- three');
  assertContains(ul, '<ul>',           'UL opening tag');
  assertContains(ul, '</ul>',          'UL closing tag');
  assertContains(ul, '<li>one</li>',   'UL item 1');
  assertContains(ul, '<li>two</li>',   'UL item 2');
  assertContains(ul, '<li>three</li>', 'UL item 3');
  assertContains(p('* item'),          '<li>item</li>', 'UL with *');
  assertContains(p('+ item'),          '<li>item</li>', 'UL with +');
  assertContains(p('- **bold** item'), '<strong>bold</strong>', 'Inline bold inside UL item');
});

// ─── 7. Parser: Ordered Lists ────────────────────────────────────────────────
describe('Parser: Ordered Lists', () => {
  const ol = p('1. first\n2. second\n3. third');
  assertContains(ol, '<ol>',              'OL opening tag');
  assertContains(ol, '</ol>',             'OL closing tag');
  assertContains(ol, '<li>first</li>',   'OL item 1');
  assertContains(ol, '<li>second</li>',  'OL item 2');
  assertContains(ol, '<li>third</li>',   'OL item 3');
});

// ─── 8. Parser: Nested Lists ─────────────────────────────────────────────────
describe('Parser: Nested Lists', () => {
  const nested = p('- parent\n  - child 1\n  - child 2\n- sibling');
  assertContains(nested, '<li>child 1</li>',  'Nested child 1');
  assertContains(nested, '<li>child 2</li>',  'Nested child 2');
  assertContains(nested, '<li>sibling</li>',  'Sibling after nested');

  const parentIdx  = nested.indexOf('<li>parent');
  const innerUlIdx = nested.indexOf('<ul>', parentIdx);
  const siblingIdx = nested.indexOf('<li>sibling</li>');
  assert(innerUlIdx > parentIdx, 'Nested UL is inside parent li');
  assert(siblingIdx > innerUlIdx,'Sibling li follows nested UL');

  // Ordered nested in unordered
  const mixed = p('- item\n  1. sub1\n  2. sub2');
  assertContains(mixed, '<ol>',            'OL nested inside UL');
  assertContains(mixed, '<li>sub1</li>',   'OL nested item 1');
  assertContains(mixed, '<li>sub2</li>',   'OL nested item 2');
});

// ─── 9. Parser: Blockquotes ──────────────────────────────────────────────────
describe('Parser: Blockquotes', () => {
  assertContains(p('> hello'),              '<blockquote>',       'Blockquote tag');
  assertContains(p('> hello'),              'hello',              'Blockquote content');
  assertContains(p('> line 1\n> line 2'),   'line 1',             'Multi-line blockquote line 1');
  assertContains(p('> line 1\n> line 2'),   'line 2',             'Multi-line blockquote line 2');
  assertContains(p('> **bold**'),           '<strong>bold</strong>','Inline bold inside blockquote');
});

// ─── 10. Parser: Nested Blockquotes ──────────────────────────────────────────
describe('Parser: Nested Blockquotes', () => {
  const nb      = p('> outer\n> > inner');
  const outerIdx = nb.indexOf('<blockquote>');
  const innerIdx = nb.indexOf('<blockquote>', outerIdx + 1);
  assert(outerIdx >= 0,         'Outer blockquote tag present');
  assert(innerIdx > outerIdx,   'Inner blockquote nested inside outer');
  assertContains(nb, 'outer',   'Outer blockquote content');
  assertContains(nb, 'inner',   'Inner blockquote content');
});

// ─── 11. Parser: Horizontal Rules ────────────────────────────────────────────
describe('Parser: Horizontal Rules', () => {
  assertContains(p('---'),   '<hr>', 'HR with ---');
  assertContains(p('***'),   '<hr>', 'HR with ***');
  assertContains(p('___'),   '<hr>', 'HR with ___');
  assertContains(p('- - -'), '<hr>', 'HR with - - -');
  assertContains(p('* * *'), '<hr>', 'HR with * * *');
  assertContains(p('_ _ _'), '<hr>', 'HR with _ _ _');
});

// ─── 12. Parser: Paragraphs ──────────────────────────────────────────────────
describe('Parser: Paragraphs', () => {
  assertContains(p('Hello world'),          '<p>Hello world</p>', 'Simple paragraph');

  const two = p('First para\n\nSecond para');
  assertContains(two, '<p>First para</p>',  'First paragraph');
  assertContains(two, '<p>Second para</p>', 'Second paragraph');

  assertContains(p('Text **bold** end'),    '<strong>bold</strong>', 'Inline bold in paragraph');
});

// ─── 13. Parser: Line Breaks ─────────────────────────────────────────────────
describe('Parser: Hard Line Breaks', () => {
  const lb = p('Line one  \nLine two');
  assertContains(lb, '<br>', 'Two trailing spaces produce <br>');
});

// ─── 14. Parser: Escape Characters ───────────────────────────────────────────
describe('Parser: Escape Characters', () => {
  assertNotContains(p('\\*not italic\\*'),   '<em>',     'Escaped * is not italic');
  assertContains   (p('\\*not italic\\*'),   '*',        'Escaped * renders as literal asterisk');
  assertNotContains(p('\\**not bold\\**'),   '<strong>', 'Escaped ** is not bold');
  assertContains   (p('\\`not code\\`'),     '`',        'Escaped backtick renders literally');
  assertNotContains(p('\\[not link\\](url)'), '<a',      'Escaped [ is not a link');
});

// ─── 15. Parser Edge Cases ────────────────────────────────────────────────────
describe('Edge Cases: Empty / whitespace input', () => {
  assertEqual(p('').trim(),          '', 'Empty string → empty output');
  assertEqual(p('   \n  \n').trim(), '', 'Only whitespace → empty output');
  assertEqual(p('\n\n\n').trim(),    '', 'Only newlines → empty output');
});

describe('Edge Cases: Unclosed markers', () => {
  assertNotContains(p('**unclosed'), '<strong>unclosed</strong>', 'Unclosed ** not rendered as bold');
  assertNotContains(p('*unclosed'),  '<em>unclosed</em>',         'Unclosed * not rendered as italic');
  assertContains   (p('**unclosed'), '<p>',                       'Unclosed ** still wrapped in paragraph');
});

describe('Edge Cases: Malformed links', () => {
  assertNotContains(p('[text](no close'), '<a',         'Unclosed paren not rendered as link');
  assertNotContains(p('[text]()'),        'href=""',    'Empty href not rendered (empty href)');
  // Image with no src still produces img tag
  const emptyImg = p('![alt]()');
  // Either renders or doesn't — just must not crash
  assert(typeof emptyImg === 'string',                  'Empty image src does not throw');
});

describe('Edge Cases: Consecutive headings', () => {
  const r = p('# H1\n## H2\n### H3');
  assertContains   (r, '<h1>',  'H1 present');
  assertContains   (r, '<h2>',  'H2 present');
  assertContains   (r, '<h3>',  'H3 present');
  assertNotContains(r, '<p>',   'No spurious paragraphs between consecutive headings');
});

describe('Edge Cases: Mixed inline formatting', () => {
  assertContains   (p('**bold** *ital*'),       '<strong>bold</strong>', 'Bold then italic');
  assertContains   (p('**bold** *ital*'),       '<em>ital</em>',         'Italic after bold');
  assertContains   (p('`code` **bold**'),       '<code>code</code>',     'Code then bold');
  assertContains   (p('`code` **bold**'),       '<strong>bold</strong>', 'Bold after code');
  assertNotContains(p('`**inside code**`'),     '<strong>',              'Bold markers not processed inside code');
  assertContains   (p('[link](url) **bold**'),  '<a ',                   'Link then bold (link present)');
  assertContains   (p('[link](url) **bold**'),  '<strong>bold</strong>', 'Link then bold (bold present)');
});

// ─── 16. Toolbar Actions ─────────────────────────────────────────────────────
describe('Toolbar: Bold', () => {
  setEditorState('', 0, 0);
  clickToolbar('bold');
  assertContains(mockEditor.value, '**',     'Bold inserts ** markers with no selection');
  assertContains(mockEditor.value, '굵은 텍스트', 'Bold inserts placeholder text');

  setEditorState('hello world', 6, 11);
  clickToolbar('bold');
  assertEqual(mockEditor.value, 'hello **world**', 'Bold wraps selected text');
});

describe('Toolbar: Italic', () => {
  setEditorState('', 0, 0);
  clickToolbar('italic');
  assertContains(mockEditor.value, '*', 'Italic inserts * markers with no selection');

  setEditorState('test text', 5, 9);
  clickToolbar('italic');
  assertEqual(mockEditor.value, 'test *text*', 'Italic wraps selected text');
});

describe('Toolbar: Heading H1', () => {
  setEditorState('My Title', 0, 0);
  clickToolbar('h1');
  assertContains(mockEditor.value, '# My Title', 'H1 prefix added');
});

describe('Toolbar: Heading H2', () => {
  setEditorState('My Title', 0, 0);
  clickToolbar('h2');
  assertContains(mockEditor.value, '## My Title', 'H2 prefix added');
});

describe('Toolbar: Heading H3', () => {
  setEditorState('My Title', 0, 0);
  clickToolbar('h3');
  assertContains(mockEditor.value, '### My Title', 'H3 prefix added');
});

describe('Toolbar: Heading replaces existing prefix', () => {
  setEditorState('## Old', 0, 0);
  clickToolbar('h1');
  assertContains   (mockEditor.value, '# Old', 'H1 replaces existing ## prefix');
  assertNotContains(mockEditor.value, '##',    '## prefix removed');
});

describe('Toolbar: Link', () => {
  setEditorState('', 0, 0);
  clickToolbar('link');
  assertContains(mockEditor.value, '[',       'Link inserts [');
  assertContains(mockEditor.value, '](url)',  'Link inserts ](url)');

  setEditorState('click here', 6, 10);  // 'here' selected
  clickToolbar('link');
  assertContains(mockEditor.value, '[here](url)', 'Link uses selected text as label');
});

describe('Toolbar: Image', () => {
  setEditorState('', 0, 0);
  clickToolbar('image');
  assertContains(mockEditor.value, '![',         'Image inserts ![');
  assertContains(mockEditor.value, '](image-url)','Image inserts ](image-url)');

  setEditorState('My Alt', 3, 6);  // 'Alt' selected
  clickToolbar('image');
  assertContains(mockEditor.value, '![Alt](image-url)', 'Image uses selection as alt text');
});

describe('Toolbar: Code Block', () => {
  setEditorState('', 0, 0);
  clickToolbar('code');
  assertContains(mockEditor.value, '```', 'Code block inserts ``` fence (no selection)');

  setEditorState('some code', 0, 9);
  clickToolbar('code');
  assertContains(mockEditor.value, '```\nsome code\n```', 'Code block wraps selected text');
});

describe('Toolbar: Unordered List (toggle)', () => {
  setEditorState('item text', 0, 0);
  clickToolbar('ul');
  assertContains(mockEditor.value, '- item text', 'UL prefix added');

  setEditorState('- item text', 0, 0);
  clickToolbar('ul');
  assertEqual(mockEditor.value, 'item text', 'UL prefix toggled off');
});

describe('Toolbar: Ordered List (toggle)', () => {
  setEditorState('first', 0, 0);
  clickToolbar('ol');
  assertContains(mockEditor.value, '1. first', 'OL prefix added');

  setEditorState('1. first', 0, 0);
  clickToolbar('ol');
  assertEqual(mockEditor.value, 'first', 'OL prefix toggled off');
});

describe('Toolbar: Blockquote (toggle)', () => {
  setEditorState('some text', 0, 0);
  clickToolbar('blockquote');
  assertContains(mockEditor.value, '> some text', 'Blockquote prefix added');

  setEditorState('> some text', 0, 0);
  clickToolbar('blockquote');
  assertEqual(mockEditor.value, 'some text', 'Blockquote prefix toggled off');
});

describe('Toolbar: Horizontal Rule', () => {
  setEditorState('', 0, 0);
  clickToolbar('hr');
  assertContains(mockEditor.value, '---', 'HR inserts ---');
});

// ─── 17. Keyboard Shortcuts ───────────────────────────────────────────────────
describe('Keyboard Shortcuts', () => {
  setEditorState('bold test', 0, 9);
  simulateKeydown('b');
  assertContains(mockEditor.value, '**bold test**', 'Ctrl+B applies bold to selection');

  setEditorState('italic test', 0, 11);
  simulateKeydown('i');
  assertContains(mockEditor.value, '*italic test*', 'Ctrl+I applies italic to selection');

  setEditorState('click here', 6, 10);  // 'here'
  simulateKeydown('k');
  assertContains(mockEditor.value, '[here](url)', 'Ctrl+K wraps selection as link label');

  // Non-modifier keys should not trigger actions
  setEditorState('abc', 0, 3);
  simulateKeydown('b', false);  // no ctrl
  assertNotContains(mockEditor.value, '**', 'Key without Ctrl does not apply bold');
});

// ─── 18. localStorage: Auto-Save / Restore ────────────────────────────────────
describe('localStorage: Auto-Save', () => {
  mockLocalStorage.clear();

  mockEditor.value = '# Auto-Saved Content';
  simulateInput();

  const saved = mockLocalStorage.getItem('md-editor-content');
  assertEqual(saved, '# Auto-Saved Content', 'Content saved to localStorage on input event');
});

describe('localStorage: Multiple saves keep latest', () => {
  mockLocalStorage.clear();

  mockEditor.value = 'first value';
  simulateInput();
  mockEditor.value = 'second value';
  simulateInput();

  assertEqual(mockLocalStorage.getItem('md-editor-content'), 'second value', 'Latest value overwrites earlier save');
});

describe('localStorage: Returns null when empty', () => {
  mockLocalStorage.clear();
  assertEqual(mockLocalStorage.getItem('md-editor-content'), null, 'Empty localStorage returns null');
});

describe('localStorage: Data survives clear/restore cycle', () => {
  mockLocalStorage.clear();
  mockLocalStorage.setItem('md-editor-content', '# Persisted');
  const val = mockLocalStorage.getItem('md-editor-content');
  assertEqual(val, '# Persisted', 'Manually stored value is retrievable');
});

// ─── 19. Export HTML ─────────────────────────────────────────────────────────
describe('Export HTML: structure', () => {
  capturedBlob = null;
  mockEditor.value = '# Export Test\n\nThis is **bold** text.\n\n```javascript\nconsole.log("hi");\n```';

  assert(typeof exportClickHandler === 'function', 'Export button handler was registered');
  if (exportClickHandler) exportClickHandler();

  assert(capturedBlob !== null, 'Blob was created during export');

  if (capturedBlob) {
    assertContains(capturedBlob.content, '<!DOCTYPE html>',    'Export output has DOCTYPE');
    assertContains(capturedBlob.content, '<html',              'Export output has <html> tag');
    assertContains(capturedBlob.content, '<head>',             'Export output has <head>');
    assertContains(capturedBlob.content, '<body>',             'Export output has <body>');
    assertContains(capturedBlob.content, '<style>',            'Export output includes CSS styles');
    assert(capturedBlob.type.includes('text/html'),            'Blob MIME type is text/html');
  }
});

describe('Export HTML: rendered markdown content', () => {
  if (!capturedBlob) {
    fail('Skipping: no capturedBlob from previous section');
    return;
  }
  assertContains(capturedBlob.content, '<h1>',                  'Exported H1 heading tag');
  assertContains(capturedBlob.content, 'Export Test',           'Exported heading text');
  assertContains(capturedBlob.content, '<strong>bold</strong>', 'Exported bold text rendered');
  assertContains(capturedBlob.content, '<code',                 'Exported code block tag');
  assertContains(capturedBlob.content, 'console.log',           'Exported code block content');
});

describe('Export HTML: sanitised content', () => {
  capturedBlob = null;
  mockEditor.value = '# <script>alert("xss")</script>\n\n`<b>code</b>`';
  if (exportClickHandler) exportClickHandler();

  if (capturedBlob) {
    assertNotContains(capturedBlob.content, '<script>alert',    'Raw <script> tag not in exported heading');
    assertContains   (capturedBlob.content, '&lt;b&gt;',        'Code content is HTML-escaped in export');
  } else {
    fail('capturedBlob not created for sanitisation test');
  }
});

// ─── 20. Security: URL validation (isSafeUrl) ────────────────────────────────
describe('Security: javascript: URI in links blocked', () => {
  const jsLink = p('[xss](javascript:alert(1))');
  assertNotContains(jsLink, 'javascript:',       'javascript: href not rendered in link');
  assertContains   (jsLink, '<a href="#">',       'Blocked link falls back to safe #');
  assertContains   (jsLink, 'xss',               'Link label still rendered');

  // Obfuscated variants
  assertNotContains(p('[x](JAVASCRIPT:alert(1))'),      'JAVASCRIPT:',  'Uppercase JAVASCRIPT: blocked');
  assertNotContains(p('[x](javascript\t:alert(1))'),    'javascript',   'Tab-obfuscated javascript: blocked');
  assertNotContains(p('[x](  javascript:void(0))'),     'javascript:',  'Leading-space javascript: blocked');
  assertNotContains(p('[x](vbscript:msgbox(1))'),       'vbscript:',    'vbscript: blocked');
  assertNotContains(p('[x](data:text/html,<h1>x</h1>)'), 'data:',       'data: URI blocked');
});

describe('Security: javascript: URI in image src blocked', () => {
  const jsImg = p('![alt](javascript:alert(1))');
  assertNotContains(jsImg, 'javascript:',    'javascript: src not rendered in image');
  assertNotContains(jsImg, 'src=',           'Blocked image has no src attribute');
  assertContains   (jsImg, 'alt="alt"',      'Image alt still rendered when src blocked');
});

describe('Security: Safe URLs pass through', () => {
  assertContains(p('[ok](https://example.com)'),        'href="https://example.com"', 'https: link allowed');
  assertContains(p('[ok](http://example.com)'),         'href="http://example.com"',  'http: link allowed');
  assertContains(p('[ok](mailto:hi@example.com)'),      'href="mailto:hi@example.com"','mailto: link allowed');
  assertContains(p('[ok](/relative/path)'),             'href="/relative/path"',      'Relative path allowed');
  assertContains(p('![img](https://example.com/a.png)'),'src="https://example.com/a.png"','https: image src allowed');
});

describe('Security: HTML special chars escaped in text', () => {
  assertContains(p('a & b'),                  '&amp;',       '& escaped in paragraph');
  assertContains(p("<script>alert</script>"),  '&lt;script&gt;','<script> escaped in paragraph');
  assertContains(p("# <b>heading</b>"),        '&lt;b&gt;',   '<b> escaped in heading');
  // Single quote in link title
  assertContains(p("[t](u \"it's a title\")"), '&#39;',       "Single quote escaped in link title");
});

// ─── 21. Resizer: keyboard accessibility ────────────────────────────────────
describe('Resizer: keyboard handler registered', () => {
  assert(typeof mockResizer._listeners['keydown'] === 'function',
    'Resizer keydown handler registered for keyboard accessibility');
  assert(typeof mockResizer._listeners['mousedown'] === 'function',
    'Resizer mousedown handler registered');
  assert(typeof mockResizer._listeners['touchstart'] === 'function',
    'Resizer touchstart handler registered for touch support');
});

describe('Resizer: ArrowRight enlarges editor pane', () => {
  const handler = mockResizer._listeners['keydown'];
  if (!handler) { fail('No keydown handler on resizer'); return; }

  // Set up a mock parentElement on editorPane so isVerticalLayout() works
  mockEditorPane.parentElement = {
    offsetWidth:  1000,
    offsetHeight: 600,
  };
  editorCtx.window = {
    getComputedStyle: () => ({ flexDirection: 'row' }),
    innerWidth: 1280,
  };
  mockEditorPane.offsetWidth  = 500;
  mockPreviewPane.offsetWidth = 494; // 1000 - 6(resizer) = 994, split

  handler({ key: 'ArrowRight', preventDefault: () => {} });

  // After ArrowRight, editor pane should be wider than 500px
  const newFlex = mockEditorPane.style.flex;
  assert(newFlex !== '', 'flex style updated after ArrowRight');
  const match = newFlex.match(/(\d+(?:\.\d+)?)px/);
  if (match) {
    assert(Number(match[1]) > 500, 'Editor pane width increased after ArrowRight');
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n\x1b[1m========================================\x1b[0m');
console.log('\x1b[1m Results\x1b[0m');
console.log('\x1b[1m========================================\x1b[0m');
console.log(`  \x1b[32mPassed: ${passed}\x1b[0m`);
console.log(`  \x1b[31mFailed: ${failed}\x1b[0m`);
console.log(`  Total:  ${passed + failed}`);
console.log('\x1b[1m========================================\x1b[0m\n');

process.exit(failed > 0 ? 1 : 0);
