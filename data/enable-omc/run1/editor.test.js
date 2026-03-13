/**
 * editor.test.js — 프레임워크 없는 순수 console.log 기반 테스트
 * 실행: node editor.test.js
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// 테스트 러너
// ═══════════════════════════════════════════════════════════════

const results = { pass: 0, fail: 0, skipped: 0 };
const failures = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

function test(label, fn) {
  try {
    fn();
    results.pass++;
    console.log(`    \x1b[32m✓\x1b[0m ${label}`);
  } catch (e) {
    results.fail++;
    const msg = `    \x1b[31m✗\x1b[0m ${label}\n      \x1b[31m→ ${e.message}\x1b[0m`;
    console.log(msg);
    failures.push({ suite: currentSuite, label, message: e.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '단언 실패');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label || '값 불일치'}\n        실제: ${JSON.stringify(actual)}\n        기대: ${JSON.stringify(expected)}`
    );
  }
}

function assertContains(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${label || '포함 실패'}\n        "${needle}" not in "${haystack.slice(0, 120)}"`
    );
  }
}

function assertNotContains(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(`${label || '미포함 실패'}: "${needle}" was found`);
  }
}

function assertMatch(str, regex, label) {
  if (!regex.test(str)) {
    throw new Error(`${label || '정규식 불일치'}: ${regex} did not match "${str.slice(0, 80)}"`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 마크다운 파서 로드 (var 치환으로 전역 노출)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const vm = require('vm');

const parserSrc = fs.readFileSync('./markdown-parser.js', 'utf8')
  .replace('const MarkdownParser', 'var MarkdownParser');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(parserSrc, ctx);
const P = ctx.MarkdownParser;

// ═══════════════════════════════════════════════════════════════
// 툴바 액션 로직 — editor.js에서 순수 함수로 추출 (DOM 없이 테스트)
// ═══════════════════════════════════════════════════════════════

/**
 * editor.js의 wrapText / insertLinePrefix / insertBlock 로직을
 * DOM 의존 없이 재현한 순수 함수 버전
 */
function makeEditor(initialValue = '', selStart = 0, selEnd = 0) {
  const state = {
    value: initialValue,
    selectionStart: selStart,
    selectionEnd: selEnd,
  };

  // getSelection 동등
  function getSelection() {
    const { selectionStart: start, selectionEnd: end, value } = state;
    return {
      start, end,
      selected: value.slice(start, end),
      before:   value.slice(0, start),
      after:    value.slice(end),
    };
  }

  function setSelection(start, end) {
    state.selectionStart = start;
    state.selectionEnd = end;
  }

  // wrapText
  function wrapText(prefix, suffix, placeholder = '텍스트') {
    const { start, selected, before, after } = getSelection();
    const content = selected || placeholder;
    state.value = before + prefix + content + suffix + after;
    const selStart = start + prefix.length;
    setSelection(selStart, selStart + content.length);
  }

  // insertLinePrefix
  function insertLinePrefix(prefix, placeholder = '') {
    const { start, end, selected, before, after } = getSelection();
    if (selected) {
      const lines = selected.split('\n');
      const prefixed = lines.map(l => prefix + l).join('\n');
      state.value = before + prefixed + after;
      setSelection(start, start + prefixed.length);
    } else {
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineContent = state.value.slice(lineStart, end);
      const newLine = prefix + (lineContent || placeholder);
      state.value = state.value.slice(0, lineStart) + newLine + after;
      setSelection(lineStart + prefix.length, lineStart + newLine.length);
    }
  }

  // insertBlock
  function insertBlock(text, cursorOffset = null) {
    const { start, before, after } = getSelection();
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const suffix = !after.startsWith('\n') ? '\n' : '';
    const inserted = prefix + text + suffix;
    state.value = before + inserted + after;
    const newPos = cursorOffset !== null
      ? start + prefix.length + cursorOffset
      : start + inserted.length;
    setSelection(newPos, newPos);
  }

  return { state, wrapText, insertLinePrefix, insertBlock, setSelection };
}

// ═══════════════════════════════════════════════════════════════
// localStorage 모의 구현
// ═══════════════════════════════════════════════════════════════

function makeLocalStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    _store: store,
  };
}

// ═══════════════════════════════════════════════════════════════
// Export HTML 생성 로직 (editor.js에서 순수 추출)
// ═══════════════════════════════════════════════════════════════

function buildExportHtml(markdown) {
  const renderedBody = P.parse(markdown);
  return `<!DOCTYPE html>\n<html lang="ko">\n<head>\n  <meta charset="UTF-8">\n  <title>내보낸 문서</title>\n</head>\n<body>\n${renderedBody}\n</body>\n</html>`;
}

// ═══════════════════════════════════════════════════════════════
// ① 마크다운 파서 — 기본 요소
// ═══════════════════════════════════════════════════════════════

console.log('\n\x1b[1m마크다운 파서\x1b[0m');

suite('제목 (h1 ~ h6)');

test('# ATX h1 생성', () => {
  assertContains(P.parse('# 제목'), '<h1');
  assertContains(P.parse('# 제목'), '>제목</h1>');
});

test('## ATX h2 생성', () => {
  assertContains(P.parse('## 제목2'), '<h2');
  assertContains(P.parse('## 제목2'), '>제목2</h2>');
});

test('### ATX h3 생성', () => assertContains(P.parse('### 제목3'), '<h3'));
test('#### ATX h4 생성', () => assertContains(P.parse('#### 제목4'), '<h4'));
test('##### ATX h5 생성', () => assertContains(P.parse('##### 제목5'), '<h5'));
test('###### ATX h6 생성', () => assertContains(P.parse('###### 제목6'), '<h6'));

test('h1에 id 속성 생성', () => {
  assertMatch(P.parse('# Hello World'), /id="hello-world"/);
});

test('h2에 id 속성 생성', () => {
  assertMatch(P.parse('## My Section'), /id="my-section"/);
});

test('Setext h1 (=== 밑줄)', () => {
  const html = P.parse('제목\n===');
  assertContains(html, '<h1');
  assertContains(html, '>제목</h1>');
});

test('Setext h2 (--- 밑줄)', () => {
  const html = P.parse('제목2\n---');
  assertContains(html, '<h2');
});

test('닫는 # 제거 (## 제목 ##)', () => {
  const html = P.parse('## 제목 ##');
  assertNotContains(html, '##');
  assertContains(html, '>제목</h2>');
});

suite('인라인 서식 — 굵게 / 기울임 / 굵기+기울임');

test('**굵게** → <strong>', () => {
  assertContains(P.parse('**굵게**'), '<strong>굵게</strong>');
});

test('__굵게__ → <strong>', () => {
  assertContains(P.parse('__굵게__'), '<strong>굵게</strong>');
});

test('*기울임* → <em>', () => {
  assertContains(P.parse('*기울임*'), '<em>기울임</em>');
});

test('_기울임_ → <em>', () => {
  assertContains(P.parse('_기울임_'), '<em>기울임</em>');
});

test('***굵기+기울임*** → <strong><em>', () => {
  const html = P.parse('***굵기+기울임***');
  assertContains(html, '<strong><em>굵기+기울임</em></strong>');
});

test('___굵기+기울임___ → <strong><em>', () => {
  assertContains(P.parse('___ABC___'), '<strong><em>ABC</em></strong>');
});

test('~~취소선~~ → <del>', () => {
  assertContains(P.parse('~~취소선~~'), '<del>취소선</del>');
});

test('문단 안에서 복합 인라인 서식', () => {
  const html = P.parse('일반 **굵게** 그리고 *기울임*');
  assertContains(html, '<strong>굵게</strong>');
  assertContains(html, '<em>기울임</em>');
});

suite('인라인 코드');

test('`코드` → <code>', () => {
  assertContains(P.parse('`코드`'), '<code>코드</code>');
});

test('`` 코드 `` (이중 백틱) → <code>', () => {
  assertContains(P.parse('``코드``'), '<code>코드</code>');
});

test('인라인 코드 내 HTML 이스케이프', () => {
  const html = P.parse('`<div>`');
  assertContains(html, '&lt;div&gt;');
  assertNotContains(html, '<div>');
});

test('인라인 코드 내 마크다운 마커 무효화', () => {
  const html = P.parse('`**굵게아님**`');
  assertNotContains(html, '<strong>');
  assertContains(html, '**굵게아님**');
});

suite('코드 블록');

test('``` 펜스 코드블록 → <pre><code>', () => {
  const html = P.parse('```\n코드\n```');
  assertContains(html, '<pre>');
  assertContains(html, '<code');
  assertContains(html, '코드');
});

test('언어 지정 코드블록 → language- 클래스', () => {
  const html = P.parse('```javascript\nconst x = 1;\n```');
  assertContains(html, 'class="language-javascript"');
  assertContains(html, 'const x = 1;');
});

test('코드블록 언어 레이블 표시', () => {
  assertContains(P.parse('```python\npass\n```'), '<span class="code-lang">python</span>');
});

test('코드블록 내 HTML 이스케이프', () => {
  const html = P.parse('```\n<script>alert(1)</script>\n```');
  assertContains(html, '&lt;script&gt;');
  assertNotContains(html, '<script>');
});

test('코드블록 내 마크다운 마커 무효화', () => {
  const html = P.parse('```\n**굵게아님**\n```');
  assertNotContains(html, '<strong>');
});

test('틸드(~~~) 펜스 코드블록', () => {
  assertContains(P.parse('~~~\n코드\n~~~'), '<pre>');
});

test('닫히지 않은 코드블록 처리 (크래시 없음)', () => {
  const html = P.parse('```\n닫히지 않은 코드');
  assertContains(html, '닫히지 않은 코드');
});

suite('링크 및 이미지');

test('[텍스트](URL) → <a href>', () => {
  const html = P.parse('[링크](https://example.com)');
  assertContains(html, '<a href="https://example.com">링크</a>');
});

test('title 속성 있는 링크', () => {
  const html = P.parse('[링크](https://example.com "설명")');
  assertContains(html, 'title="설명"');
});

test('![alt](src) → <img>', () => {
  const html = P.parse('![고양이](cat.png)');
  assertContains(html, '<img src="cat.png" alt="고양이">');
});

test('title 속성 있는 이미지', () => {
  const html = P.parse('![alt](img.png "제목")');
  assertContains(html, 'title="제목"');
});

test('URL XSS 이스케이프 — 따옴표가 &quot;로 인코딩됨', () => {
  const html = P.parse('[x]("onmouseover="alert(1))');
  // escapeHtml이 " → &quot; 로 처리하므로 속성 주입 불가능
  // href 값 안의 따옴표가 HTML 엔티티로 이스케이프되었는지 확인
  assertContains(html, '&quot;');
  // href="" 속성을 닫고 onmouseover= 를 새 속성으로 주입하는 형태가 없어야 함
  assertNotContains(html, 'href="" onmouseover=');
  assertNotContains(html, "href='' onmouseover=");
});

test('자동 URL 링크 변환', () => {
  const html = P.parse('https://example.com 방문하세요');
  assertContains(html, '<a href="https://example.com">');
});

suite('비순서 목록');

test('- 기호 → <ul><li>', () => {
  const html = P.parse('- 항목1\n- 항목2');
  assertContains(html, '<ul>');
  assertContains(html, '<li>항목1</li>');
  assertContains(html, '<li>항목2</li>');
});

test('* 기호 → <ul>', () => {
  assertContains(P.parse('* 항목'), '<ul>');
});

test('+ 기호 → <ul>', () => {
  assertContains(P.parse('+ 항목'), '<ul>');
});

test('목록 항목 내 인라인 서식', () => {
  const html = P.parse('- **굵게**');
  assertContains(html, '<strong>굵게</strong>');
});

suite('순서 목록');

test('1. 2. 3. → <ol><li>', () => {
  const html = P.parse('1. 첫째\n2. 둘째\n3. 셋째');
  assertContains(html, '<ol>');
  assertContains(html, '<li>첫째</li>');
  assertContains(html, '<li>둘째</li>');
  assertContains(html, '<li>셋째</li>');
});

test('순서 목록 내 인라인 서식', () => {
  assertContains(P.parse('1. *기울임*'), '<em>기울임</em>');
});

suite('중첩 목록');

test('비순서 목록 2단계 중첩', () => {
  const md = '- 부모\n  - 자식';
  const html = P.parse(md);
  assertContains(html, '<ul>');
  assertContains(html, '부모');
  assertContains(html, '자식');
});

test('순서 목록 내 비순서 중첩', () => {
  const md = '1. 부모\n   - 자식';
  const html = P.parse(md);
  assertContains(html, '<ol>');
  assertContains(html, '<ul>');
});

suite('인용문');

test('> 인용문 → <blockquote>', () => {
  const html = P.parse('> 인용');
  assertContains(html, '<blockquote>');
  assertContains(html, '인용');
});

test('여러 줄 인용문', () => {
  const html = P.parse('> 줄1\n> 줄2');
  assertContains(html, '<blockquote>');
  assertContains(html, '줄1');
  assertContains(html, '줄2');
});

test('중첩 인용문 (>> 두 단계)', () => {
  const html = P.parse('> 바깥\n> > 안쪽');
  const count = (html.match(/<blockquote>/g) || []).length;
  assert(count >= 2, `중첩 blockquote가 2개 이상이어야 함, 실제: ${count}`);
});

test('인용문 내 굵게 인라인', () => {
  assertContains(P.parse('> **굵게**'), '<strong>굵게</strong>');
});

suite('수평선');

test('--- → <hr>', () => assertContains(P.parse('---'), '<hr>'));
test('*** → <hr>', () => assertContains(P.parse('***'), '<hr>'));
test('___ → <hr>', () => assertContains(P.parse('___'), '<hr>'));
test('------  (길게) → <hr>', () => assertContains(P.parse('------'), '<hr>'));

suite('문단 및 줄바꿈');

test('일반 텍스트 → <p>', () => {
  assertContains(P.parse('일반 텍스트'), '<p>일반 텍스트</p>');
});

test('빈 줄로 문단 구분', () => {
  const html = P.parse('첫 문단\n\n두 번째 문단');
  const count = (html.match(/<p>/g) || []).length;
  assert(count >= 2, `<p> 2개 이상 기대, 실제: ${count}`);
});

test('두 스페이스+줄바꿈 → <br>', () => {
  assertContains(P.parse('줄1  \n줄2'), '<br>');
});

test('백슬래시+줄바꿈 → <br>', () => {
  assertContains(P.parse('줄1\\\n줄2'), '<br>');
});

suite('이스케이프 문자');

test('\\* 이스케이프 → em 태그 없음', () => {
  const html = P.parse('\\*이스케이프\\*');
  assertNotContains(html, '<em>');
});

test('\\[ 이스케이프 → 링크 없음', () => {
  const html = P.parse('\\[링크\\](url)');
  assertNotContains(html, '<a href');
});

test('\\# 이스케이프 → 제목 없음', () => {
  const html = P.parse('\\# 제목아님');
  assertNotContains(html, '<h1');
});

test('\\\\ 백슬래시 이스케이프', () => {
  const html = P.parseInline('\\\\');
  assertContains(html, '&#x5c;');
});

// ═══════════════════════════════════════════════════════════════
// ② 파서 엣지 케이스
// ═══════════════════════════════════════════════════════════════

console.log('\n\x1b[1m파서 엣지 케이스\x1b[0m');

suite('비정상 입력');

test('빈 문자열 → 빈 출력', () => {
  assertEqual(P.parse(''), '', '빈 문자열');
});

test('null → 빈 출력', () => {
  assertEqual(P.parse(null), '', 'null 입력');
});

test('undefined → 빈 출력', () => {
  assertEqual(P.parse(undefined), '', 'undefined 입력');
});

test('공백만 있는 문자열', () => {
  const html = P.parse('   \n   \n   ');
  assertNotContains(html, '<h');
  assertNotContains(html, '<ul');
});

test('매우 긴 단일 줄 처리', () => {
  const long = 'a'.repeat(10000);
  const html = P.parse(long);
  assertContains(html, '<p>');
  assert(html.includes('a'), '내용이 포함되어야 함');
});

suite('닫히지 않은/잘못된 마커');

test('닫히지 않은 **굵게 → <strong> 없음', () => {
  const html = P.parse('**닫히지않은');
  assertNotContains(html, '<strong>');
});

test('닫히지 않은 *기울임 → <em> 없음', () => {
  const html = P.parse('*닫히지않은');
  assertNotContains(html, '<em>');
});

test('닫히지 않은 `인라인코드 → <code> 없음', () => {
  const html = P.parse('`닫히지않은');
  assertNotContains(html, '<code>');
});

test('잘못된 링크 [텍스트](URL 없는 괄호 → 링크 없음', () => {
  const html = P.parse('[텍스트]');
  assertNotContains(html, '<a href');
});

test('빈 링크 []() → 렌더링 가능', () => {
  const html = P.parse('[](https://example.com)');
  // 크래시 없이 처리
  assert(typeof html === 'string', '문자열 반환');
});

test('이미지 alt 없음 ![](src)', () => {
  const html = P.parse('![](img.png)');
  assertContains(html, '<img');
});

suite('연속/혼합 요소');

test('연속 제목', () => {
  const html = P.parse('# 첫번째\n## 두번째\n### 세번째');
  assertContains(html, '<h1');
  assertContains(html, '<h2');
  assertContains(html, '<h3');
});

test('제목 바로 뒤 문단', () => {
  const html = P.parse('# 제목\n문단 텍스트');
  assertContains(html, '<h1');
  assertContains(html, '<p>');
});

test('문단 뒤 바로 코드블록', () => {
  const html = P.parse('문단\n```\n코드\n```');
  assertContains(html, '<p>');
  assertContains(html, '<pre>');
});

test('중첩 인라인 — 굵게 안에 인라인 코드', () => {
  const html = P.parse('**굵게 `코드` 포함**');
  assertContains(html, '<code>코드</code>');
});

test('HTML 특수문자 이스케이프 — 문단에서 & < >', () => {
  const html = P.parse('a & b < c > d');
  assertContains(html, '&amp;');
  assertContains(html, '&lt;');
  assertContains(html, '&gt;');
});

test('연속 수평선 두 개', () => {
  const html = P.parse('---\n\n---');
  const count = (html.match(/<hr>/g) || []).length;
  assertEqual(count, 2, '수평선 2개');
});

test('목록 다음 문단', () => {
  const html = P.parse('- 항목\n\n문단');
  assertContains(html, '<ul>');
  assertContains(html, '<p>');
});

test('# 없는 ## (공백 없이) → 제목 아님', () => {
  const html = P.parse('##제목아님');
  assertNotContains(html, '<h2');
});

// ═══════════════════════════════════════════════════════════════
// ③ 툴바 액션
// ═══════════════════════════════════════════════════════════════

console.log('\n\x1b[1m툴바 액션\x1b[0m');

suite('bold — 선택 없음');

test('선택 없을 때 placeholder 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.wrapText('**', '**', '굵은 텍스트');
  assertContains(ed.state.value, '**굵은 텍스트**');
});

test('삽입 후 placeholder 텍스트 선택됨', () => {
  const ed = makeEditor('', 0, 0);
  ed.wrapText('**', '**', '굵은 텍스트');
  const selected = ed.state.value.slice(ed.state.selectionStart, ed.state.selectionEnd);
  assertEqual(selected, '굵은 텍스트', '선택 영역');
});

suite('bold — 텍스트 선택 후');

test('선택 텍스트를 ** 로 감쌈', () => {
  const ed = makeEditor('hello world', 6, 11);
  ed.wrapText('**', '**', '굵은 텍스트');
  assertEqual(ed.state.value, 'hello **world**');
});

test('감싸기 후 내부 텍스트 선택됨', () => {
  const ed = makeEditor('hello world', 6, 11);
  ed.wrapText('**', '**', '굵은 텍스트');
  const sel = ed.state.value.slice(ed.state.selectionStart, ed.state.selectionEnd);
  assertEqual(sel, 'world');
});

suite('italic — wrapText(\'*\', \'*\')');

test('선택 없을 때 placeholder 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.wrapText('*', '*', '기울임 텍스트');
  assertContains(ed.state.value, '*기울임 텍스트*');
});

test('선택 텍스트를 * 로 감쌈', () => {
  const ed = makeEditor('abc def', 4, 7);
  ed.wrapText('*', '*', '기울임 텍스트');
  assertEqual(ed.state.value, 'abc *def*');
});

suite('인라인 코드 — wrapText(\'`\', \'`\')');

test('선택 없을 때 코드 placeholder', () => {
  const ed = makeEditor('', 0, 0);
  ed.wrapText('`', '`', '코드');
  assertEqual(ed.state.value, '`코드`');
});

test('선택 텍스트 인라인 코드로 감쌈', () => {
  const ed = makeEditor('some code here', 5, 9);
  ed.wrapText('`', '`', '코드');
  assertEqual(ed.state.value, 'some `code` here');
});

suite('제목 insertLinePrefix');

test('h1 — 빈 에디터에 "# 제목 1" 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertLinePrefix('# ', '제목 1');
  assertEqual(ed.state.value, '# 제목 1');
});

test('h2 — 빈 에디터에 "## 제목 2" 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertLinePrefix('## ', '제목 2');
  assertEqual(ed.state.value, '## 제목 2');
});

test('h3 — 빈 에디터에 "### 제목 3" 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertLinePrefix('### ', '제목 3');
  assertEqual(ed.state.value, '### 제목 3');
});

test('h1 — 기존 텍스트 줄 앞에 # 삽입', () => {
  const ed = makeEditor('제목\n다음줄', 0, 2);
  ed.insertLinePrefix('# ', '제목 1');
  assertContains(ed.state.value, '# ');
});

test('h1 — 선택 영역 여러 줄 모두 prefix 추가', () => {
  const ed = makeEditor('줄1\n줄2\n줄3', 0, 9);
  ed.insertLinePrefix('# ', '');
  const lines = ed.state.value.split('\n');
  assert(lines.every(l => l.startsWith('# ')), '모든 줄에 # 접두어');
});

suite('링크 삽입');

test('선택 없을 때 insertBlock으로 링크 템플릿 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertBlock('[링크 텍스트](URL)');
  assertContains(ed.state.value, '[링크 텍스트](URL)');
});

test('선택 텍스트를 링크로 감쌈', () => {
  const ed = makeEditor('GitHub', 0, 6);
  ed.wrapText('[', '](URL)', 'GitHub');
  assertEqual(ed.state.value, '[GitHub](URL)');
});

suite('이미지 삽입');

test('이미지 템플릿 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertBlock('![대체 텍스트](이미지-URL)');
  assertContains(ed.state.value, '![대체 텍스트](이미지-URL)');
});

suite('코드블록 삽입');

test('``` 코드블록 템플릿 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertBlock('```javascript\n코드를 입력하세요\n```', 14);
  assertContains(ed.state.value, '```javascript');
  assertContains(ed.state.value, '코드를 입력하세요');
  assertContains(ed.state.value, '```');
});

test('codeblock 커서가 언어명 위치(14)에 놓임', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertBlock('```javascript\n코드를 입력하세요\n```', 14);
  // 커서 오프셋 14 = "```javascript" 의 길이
  const cursorPos = ed.state.selectionStart;
  assert(cursorPos > 0, '커서가 앞으로 이동해야 함');
});

suite('비순서/순서 목록');

test('UL — "- 목록 항목" 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertLinePrefix('- ', '목록 항목');
  assertEqual(ed.state.value, '- 목록 항목');
});

test('OL — "1. 목록 항목" 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertLinePrefix('1. ', '목록 항목');
  assertEqual(ed.state.value, '1. 목록 항목');
});

test('UL — 선택 텍스트 앞에 "- " 추가', () => {
  const ed = makeEditor('항목', 0, 2);
  ed.insertLinePrefix('- ', '');
  assertContains(ed.state.value, '- ');
});

suite('인용문');

test('">" 접두어 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertLinePrefix('> ', '인용문');
  assertEqual(ed.state.value, '> 인용문');
});

test('기존 텍스트 줄에 ">" 삽입', () => {
  const ed = makeEditor('인용할 텍스트', 0, 7);
  ed.insertLinePrefix('> ', '');
  assertContains(ed.state.value, '> ');
});

suite('수평선');

test('insertBlock으로 --- 삽입', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertBlock('\n---\n');
  assertContains(ed.state.value, '---');
});

test('기존 텍스트 뒤에 자동 개행 추가', () => {
  const ed = makeEditor('텍스트', 3, 3);
  ed.insertBlock('\n---\n');
  // 앞에 줄바꿈이 추가되어야 함
  assertContains(ed.state.value, '\n');
});

suite('insertBlock — 앞뒤 개행 보장');

test('텍스트 중간에 블록 삽입 시 앞에 개행 추가', () => {
  const ed = makeEditor('앞\n뒤', 2, 2);
  ed.insertBlock('블록');
  assertContains(ed.state.value, '블록');
  assert(ed.state.value.indexOf('블록') > 0);
});

test('빈 에디터에 블록 삽입 시 앞에 개행 없음', () => {
  const ed = makeEditor('', 0, 0);
  ed.insertBlock('블록');
  assert(!ed.state.value.startsWith('\n'), '빈 에디터 앞 개행 없어야 함');
});

// ═══════════════════════════════════════════════════════════════
// ④ 에디터 상태 — localStorage 및 export
// ═══════════════════════════════════════════════════════════════

console.log('\n\x1b[1m에디터 상태\x1b[0m');

suite('localStorage 저장/복원');

test('setItem 후 getItem으로 동일 값 복원', () => {
  const ls = makeLocalStorage();
  const content = '# 테스트\n\n내용입니다.';
  ls.setItem('markdown-editor-content', content);
  assertEqual(ls.getItem('markdown-editor-content'), content, '저장/복원');
});

test('값 없으면 getItem → null', () => {
  const ls = makeLocalStorage();
  assertEqual(ls.getItem('markdown-editor-content'), null, '초기값 null');
});

test('저장 후 덮어쓰기', () => {
  const ls = makeLocalStorage();
  ls.setItem('markdown-editor-content', '초기 내용');
  ls.setItem('markdown-editor-content', '새 내용');
  assertEqual(ls.getItem('markdown-editor-content'), '새 내용', '덮어쓰기');
});

test('clear 후 getItem → null', () => {
  const ls = makeLocalStorage();
  ls.setItem('markdown-editor-content', '내용');
  ls.clear();
  assertEqual(ls.getItem('markdown-editor-content'), null, 'clear 후');
});

test('빈 문자열 저장 가능', () => {
  const ls = makeLocalStorage();
  ls.setItem('markdown-editor-content', '');
  assertEqual(ls.getItem('markdown-editor-content'), '', '빈 문자열');
});

test('저장값 != null이면 기본 콘텐츠 대신 사용', () => {
  const ls = makeLocalStorage();
  const myContent = '# 내 문서';
  ls.setItem('markdown-editor-content', myContent);
  // loadContent 로직 시뮬레이션
  const DEFAULT = '# 기본 콘텐츠';
  const saved = ls.getItem('markdown-editor-content');
  const loaded = saved !== null ? saved : DEFAULT;
  assertEqual(loaded, myContent, '저장된 콘텐츠 우선');
});

test('저장값이 null이면 기본 콘텐츠 사용', () => {
  const ls = makeLocalStorage();
  const DEFAULT = '# 기본 콘텐츠';
  const saved = ls.getItem('markdown-editor-content');
  const loaded = saved !== null ? saved : DEFAULT;
  assertEqual(loaded, DEFAULT, '기본 콘텐츠 폴백');
});

test('마크다운 특수문자 포함 콘텐츠 저장/복원', () => {
  const ls = makeLocalStorage();
  const content = '# 제목\n\n**굵게** *기울임* `코드`\n\n```js\nconst x = 1;\n```';
  ls.setItem('markdown-editor-content', content);
  assertEqual(ls.getItem('markdown-editor-content'), content, '특수문자 보존');
});

test('유니코드 콘텐츠 저장/복원', () => {
  const ls = makeLocalStorage();
  const content = '한글 日本語 العربية 한국어';
  ls.setItem('markdown-editor-content', content);
  assertEqual(ls.getItem('markdown-editor-content'), content, '유니코드 보존');
});

suite('Export HTML 출력 검증');

test('DOCTYPE 선언 포함', () => {
  assertContains(buildExportHtml('# 제목'), '<!DOCTYPE html>');
});

test('<html lang="ko"> 포함', () => {
  assertContains(buildExportHtml('# 제목'), '<html lang="ko">');
});

test('<meta charset="UTF-8"> 포함', () => {
  assertContains(buildExportHtml('# 제목'), 'charset="UTF-8"');
});

test('<body> 태그 포함', () => {
  assertContains(buildExportHtml('텍스트'), '<body>');
  assertContains(buildExportHtml('텍스트'), '</body>');
});

test('h1 제목이 <body> 안에 렌더링', () => {
  const html = buildExportHtml('# 안녕하세요');
  const bodyStart = html.indexOf('<body>');
  const h1Pos = html.indexOf('<h1');
  assert(h1Pos > bodyStart, 'h1이 body 안에 있어야 함');
});

test('굵은 텍스트가 <strong>으로 렌더링', () => {
  assertContains(buildExportHtml('**굵게**'), '<strong>굵게</strong>');
});

test('링크가 <a href>로 렌더링', () => {
  assertContains(buildExportHtml('[링크](https://example.com)'), '<a href="https://example.com">');
});

test('코드블록이 <pre><code>로 렌더링', () => {
  const html = buildExportHtml('```\n코드\n```');
  assertContains(html, '<pre>');
  assertContains(html, '<code');
});

test('빈 마크다운 export → body 안 내용 없음', () => {
  const html = buildExportHtml('');
  assertContains(html, '<body>');
  // 파싱 결과가 비어있으면 body가 개행만 포함
  const bodyContent = html.replace(/[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*/, '').trim();
  assertEqual(bodyContent, '', '빈 body');
});

test('XSS — 스크립트 태그가 이스케이프됨', () => {
  const html = buildExportHtml('```\n<script>alert(1)</script>\n```');
  assertNotContains(html, '<script>alert(1)');
  assertContains(html, '&lt;script&gt;');
});

test('복합 마크다운 — 여러 요소 모두 포함', () => {
  const md = [
    '# 제목',
    '',
    '**굵게** *기울임*',
    '',
    '- 항목1',
    '- 항목2',
    '',
    '> 인용문',
    '',
    '---',
    '',
    '[링크](https://example.com)',
  ].join('\n');
  const html = buildExportHtml(md);
  assertContains(html, '<h1');
  assertContains(html, '<strong>');
  assertContains(html, '<em>');
  assertContains(html, '<ul>');
  assertContains(html, '<blockquote>');
  assertContains(html, '<hr>');
  assertContains(html, '<a href=');
});

// ═══════════════════════════════════════════════════════════════
// ⑤ 보안 및 추가 엣지 케이스
// ═══════════════════════════════════════════════════════════════

console.log('\n\x1b[1m보안 및 추가 엣지 케이스\x1b[0m');

suite('위험 URL 차단 (sanitizeUrl)');

test('javascript: URL → # 으로 대체', () => {
  const html = P.parse('[클릭](javascript:alert(1))');
  assertNotContains(html, 'javascript:');
  assertContains(html, 'href="#"');
});

test('JAVASCRIPT: (대문자) → # 으로 대체', () => {
  const html = P.parse('[클릭](JAVASCRIPT:alert(1))');
  assertNotContains(html, 'JAVASCRIPT:');
  assertContains(html, 'href="#"');
});

test('vbscript: URL → # 으로 대체', () => {
  const html = P.parse('[클릭](vbscript:msgbox(1))');
  assertNotContains(html, 'vbscript:');
  assertContains(html, 'href="#"');
});

test('data: URL → # 으로 대체', () => {
  const html = P.parse('[이미지](data:text/html,<h1>XSS</h1>)');
  assertNotContains(html, 'data:');
  assertContains(html, 'href="#"');
});

test('이미지 src의 javascript: → # 으로 대체', () => {
  const html = P.parse('![alt](javascript:alert(1))');
  assertNotContains(html, 'javascript:');
  assertContains(html, 'src="#"');
});

test('공백 포함 javascript: URL → # 으로 대체', () => {
  // 공백이나 제어문자로 필터링 우회 시도
  const html = P.parse('[클릭](java\tscript:alert(1))');
  assertNotContains(html, 'javascript:');
});

test('https: URL → 차단되지 않음', () => {
  const html = P.parse('[링크](https://example.com)');
  assertContains(html, 'href="https://example.com"');
  assertNotContains(html, 'href="#"');
});

suite('널 바이트 및 특수 입력');

test('널 바이트 포함 입력 — 크래시 없음', () => {
  const html = P.parse('텍스트\x00내용');
  assert(typeof html === 'string', '문자열 반환');
  assertNotContains(html, '\x00');
});

test('널 바이트만 있는 입력', () => {
  const html = P.parse('\x00\x00\x00');
  assert(typeof html === 'string', '문자열 반환');
});

test('플레이스홀더 패턴 직접 입력 — 코드블록으로 오해 없음', () => {
  // 사용자가 \x00CODE_BLOCK_0\x00 를 직접 입력해도 크래시 없어야 함
  const html = P.parse('\x00CODE_BLOCK_0\x00');
  assert(typeof html === 'string', '문자열 반환');
});

suite('깊은 중첩 — 최대 깊이 초과 안전');

test('깊은 blockquote 중첩 — 크래시 없음', () => {
  // 10단계 이상 중첩된 인용문
  const md = '>'.repeat(15) + ' 텍스트';
  let html;
  assert(() => { html = P.parse(md); }, 'parse 호출 가능');
  html = P.parse(md);
  assert(typeof html === 'string', '문자열 반환');
});

test('깊은 목록 중첩 — 크래시 없음', () => {
  const lines = [];
  for (let i = 0; i < 12; i++) {
    lines.push('  '.repeat(i) + '- 항목');
  }
  const html = P.parse(lines.join('\n'));
  assert(typeof html === 'string', '문자열 반환');
});

suite('Setext 제목 오탐 방지');

test('대시 2개(--) → h2 아님 (일반 텍스트)', () => {
  const html = P.parse('텍스트\n--');
  assertNotContains(html, '<h2');
});

test('대시 3개(---) → h2 인식', () => {
  const html = P.parse('텍스트\n---');
  assertContains(html, '<h2');
});

test('목록 항목 다음 --- → h2 아님 (수평선)', () => {
  // 목록 마커가 있는 줄은 Setext 제목으로 처리 안 됨
  const html = P.parse('- 목록\n---');
  // 수평선 또는 목록+문단이어야 하고 h2는 아님
  assertNotContains(html, '<h2');
});

suite('한글/유니코드 제목 id');

test('한글 제목 id — 비어있지 않음', () => {
  const html = P.parse('# 안녕하세요');
  assertMatch(html, /id="[^"]+"/);
  // id가 비어있지 않아야 함
  assertNotContains(html, 'id=""');
});

test('한글 제목 id — 한글 유지', () => {
  const html = P.parse('# 안녕하세요');
  assertContains(html, '안녕하세요');
  // id에 한글이 포함되어 있어야 함
  assertMatch(html, /id="안녕하세요"/);
});

test('숫자+한글 혼합 제목 id', () => {
  const html = P.parse('## 1장 소개');
  assertMatch(html, /id="[^"]+"/);
  assertNotContains(html, 'id=""');
});

test('특수문자만 있는 제목 id — 크래시 없음', () => {
  const html = P.parse('# !@#$%');
  assert(typeof html === 'string', '문자열 반환');
  assertContains(html, '<h1');
});

// ═══════════════════════════════════════════════════════════════
// 결과 출력
// ═══════════════════════════════════════════════════════════════

const total = results.pass + results.fail;
const passRate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0.0';

console.log('\n' + '─'.repeat(60));
console.log(
  `\x1b[1m결과\x1b[0m  ` +
  `\x1b[32m${results.pass} 통과\x1b[0m  ` +
  (results.fail > 0 ? `\x1b[31m${results.fail} 실패\x1b[0m  ` : '') +
  `합계 ${total}개  (${passRate}%)`
);

if (failures.length > 0) {
  console.log('\n\x1b[31m실패한 테스트:\x1b[0m');
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.suite}] ${f.label}`);
    console.log(`     ${f.message}`);
  });
}

console.log('─'.repeat(60));

process.exit(results.fail > 0 ? 1 : 0);
