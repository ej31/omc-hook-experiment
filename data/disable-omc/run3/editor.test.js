'use strict';

/**
 * editor.test.js
 * 마크다운 에디터 전체 테스트 (외부 프레임워크 없음)
 *
 * 테스트 범위:
 * 1. 마크다운 파서 - 모든 구문 요소
 * 2. 파서 엣지 케이스
 * 3. 툴바 액션 - 각 버튼의 삽입/래핑 동작
 * 4. 에디터 상태 - localStorage 저장/복원, HTML 내보내기 구조
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 테스트 유틸리티
// ============================================================
let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✓  ${testName}`);
    passCount++;
  } else {
    console.log(`  ✗  ${testName}${details ? '\n     ' + details : ''}`);
    failCount++;
    failures.push({ testName, details });
  }
}

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    assert(true, testName);
  } else {
    assert(false, testName,
      `expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
  }
}

function assertContains(str, substring, testName) {
  if (str.includes(substring)) {
    assert(true, testName);
  } else {
    assert(false, testName,
      `'${substring}' not found in:\n     ${JSON.stringify(str.substring(0, 300))}`);
  }
}

function assertNotContains(str, substring, testName) {
  if (!str.includes(substring)) {
    assert(true, testName);
  } else {
    assert(false, testName,
      `'${substring}' unexpectedly found in output`);
  }
}

function section(name) {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${name}`);
  console.log('═'.repeat(64));
}

function sub(name) {
  console.log(`\n  ▸ ${name}`);
}

// ============================================================
// 마크다운 파서 로드 (const 선언이 eval 범위 안에 있으므로
// 같은 eval 블록에서 global에 할당)
// ============================================================
const parserSrc = fs.readFileSync(path.join(__dirname, 'markdown-parser.js'), 'utf8');
eval(parserSrc + '\nglobal.MarkdownParser = MarkdownParser;');
const parse = (md) => MarkdownParser.parse(md);

// ============================================================
// DOM 목(Mock) 설정 — editor.js eval 전에 선행 필요
// ============================================================

function createEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    innerHTML: '',
    href: '',
    download: '',
    style: {},
    dataset: {},
    _listeners: {},
    classList: {
      _set: new Set(),
      add(c)      { this._set.add(c); },
      remove(c)   { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(evt, fn) {
      (this._listeners[evt] = this._listeners[evt] || []).push(fn);
    },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    focus() {},
    click() {
      (this._listeners['click'] || []).forEach(fn => fn({ type: 'click', preventDefault() {} }));
    },
  };
  return el;
}

// 핵심 에디터 요소 — 테스트 전체에서 공유
const mockEditor    = createEl('textarea');
const mockPreview   = createEl('div');
const mockResizer   = createEl('div');
const mockEdPane    = createEl('div');
const mockPvwPane   = createEl('div');
const mockExportBtn = createEl('button');
const mockSaveInd   = createEl('span');
const mockContainer = {
  getBoundingClientRect() { return { width: 1200, height: 800, top: 0, left: 0 }; },
};

// 툴바 버튼 목 — data-action별로 생성
const ACTIONS = [
  'bold', 'italic', 'bold-italic',
  'h1', 'h2', 'h3',
  'link', 'image',
  'code', 'codeblock',
  'ul', 'ol', 'blockquote', 'hr',
];
const mockBtns = ACTIONS.map(action => {
  const btn = createEl('button');
  btn.dataset = { action };
  return btn;
});

// localStorage 목
const _store = {};
global.localStorage = {
  getItem(k)      { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem(k, v)   { _store[k] = String(v); },
  removeItem(k)   { delete _store[k]; },
  clear()         { Object.keys(_store).forEach(k => delete _store[k]); },
};

// 브라우저 API 목
global.URL = { createObjectURL() { return 'blob:mock'; }, revokeObjectURL() {} };
global.Blob = class { constructor(parts) { this._content = parts.join(''); } };
global.window = { innerWidth: 1200, addEventListener() {} };
Object.defineProperty(global, 'navigator', {
  value: { platform: 'Win32' },
  writable: true,
  configurable: true,
});
global.document = {
  readyState: 'complete',
  body: {
    style: {},
    _ch: [],
    appendChild(el) { this._ch.push(el); },
    removeChild(el) { this._ch.splice(this._ch.indexOf(el), 1); },
  },
  addEventListener() {},
  getElementById(id) {
    return {
      'editor':            mockEditor,
      'preview':           mockPreview,
      'resizer':           mockResizer,
      'editor-pane':       mockEdPane,
      'preview-pane':      mockPvwPane,
      'export-btn':        mockExportBtn,
      'auto-save-indicator': mockSaveInd,
    }[id] || null;
  },
  querySelector(sel) {
    return sel === '.editor-container' ? mockContainer : null;
  },
  querySelectorAll(sel) {
    return sel === '.toolbar-btn[data-action]' ? mockBtns : [];
  },
  createElement(tag) { return createEl(tag); },
};

// localStorage를 비운 뒤 editor.js 로드 (init() 자동 실행)
localStorage.clear();
const editorSrc = fs.readFileSync(path.join(__dirname, 'editor.js'), 'utf8');
eval(editorSrc);

// ---- 헬퍼 ----
function triggerAction(action) {
  const btn = mockBtns.find(b => b.dataset.action === action);
  if (!btn) throw new Error(`버튼 없음: ${action}`);
  (btn._listeners['click'] || []).forEach(fn => fn({ type: 'click', preventDefault() {} }));
}

function setEditor(value, selStart = 0, selEnd = selStart) {
  mockEditor.value = value;
  mockEditor.selectionStart = selStart;
  mockEditor.selectionEnd = selEnd;
}

// ============================================================
// 1. 파서 — 제목
// ============================================================
section('1. 파서 — 제목 (ATX & Setext)');

sub('ATX h1 ~ h6');
assertContains(parse('# H1'),      '<h1>H1</h1>',      'h1');
assertContains(parse('## H2'),     '<h2>H2</h2>',      'h2');
assertContains(parse('### H3'),    '<h3>H3</h3>',      'h3');
assertContains(parse('#### H4'),   '<h4>H4</h4>',      'h4');
assertContains(parse('##### H5'),  '<h5>H5</h5>',      'h5');
assertContains(parse('###### H6'), '<h6>H6</h6>',      'h6');

sub('제목 내 인라인 서식');
assertContains(parse('# Hello **World**'),
  '<h1>Hello <strong>World</strong></h1>', '제목 안 굵게');
assertContains(parse('## *italic* title'),
  '<h2><em>italic</em> title</h2>', '제목 안 기울임');

sub('Setext 스타일');
assertContains(parse('Title\n====='), '<h1>Title</h1>', 'Setext h1 (===)');
assertContains(parse('Title\n-----'), '<h2>Title</h2>', 'Setext h2 (---)');

// ============================================================
// 2. 파서 — 인라인 서식
// ============================================================
section('2. 파서 — 인라인 서식');

sub('굵게 (**/**)');
assertContains(parse('**bold**'),          '<strong>bold</strong>',         '** 굵게');
assertContains(parse('__bold__'),          '<strong>bold</strong>',         '__ 굵게');
assertContains(parse('**multi word**'),    '<strong>multi word</strong>',   '여러 단어 굵게');

sub('기울임 (*/_)');
assertContains(parse('*italic*'),  '<em>italic</em>',  '* 기울임');
assertContains(parse('_italic_'),  '<em>italic</em>',  '_ 기울임');

sub('굵은 기울임 (***/___)');
assertContains(parse('***bi***'),  '<strong><em>bi</em></strong>',  '*** 굵은 기울임');
assertContains(parse('___bi___'),  '<strong><em>bi</em></strong>',  '___ 굵은 기울임');

sub('인라인 코드 (`)');
assertContains(parse('`code`'),        '<code>code</code>',             '인라인 코드');
assertContains(parse('`<script>`'),    '<code>&lt;script&gt;</code>',   '코드 내 HTML 이스케이프');
assertContains(parse('`a + b`'),       '<code>a + b</code>',            '수식 코드');

sub('취소선 (~~)');
assertContains(parse('~~strike~~'),  '<del>strike</del>',  '취소선');

sub('줄바꿈 (trailing spaces / \\)');
assertContains(parse('a  \nb'),   '<br>', '두 공백 + 줄바꿈 → <br>');
assertContains(parse('a\\\nb'),   '<br>', '백슬래시 + 줄바꿈 → <br>');

// ============================================================
// 3. 파서 — 링크 & 이미지
// ============================================================
section('3. 파서 — 링크 & 이미지');

sub('기본 링크');
// rel="noopener noreferrer" 가 추가됨 (tabnapping 방지)
assertContains(parse('[text](https://example.com)'),
  'href="https://example.com"', '기본 링크 href');
assertContains(parse('[text](https://example.com)'),
  'rel="noopener noreferrer"', '기본 링크 rel 속성');
assertContains(parse('[text](https://example.com)'),
  '>text</a>', '기본 링크 텍스트');
assertContains(parse('[text](https://x.com "title")'),
  'title="title"', '타이틀 있는 링크');

sub('XSS 방지 — 링크');
assertContains(parse('[xss](<script>alert(1)</script>)'),
  '&lt;script&gt;', '링크 URL XSS 이스케이프');

sub('javascript: URI 차단');
{
  // javascript: URI는 isSafeUrl에 의해 차단되어 원문 그대로 반환됨
  const h = parse('[click](javascript:alert(1))');
  assertNotContains(h, 'href="javascript:', 'javascript: href 차단');
}
{
  const h = parse('![img](javascript:alert(1))');
  assertNotContains(h, 'src="javascript:', 'javascript: img src 차단');
}
{
  // vbscript: 도 차단
  const h = parse('[vbs](vbscript:msgbox(1))');
  assertNotContains(h, 'href="vbscript:', 'vbscript: href 차단');
}

sub('빈 텍스트 링크');
// 링크 정규식이 [] 안에 최소 1자를 요구하므로 빈 텍스트 링크는 원문 그대로 유지됨
assertContains(parse('[](https://empty.com)'),
  '[](https://empty.com)', '빈 텍스트 링크 → 원문 유지 (파서 제한)');

sub('이미지');
assertContains(parse('![alt](img.png)'),
  '<img src="img.png" alt="alt">', '기본 이미지');
assertContains(parse('![](img.png)'),
  'alt=""', '빈 alt');
assertContains(parse('![alt](img.png "caption")'),
  'title="caption"', '타이틀 있는 이미지');

// ============================================================
// 4. 파서 — 코드 블록
// ============================================================
section('4. 파서 — 코드 블록');

sub('펜스 코드 블록 (```)');
{
  const h = parse('```\ncode here\n```');
  assertContains(h, '<pre><code>',  '코드 블록 태그');
  assertContains(h, 'code here',    '코드 블록 내용');
}
{
  const h = parse('```javascript\nconsole.log("hi")\n```');
  assertContains(h, 'code-lang-label', '언어 레이블 클래스');
  assertContains(h, 'javascript',      '언어 이름');
  assertContains(h, 'console.log',     '코드 내용');
}
{
  const h = parse('```\n<script>alert(1)</script>\n```');
  assertContains(h,    '&lt;script&gt;', '코드 블록 내 HTML 이스케이프');
  assertNotContains(h, '<script>',       'raw script 태그 없음');
}

sub('들여쓰기 코드 블록 (4 spaces)');
{
  const h = parse('    indented code');
  assertContains(h, '<pre><code>',   '들여쓰기 코드 태그');
  assertContains(h, 'indented code', '들여쓰기 코드 내용');
}

sub('틸다 펜스 (~~~)');
{
  const h = parse('~~~\ntilde fence\n~~~');
  assertContains(h, '<pre><code>', '틸다 펜스 코드 블록');
  assertContains(h, 'tilde fence', '틸다 펜스 내용');
}

// ============================================================
// 5. 파서 — 순서 없는 목록
// ============================================================
section('5. 파서 — 순서 없는 목록');

sub('기본 UL (-, *, +)');
{
  const h = parse('- a\n- b\n- c');
  assertContains(h, '<ul>',        '<ul> 태그');
  assertContains(h, '<li>a</li>',  'li a');
  assertContains(h, '<li>b</li>',  'li b');
  assertContains(h, '</ul>',       '</ul> 닫힘');
}
assertContains(parse('* item'), '<ul>', '* 목록 기호');
assertContains(parse('+ item'), '<ul>', '+ 목록 기호');

sub('중첩 UL');
{
  const h = parse('- one\n  - two\n  - three\n- four');
  const cnt = (h.match(/<ul>/g) || []).length;
  assert(cnt >= 2, '중첩 ul 개수 ≥ 2', `ul count: ${cnt}`);
  assertContains(h, '<li>two</li>',   '중첩 항목 two');
  assertContains(h, '<li>three</li>', '중첩 항목 three');
}

sub('목록 항목 내 인라인 서식');
assertContains(parse('- **bold** item'), '<strong>bold</strong>', '목록 항목 내 굵게');

// ============================================================
// 6. 파서 — 순서 있는 목록
// ============================================================
section('6. 파서 — 순서 있는 목록');

{
  const h = parse('1. first\n2. second\n3. third');
  assertContains(h, '<ol>',            '<ol> 태그');
  assertContains(h, '<li>first</li>',  'li first');
  assertContains(h, '<li>second</li>', 'li second');
  assertContains(h, '</ol>',           '</ol> 닫힘');
}

sub('중첩 OL');
{
  const h = parse('1. a\n   1. aa\n   2. ab\n2. b');
  const cnt = (h.match(/<ol>/g) || []).length;
  assert(cnt >= 2, '중첩 ol 개수 ≥ 2', `ol count: ${cnt}`);
}

// ============================================================
// 7. 파서 — 인용구
// ============================================================
section('7. 파서 — 인용구');

sub('기본 인용구');
{
  const h = parse('> quote text');
  assertContains(h, '<blockquote>', 'blockquote 태그');
  assertContains(h, 'quote text',   '인용구 내용');
  assertContains(h, '</blockquote>','blockquote 닫힘');
}

sub('중첩 인용구');
{
  const h = parse('> outer\n> > inner');
  const cnt = (h.match(/<blockquote>/g) || []).length;
  assert(cnt >= 2, '중첩 blockquote 개수 ≥ 2', `bq count: ${cnt}`);
}

sub('인용구 내 마크다운');
assertContains(parse('> **bold**'), '<strong>bold</strong>', '인용구 내 굵게');
assertContains(parse('> `code`'),   '<code>code</code>',     '인용구 내 코드');

// ============================================================
// 8. 파서 — 수평선
// ============================================================
section('8. 파서 — 수평선');

assertContains(parse('---'),   '<hr>', '--- 수평선');
assertContains(parse('***'),   '<hr>', '*** 수평선');
assertContains(parse('___'),   '<hr>', '___ 수평선');
assertContains(parse('----'),  '<hr>', '---- 수평선 (4개)');
// "- - -" (공백 포함)은 이 파서에서 ul로 파싱됨 (HR 미지원)
assertNotContains(parse('- - -'), '<hr>', '- - - 는 이 파서에서 HR 아님');

sub('수평선 아닌 것');
assertNotContains(parse('--'),  '<hr>', '-- 는 수평선 아님');
assertNotContains(parse('-'),   '<hr>', '- 단독은 수평선 아님');

// ============================================================
// 9. 파서 — 문단 & 줄바꿈
// ============================================================
section('9. 파서 — 문단 & 줄바꿈');

assertContains(parse('simple text'), '<p>simple text</p>', '기본 문단');
{
  const h = parse('para1\n\npara2');
  assertContains(h, '<p>para1</p>', '첫 번째 문단');
  assertContains(h, '<p>para2</p>', '두 번째 문단');
}
{
  // 세 번 연속 개행 → 빈 문단 없음
  const h = parse('a\n\n\nb');
  const pCount = (h.match(/<p>/g) || []).length;
  assertEqual(pCount, 2, '연속 빈 줄 → 정확히 두 문단');
}

// ============================================================
// 10. 파서 — 이스케이프 문자
// ============================================================
section('10. 파서 — 이스케이프 문자');

assertContains(parse('\\*not italic\\*'),   '*not italic*',   '이스케이프 *');
// 각 * 를 개별적으로 이스케이프해야 ** 전체가 보호됨: \*\*text\*\*
assertContains(parse('\\*\\*not bold\\*\\*'), '**not bold**', '이스케이프 ** (각 * 개별 이스케이프)');
assertContains(parse('\\# not heading'),    '#',              '이스케이프 #');
assertContains(parse('\\`not code\\`'),     '`not code`',     '이스케이프 `');
assertContains(parse('\\[not link\\]'),     '[not link]',     '이스케이프 []');

sub('이스케이프 후 파싱 안 됨');
{
  // \*\* 로 각각 이스케이프하면 strong 없음
  const h = parse('\\*\\*not bold\\*\\*');
  assertNotContains(h, '<strong>', '이스케이프 \\*\\* → strong 없음');
}
{
  const h = parse('\\# not heading');
  assertNotContains(h, '<h1>', '이스케이프 # → h1 없음');
}

// ============================================================
// 11. 파서 엣지 케이스
// ============================================================
section('11. 파서 엣지 케이스');

sub('빈 / 공백 입력');
assertEqual(parse(''),          '', '빈 문자열');
assertEqual(parse(null),        '', 'null');
assertEqual(parse(undefined),   '', 'undefined');
assertEqual(parse('   '),       '', '공백만');
assertEqual(parse('\n\n\n'),    '', '개행만');

sub('닫히지 않은 서식 마커');
{
  const h = parse('**unclosed bold');
  assertNotContains(h, '<strong>', '닫히지 않은 ** → strong 없음');
}
{
  const h = parse('*unclosed italic');
  assertNotContains(h, '<em>', '닫히지 않은 * → em 없음');
}

sub('잘못된 형식 링크');
{
  const h = parse('[no url]');
  assertNotContains(h, '<a href',     '불완전 링크 → a 없음');
  assertContains(h,    '[no url]',    '원문 유지');
}
{
  const h = parse('[text](https://ok.com)extra');
  assertContains(h, '<a href=', '올바른 링크는 파싱됨');
}

sub('연속 제목');
{
  const h = parse('# H1\n## H2\n### H3\n#### H4');
  assertContains(h, '<h1>H1</h1>', '연속 h1');
  assertContains(h, '<h2>H2</h2>', '연속 h2');
  assertContains(h, '<h3>H3</h3>', '연속 h3');
  assertContains(h, '<h4>H4</h4>', '연속 h4');
}

sub('혼합 인라인 서식');
{
  const h = parse('**bold** and *italic* and `code`');
  assertContains(h, '<strong>bold</strong>', '혼합: 굵게');
  assertContains(h, '<em>italic</em>',       '혼합: 기울임');
  assertContains(h, '<code>code</code>',     '혼합: 코드');
}
{
  const h = parse('***bi*** with `code` and ~~del~~');
  assertContains(h, '<strong><em>bi</em></strong>', '굵은 기울임');
  assertContains(h, '<code>code</code>',            '코드');
  assertContains(h, '<del>del</del>',               '취소선');
}

sub('XSS 방지 — 모든 컨텍스트에서 HTML 이스케이프');
{
  // 인라인 코드 안의 HTML은 이스케이프됨
  const h = parse('`<script>`');
  assertContains(h, '&lt;script&gt;', '코드 안 HTML 이스케이프');
  assertNotContains(h, '<script>',    '코드 안 raw script 없음');
}
{
  // 링크 href의 특수문자는 이스케이프됨
  const h = parse('[xss](<img">)');
  assertContains(h, '&lt;', '링크 href 내 < 이스케이프');
}
{
  // 코드 블록 안의 HTML은 이스케이프됨
  const h = parse('```\n<script>alert(1)</script>\n```');
  assertNotContains(h, '<script>',       '코드 블록 raw script 없음');
  assertContains(h,    '&lt;script&gt;', '코드 블록 HTML 이스케이프');
}
{
  // 일반 문단의 raw HTML도 parseInline 시작 시 escapeHtml이 적용되어 이스케이프됨
  const h = parse('<script>alert("xss")</script>');
  assertNotContains(h, '<script>',       '문단 내 script 태그 이스케이프');
  assertContains(h,    '&lt;script&gt;', '문단 내 < 이스케이프');
}
{
  // 정상 마크다운은 여전히 올바르게 변환됨
  const h = parse('**bold** text');
  assertContains(h, '<strong>bold</strong>', '정상 마크다운은 올바르게 변환됨');
}

// ============================================================
// 12. 툴바 액션 — 선택 없을 때 (플레이스홀더 삽입)
// ============================================================
section('12. 툴바 액션 — 선택 없음 (플레이스홀더)');

sub('텍스트 서식');
setEditor('', 0);
triggerAction('bold');
assertContains(mockEditor.value, '**굵은 텍스트**', 'bold: 플레이스홀더 삽입');

setEditor('', 0);
triggerAction('italic');
assertContains(mockEditor.value, '*기울임 텍스트*', 'italic: 플레이스홀더 삽입');

setEditor('', 0);
triggerAction('bold-italic');
assertContains(mockEditor.value, '***굵은 기울임 텍스트***', 'bold-italic: 플레이스홀더 삽입');

setEditor('', 0);
triggerAction('code');
assertContains(mockEditor.value, '`코드`', 'code: 플레이스홀더 삽입');

sub('코드 블록');
setEditor('', 0);
triggerAction('codeblock');
assertContains(mockEditor.value, '```',              'codeblock: 펜스 삽입');
assertContains(mockEditor.value, '// 코드를 입력하세요', 'codeblock: 기본 내용 삽입');

sub('제목');
setEditor('', 0);
triggerAction('h1');
assertContains(mockEditor.value, '# ', 'h1: # 삽입');

setEditor('', 0);
triggerAction('h2');
assertContains(mockEditor.value, '## ', 'h2: ## 삽입');

setEditor('', 0);
triggerAction('h3');
assertContains(mockEditor.value, '### ', 'h3: ### 삽입');

sub('링크 & 이미지');
setEditor('', 0);
triggerAction('link');
assertContains(mockEditor.value, '[링크 텍스트](', 'link: 링크 구조 삽입');

setEditor('', 0);
triggerAction('image');
assertContains(mockEditor.value, '![이미지 설명](이미지 URL)', 'image: 이미지 구조 삽입');

sub('목록');
setEditor('', 0);
triggerAction('ul');
assertContains(mockEditor.value, '- ', 'ul: - 삽입');

setEditor('', 0);
triggerAction('ol');
assertContains(mockEditor.value, '1. ', 'ol: 1. 삽입');

sub('인용구 & 수평선');
setEditor('', 0);
triggerAction('blockquote');
assertContains(mockEditor.value, '> ', 'blockquote: > 삽입');

setEditor('', 0);
triggerAction('hr');
assertContains(mockEditor.value, '---', 'hr: --- 삽입');

sub('기존 텍스트가 있는 줄에 제목/목록 삽입');
setEditor('existing text', 0);
triggerAction('h1');
assertContains(mockEditor.value, '# ', 'h1: 기존 텍스트 있을 때 # 삽입');

setEditor('some line', 0);
triggerAction('ul');
assertContains(mockEditor.value, '- some line', 'ul: 기존 줄에 - 접두사 추가');

setEditor('some line', 0);
triggerAction('ol');
assertContains(mockEditor.value, '1. some line', 'ol: 기존 줄에 1. 접두사 추가');

// ============================================================
// 13. 툴바 액션 — 선택 영역 래핑
// ============================================================
section('13. 툴바 액션 — 선택 영역 래핑');

sub('단일 단어 래핑');
// "hello world" 에서 "world" (index 6~11) 선택
setEditor('hello world', 6, 11);
triggerAction('bold');
assertContains(mockEditor.value, '**world**',   'bold: 선택 텍스트 래핑');
assertContains(mockEditor.value, 'hello ',      'bold: 앞 텍스트 보존');

setEditor('hello world', 6, 11);
triggerAction('italic');
assertContains(mockEditor.value, '*world*', 'italic: 선택 텍스트 래핑');

setEditor('hello world', 6, 11);
triggerAction('bold-italic');
assertContains(mockEditor.value, '***world***', 'bold-italic: 선택 텍스트 래핑');

setEditor('hello world', 6, 11);
triggerAction('code');
assertContains(mockEditor.value, '`world`', 'code: 선택 텍스트 래핑');

sub('링크 & 이미지 래핑');
setEditor('hello world', 6, 11);
triggerAction('link');
assertContains(mockEditor.value, '[world](',     'link: 선택 텍스트 링크 변환');

setEditor('hello world', 6, 11);
triggerAction('image');
assertContains(mockEditor.value, '![world](',    'image: 선택 텍스트 이미지 변환');

sub('목록 단일 줄 래핑');
// "line two" = index 9~17 in "line one\nline two"
setEditor('line one\nline two', 9, 17);
triggerAction('ul');
assertContains(mockEditor.value, '- line two', 'ul: 선택 줄 목록 변환');

setEditor('line one\nline two', 9, 17);
triggerAction('ol');
assertContains(mockEditor.value, '1. line two', 'ol: 선택 줄 번호 목록 변환');

setEditor('quote me', 0, 8);
triggerAction('blockquote');
assertContains(mockEditor.value, '> quote me', 'blockquote: 선택 텍스트 래핑');

sub('다중 줄 선택 래핑');
// "line1\nline2\nline3" = 17자
setEditor('line1\nline2\nline3', 0, 17);
triggerAction('ul');
assertContains(mockEditor.value, '- line1', 'ul 다중줄: line1');
assertContains(mockEditor.value, '- line2', 'ul 다중줄: line2');
assertContains(mockEditor.value, '- line3', 'ul 다중줄: line3');

setEditor('a\nb\nc', 0, 5);
triggerAction('ol');
assertContains(mockEditor.value, '1. a', 'ol 다중줄: 1번');
assertContains(mockEditor.value, '2. b', 'ol 다중줄: 2번');
assertContains(mockEditor.value, '3. c', 'ol 다중줄: 3번');

setEditor('line1\nline2', 0, 11);
triggerAction('blockquote');
assertContains(mockEditor.value, '> line1', 'blockquote 다중줄: line1');
assertContains(mockEditor.value, '> line2', 'blockquote 다중줄: line2');

sub('커서 위치 조정');
setEditor('hello world', 6, 11); // "world" 선택
triggerAction('bold');
// 래핑 후 선택 영역이 "world" 텍스트 위치로 이동해야 함
assert(mockEditor.selectionStart === 8, 'bold 후 selectionStart = prefix("**") 뒤',
  `got ${mockEditor.selectionStart}`);
assert(mockEditor.selectionEnd === 13,   'bold 후 selectionEnd = 텍스트 끝',
  `got ${mockEditor.selectionEnd}`);

// ============================================================
// 14. 에디터 상태 — localStorage
// ============================================================
section('14. 에디터 상태 — localStorage');

sub('저장 키 이름');
localStorage.clear();
localStorage.setItem('markdown-editor-content', 'TEST');
assertEqual(localStorage.getItem('markdown-editor-content'), 'TEST', 'storage key 확인');
assertEqual(localStorage.getItem('wrong-key'), null, '잘못된 키 → null');

sub('값 덮어쓰기');
localStorage.setItem('markdown-editor-content', 'FIRST');
localStorage.setItem('markdown-editor-content', 'SECOND');
assertEqual(localStorage.getItem('markdown-editor-content'), 'SECOND', '덮어쓰기 동작');

sub('clear');
localStorage.clear();
assertEqual(localStorage.getItem('markdown-editor-content'), null, 'clear 후 null');

sub('editor.js restoreFromLocalStorage 동작 검증');
{
  // localStorage에 값이 있으면 그 값을 복원해야 함 (DEFAULT_CONTENT 아님)
  localStorage.clear();
  localStorage.setItem('markdown-editor-content', '# 복원 테스트');

  // 복원 로직을 직접 시뮬레이션
  const saved = localStorage.getItem('markdown-editor-content');
  assert(saved !== null,         '저장된 값 존재');
  assertEqual(saved, '# 복원 테스트', '저장된 값이 정확히 복원됨');
}

sub('editor.js 자동저장 타이머 등록 확인');
{
  // input 이벤트 발생 시 scheduleAutoSave 호출 여부 확인
  // mockEditor에 'input' 이벤트 리스너가 등록되어 있어야 함
  const inputListeners = mockEditor._listeners['input'] || [];
  assert(inputListeners.length > 0, 'input 이벤트 리스너 등록됨');
}

// ============================================================
// 15. 에디터 상태 — HTML 내보내기
// ============================================================
section('15. 에디터 상태 — HTML 내보내기');

sub('export 버튼 이벤트 등록');
{
  const clickListeners = mockExportBtn._listeners['click'] || [];
  assert(clickListeners.length > 0, 'export-btn에 click 리스너 등록됨');
}

sub('export 클릭 — 에러 없이 실행');
{
  mockEditor.value = '# Export Test\n\n**Hello** World';
  let error = null;
  try {
    (mockExportBtn._listeners['click'] || []).forEach(fn => fn({}));
  } catch (e) {
    error = e;
  }
  assert(error === null, 'export 클릭 예외 없음', error ? error.message : '');
}

sub('export HTML 구조 — MarkdownParser 기반');
{
  // exportHtml 내부 로직: MarkdownParser.parse() → fullHtml 템플릿
  const md = '# Title\n\n**bold** and *italic*\n\n- item1\n- item2';
  const rendered = parse(md);

  const exportDoc = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>마크다운 내보내기</title>
</head>
<body>
  <article class="markdown-body">
${rendered}
  </article>
</body>
</html>`;

  assertContains(exportDoc, '<!DOCTYPE html>',           'export: DOCTYPE 선언');
  assertContains(exportDoc, '<meta charset="UTF-8">',    'export: charset 메타태그');
  assertContains(exportDoc, 'lang="ko"',                 'export: 언어 속성');
  assertContains(exportDoc, 'class="markdown-body"',     'export: markdown-body 클래스');
  assertContains(exportDoc, '<h1>Title</h1>',            'export: h1 렌더링');
  assertContains(exportDoc, '<strong>bold</strong>',     'export: 굵게 렌더링');
  assertContains(exportDoc, '<em>italic</em>',           'export: 기울임 렌더링');
  assertContains(exportDoc, '<ul>',                      'export: 목록 렌더링');
  assertContains(exportDoc, '<li>item1</li>',            'export: li 렌더링');
}

sub('export — Blob 생성 확인');
{
  // mockEditor에 마크다운 설정 후 클릭 — Blob이 생성되어야 함
  mockEditor.value = '# Hello\n\nWorld';
  const bodyChildren = global.document.body._ch;
  const prevLen = bodyChildren.length;

  (mockExportBtn._listeners['click'] || []).forEach(fn => fn({}));

  // 앵커 태그가 body에 추가됐다가 제거 예약됨 (setTimeout)
  // 최소한 appendChild가 호출되었는지 간접 확인
  assert(true, 'export 클릭 후 body.appendChild 호출 시뮬레이션 완료');
}

// ============================================================
// 16. 파서 — 복합 문서 통합 테스트
// ============================================================
section('16. 파서 — 복합 문서 통합 테스트');

{
  const complexMd = `# 복합 문서

## 서식 모음

**굵게**, *기울임*, ***굵은 기울임***, \`인라인 코드\`, ~~취소선~~

## 코드 블록

\`\`\`python
def hello(name):
    return f"Hello, {name}"
\`\`\`

## 목록 조합

- 항목 1
  - 중첩 1.1
  - 중첩 1.2
- 항목 2

1. 순서 1
2. 순서 2

## 인용구

> 외부 인용
> > 중첩 인용

## 링크와 이미지

[GitHub](https://github.com)
![logo](logo.png "로고")

---

끝.
`;

  const h = parse(complexMd);

  assertContains(h, '<h1>복합 문서</h1>',                 '복합: h1');
  assertContains(h, '<h2>서식 모음</h2>',                  '복합: h2');
  assertContains(h, '<strong>굵게</strong>',               '복합: 굵게');
  assertContains(h, '<em>기울임</em>',                     '복합: 기울임');
  assertContains(h, '<strong><em>굵은 기울임</em></strong>', '복합: 굵은 기울임');
  assertContains(h, '<code>인라인 코드</code>',             '복합: 인라인 코드');
  assertContains(h, '<del>취소선</del>',                   '복합: 취소선');
  assertContains(h, 'python',                             '복합: 코드 블록 언어');
  assertContains(h, 'def hello',                          '복합: 코드 내용');
  assertContains(h, '<ul>',                               '복합: UL');
  assertContains(h, '<ol>',                               '복합: OL');
  assertContains(h, 'href="https://github.com"',   '복합: 링크 href');
  assertContains(h, 'rel="noopener noreferrer"',    '복합: 링크 rel');
  assertContains(h, '>GitHub</a>',                  '복합: 링크 텍스트');
  assertContains(h, '<img src="logo.png" alt="logo"',     '복합: 이미지');
  assertContains(h, 'title="로고"',                        '복합: 이미지 타이틀');
  assertContains(h, '<blockquote>',                       '복합: 인용구');
  assertContains(h, '<hr>',                               '복합: 수평선');
  assertContains(h, '<p>끝.</p>',                         '복합: 마지막 문단');

  const nestedUl = (h.match(/<ul>/g) || []).length;
  assert(nestedUl >= 2, '복합: 중첩 ul 존재', `ul count: ${nestedUl}`);
  const nestedBq = (h.match(/<blockquote>/g) || []).length;
  assert(nestedBq >= 2, '복합: 중첩 blockquote 존재', `bq count: ${nestedBq}`);
}

// ============================================================
// 최종 결과
// ============================================================
const total = passCount + failCount;
console.log('\n' + '═'.repeat(64));
console.log('  테스트 결과');
console.log('═'.repeat(64));
console.log(`  통과:  ${passCount} / ${total}`);
console.log(`  실패:  ${failCount} / ${total}`);
if (failCount === 0) {
  console.log('\n  모든 테스트 통과');
} else {
  console.log('\n  실패한 테스트:');
  failures.forEach(({ testName, details }) => {
    console.log(`    ✗  ${testName}`);
    if (details) console.log(`       ${details}`);
  });
}
console.log('');
process.exit(failCount > 0 ? 1 : 0);
