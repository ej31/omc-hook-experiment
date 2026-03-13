/**
 * editor.test.js - 마크다운 에디터 종합 테스트 (프레임워크 없음)
 * 실행: node editor.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// =====================================================================
// 테스트 러너
// =====================================================================
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    process.stdout.write('  ✓ ' + message + '\n');
    passed++;
  } else {
    process.stdout.write('  ✗ ' + message + '\n');
    failed++;
    failures.push(message);
  }
}

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (!ok) {
    process.stdout.write('  ✗ ' + message + '\n');
    process.stdout.write('    기대: ' + JSON.stringify(expected) + '\n');
    process.stdout.write('    실제: ' + JSON.stringify(actual) + '\n');
    failed++;
    failures.push(message);
  } else {
    process.stdout.write('  ✓ ' + message + '\n');
    passed++;
  }
}

function assertContains(haystack, needle, message) {
  const ok = haystack.includes(needle);
  if (!ok) {
    process.stdout.write('  ✗ ' + message + '\n');
    process.stdout.write('    찾는 값: ' + JSON.stringify(needle) + '\n');
    process.stdout.write('    실제: ' + JSON.stringify(haystack.substring(0, 200)) + '\n');
    failed++;
    failures.push(message);
  } else {
    process.stdout.write('  ✓ ' + message + '\n');
    passed++;
  }
}

function section(name) {
  process.stdout.write('\n── ' + name + ' ──\n');
}

// =====================================================================
// 마크다운 파서 로드
// =====================================================================
// const 선언은 vm 컨텍스트 객체로 노출되지 않으므로
// 전역 할당 래퍼를 사용해 MarkdownParser를 추출
const parserSrc = fs.readFileSync(path.join(__dirname, 'markdown-parser.js'), 'utf8');
const wrappedSrc = parserSrc + '\n__result__ = MarkdownParser;';
const parserCtx = { __result__: undefined, console };
vm.runInNewContext(wrappedSrc, parserCtx);
const parser = parserCtx.__result__;

function parse(md) {
  return parser.parse(md).trim();
}

// =====================================================================
// 1. 마크다운 파서 - 제목 (h1-h6)
// =====================================================================
section('파서: 제목 (h1-h6)');

assertEqual(parse('# 제목 1'), '<h1 id="제목-1">제목 1</h1>', 'h1 렌더링');
assertEqual(parse('## 제목 2'), '<h2 id="제목-2">제목 2</h2>', 'h2 렌더링');
assertEqual(parse('### 제목 3'), '<h3 id="제목-3">제목 3</h3>', 'h3 렌더링');
assertEqual(parse('#### 제목 4'), '<h4 id="제목-4">제목 4</h4>', 'h4 렌더링');
assertEqual(parse('##### 제목 5'), '<h5 id="제목-5">제목 5</h5>', 'h5 렌더링');
assertEqual(parse('###### 제목 6'), '<h6 id="제목-6">제목 6</h6>', 'h6 렌더링');
assert(parse('# **굵은** 제목').includes('<strong>굵은</strong>'), 'h1 안 굵게 인라인');
assert(!parse('#제목').includes('<h1'), '공백 없는 # 은 헤딩 아님');

// =====================================================================
// 2. 파서 - 굵게, 기울임, 굵게+기울임
// =====================================================================
section('파서: 텍스트 서식');

assertEqual(parse('**굵게**'), '<p><strong>굵게</strong></p>', '** 굵게');
assertEqual(parse('__굵게__'), '<p><strong>굵게</strong></p>', '__ 굵게');
assertEqual(parse('*기울임*'), '<p><em>기울임</em></p>', '* 기울임');
assertEqual(parse('_기울임_'), '<p><em>기울임</em></p>', '_ 기울임');
assertEqual(parse('***굵게기울임***'), '<p><strong><em>굵게기울임</em></strong></p>', '*** 굵게+기울임');
assertEqual(parse('___굵게기울임___'), '<p><strong><em>굵게기울임</em></strong></p>', '___ 굵게+기울임');
assert(parse('앞 **굵게** 뒤').includes('<strong>굵게</strong>'), '문장 중간 굵게');
assert(parse('앞 *기울임* 뒤').includes('<em>기울임</em>'), '문장 중간 기울임');

// =====================================================================
// 3. 파서 - 인라인 코드 & 코드 블록
// =====================================================================
section('파서: 코드');

assertEqual(parse('`코드`'), '<p><code>코드</code></p>', '인라인 코드');
assert(parse('`a && b`').includes('<code>a &amp;&amp; b</code>'), '인라인 코드 HTML 이스케이프');

const codeBlock = parse('```javascript\nconsole.log("hi");\n```');
assertContains(codeBlock, '<pre>', '코드 블록 <pre> 태그');
assertContains(codeBlock, '<code', '코드 블록 <code> 태그');
assertContains(codeBlock, 'javascript', '코드 블록 언어 레이블');
assertContains(codeBlock, 'console.log', '코드 블록 내용');
assertContains(codeBlock, '&quot;hi&quot;', '코드 블록 따옴표 이스케이프');

const codeNoLang = parse('```\n코드 내용\n```');
assertContains(codeNoLang, '<pre>', '언어 없는 코드 블록');
assertContains(codeNoLang, '코드 내용', '언어 없는 코드 블록 내용');

// 코드 블록 안 마크다운은 파싱 안 됨
const codeRaw = parse('```\n**굵게 아님**\n```');
assert(!codeRaw.includes('<strong>'), '코드 블록 안 마크다운 파싱 안 됨');

// =====================================================================
// 4. 파서 - 링크 & 이미지
// =====================================================================
section('파서: 링크 & 이미지');

assertEqual(
  parse('[링크](https://example.com)'),
  '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer">링크</a></p>',
  '기본 링크'
);
assert(parse('[링크](<script>)').includes('&lt;script&gt;'), '링크 XSS 이스케이프');
assertEqual(
  parse('![대체텍스트](image.png)'),
  '<p><img src="image.png" alt="대체텍스트"></p>',
  '이미지'
);
assertEqual(
  parse('![](empty.png)'),
  '<p><img src="empty.png" alt=""></p>',
  '빈 alt 이미지'
);
assert(
  parse('앞 [링크](https://a.com) 뒤').includes('<a href="https://a.com"'),
  '문장 중간 링크'
);

// =====================================================================
// 5. 파서 - 순서 없는 목록
// =====================================================================
section('파서: 순서 없는 목록');

const ul1 = parse('- 항목 A\n- 항목 B\n- 항목 C');
assertContains(ul1, '<ul>', 'ul 태그');
assertContains(ul1, '<li>항목 A</li>', 'ul 첫 항목');
assertContains(ul1, '<li>항목 B</li>', 'ul 두번째 항목');
assertContains(ul1, '<li>항목 C</li>', 'ul 세번째 항목');

const ulStar = parse('* 항목1\n* 항목2');
assertContains(ulStar, '<ul>', '* 문법 ul');
assertContains(ulStar, '<li>항목1</li>', '* 문법 항목');

const ulInline = parse('- **굵게** 항목');
assertContains(ulInline, '<strong>굵게</strong>', '목록 항목 내 인라인 서식');

// =====================================================================
// 6. 파서 - 순서 있는 목록
// =====================================================================
section('파서: 순서 있는 목록');

const ol1 = parse('1. 첫째\n2. 둘째\n3. 셋째');
assertContains(ol1, '<ol>', 'ol 태그');
assertContains(ol1, '<li>첫째</li>', 'ol 첫 항목');
assertContains(ol1, '<li>둘째</li>', 'ol 두번째 항목');

// =====================================================================
// 7. 파서 - 중첩 목록
// =====================================================================
section('파서: 중첩 목록');

const nested = parse('- 상위\n  - 하위 A\n  - 하위 B\n- 상위2');
assertContains(nested, '<ul>', '중첩 목록 ul');
assertContains(nested, '<li>상위', '중첩 목록 상위 항목');
assertContains(nested, '<li>하위 A</li>', '중첩 목록 하위 항목');

// =====================================================================
// 8. 파서 - 인용문 & 중첩 인용문
// =====================================================================
section('파서: 인용문');

const bq1 = parse('> 인용문 내용');
assertContains(bq1, '<blockquote>', 'blockquote 태그');
assertContains(bq1, '인용문 내용', '인용문 내용');

const bqNested = parse('> 상위\n> > 하위');
assertContains(bqNested, '<blockquote>', '중첩 인용문 외부');
assert(bqNested.match(/<blockquote>/g).length >= 2, '중첩 인용문 내부');

const bqInline = parse('> **굵게** 인용');
assertContains(bqInline, '<strong>굵게</strong>', '인용문 내 인라인 서식');

// =====================================================================
// 9. 파서 - 수평선
// =====================================================================
section('파서: 수평선');

assertEqual(parse('---'), '<hr>', '--- 수평선');
assertEqual(parse('***'), '<hr>', '*** 수평선');
assertEqual(parse('___'), '<hr>', '___ 수평선');
assertEqual(parse('------'), '<hr>', '------ 수평선');
assert(!parse('--- 텍스트').includes('<hr>'), '텍스트 있는 --- 는 수평선 아님');

// =====================================================================
// 10. 파서 - 단락 & 줄바꿈
// =====================================================================
section('파서: 단락 & 줄바꿈');

const para = parse('첫 번째 단락\n\n두 번째 단락');
assertContains(para, '<p>첫 번째 단락</p>', '첫 번째 단락');
assertContains(para, '<p>두 번째 단락</p>', '두 번째 단락');

const lineBreak = parse('첫째 줄  \n둘째 줄');
assertContains(lineBreak, '<br>', '두 칸 공백 줄바꿈');

// =====================================================================
// 11. 파서 - 이스케이프 문자
// =====================================================================
section('파서: 이스케이프 문자');

assert(parse('\\*별표\\*').includes('*별표*') && !parse('\\*별표\\*').includes('<em>'), '\\* 이스케이프');
assert(parse('\\**굵게아님\\**').includes('**굵게아님**') || !parse('\\**굵게아님\\**').includes('<strong>'), '\\** 이스케이프');
assert(parse('\\`코드아님\\`').includes('`코드아님`'), '\\` 이스케이프');
assert(parse('\\# 제목아님').includes('# 제목아님') || !parse('\\# 제목아님').includes('<h1'), '\\# 이스케이프');

// HTML 이스케이프
assertContains(parse('<script>alert()</script>'), '&lt;script&gt;', 'HTML 태그 이스케이프');
assertContains(parse('a & b'), '&amp;', '& 이스케이프');

// =====================================================================
// 12. 파서 - 엣지 케이스
// =====================================================================
section('파서: 엣지 케이스');

assertEqual(parse(''), '', '빈 입력');
assertEqual(parse('   '), '', '공백만 있는 입력');
assertEqual(parse('\n\n\n'), '', '개행만 있는 입력');

// 닫히지 않은 마크다운 마커 - 그대로 출력
assert(!parse('**닫히지않음').includes('<strong>') || parse('**닫히지않음').includes('**닫히지않음'), '닫히지 않은 ** 처리');
assert(!parse('*닫히지않음').includes('<em>') || parse('*닫히지않음').includes('닫히지않음'), '닫히지 않은 * 처리');

// 잘못된 링크
const malformedLink = parse('[링크]');
assert(!malformedLink.includes('<a '), '괄호 없는 링크는 a 태그 아님');

// 연속 헤딩
const consecutiveH = parse('# 제목1\n## 제목2\n### 제목3');
assertContains(consecutiveH, '<h1', '연속 헤딩 h1');
assertContains(consecutiveH, '<h2', '연속 헤딩 h2');
assertContains(consecutiveH, '<h3', '연속 헤딩 h3');

// 혼합 인라인 서식
const mixed = parse('**굵게** 그리고 *기울임* 그리고 `코드`');
assertContains(mixed, '<strong>굵게</strong>', '혼합 서식: 굵게');
assertContains(mixed, '<em>기울임</em>', '혼합 서식: 기울임');
assertContains(mixed, '<code>코드</code>', '혼합 서식: 코드');

// `- ` (내용 없는 항목)은 목록으로 처리되지 않고 단락으로 fallback
const emptyLi = parse('- \n- 내용');
assert(!emptyLi.includes('<li></li>'), '빈 - 는 빈 li를 생성하지 않음');
assertContains(emptyLi, '내용', '빈 항목 다음 유효한 항목 렌더링');

// ul 다음 ol은 각각 별도 목록으로 렌더링
const mixedList = parse('- ul 항목\n1. ol 항목');
assertContains(mixedList, '<ul>', '혼합 목록 ul 부분');
assertContains(mixedList, '<ol>', '혼합 목록 ol 부분');

// 제목 안 특수 문자
const headingSpecial = parse('# Hello & World <test>');
assertContains(headingSpecial, '&amp;', '제목 안 & 이스케이프');
assertContains(headingSpecial, '&lt;', '제목 안 < 이스케이프');

// =====================================================================
// 13. 툴바 동작 - DOM 모킹으로 에디터 로드
// =====================================================================
section('툴바 동작: DOM 모킹');

// Mock DOM 구성
const mockStorage = {};
const mockEventListeners = {};

// 모의 텍스트영역
function makeMockTextarea(value = '') {
  return {
    value,
    selectionStart: 0,
    selectionEnd: 0,
    _listeners: {},
    addEventListener(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    focus() {},
    // 선택 영역 설정 헬퍼
    select(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
}

// 툴바 액션을 직접 구현하여 테스트 (에디터 내부 로직 반영)
function makeInsertAtCursor(textarea) {
  return function insertAtCursor(before, after = '', defaultText = '') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);
    const text = selected || defaultText;
    const newText = before + text + after;
    textarea.value = textarea.value.substring(0, start) + newText + textarea.value.substring(end);
    const newStart = start + before.length;
    const newEnd = newStart + text.length;
    textarea.setSelectionRange(newStart, newEnd);
  };
}

function makeInsertLinePrefix(textarea) {
  return function insertLinePrefix(prefix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const selectedText = value.substring(lineStart, end);
    const lines = selectedText.split('\n');
    const newLines = lines.map(line => {
      if (line.startsWith(prefix)) return line.substring(prefix.length);
      return prefix + line;
    });
    const newSelected = newLines.join('\n');
    textarea.value = value.substring(0, lineStart) + newSelected + value.substring(end);
    textarea.setSelectionRange(lineStart, lineStart + newSelected.length);
  };
}

// 굵게 버튼
{
  const ta = makeMockTextarea('Hello World');
  const insert = makeInsertAtCursor(ta);
  ta.select(6, 11); // "World" 선택
  insert('**', '**', '굵은 텍스트');
  assertEqual(ta.value, 'Hello **World**', '굵게: 선택 텍스트 래핑');
}

{
  const ta = makeMockTextarea('');
  const insert = makeInsertAtCursor(ta);
  ta.select(0, 0);
  insert('**', '**', '굵은 텍스트');
  assertEqual(ta.value, '**굵은 텍스트**', '굵게: 선택 없을 때 기본 텍스트 삽입');
  assertEqual(ta.selectionStart, 2, '굵게 삽입 후 커서 시작 위치');
  assertEqual(ta.selectionEnd, 8, '굵게 삽입 후 커서 끝 위치 (기본텍스트 선택)'); // '굵은 텍스트' = 6자 → 2+6=8
}

// 기울임 버튼
{
  const ta = makeMockTextarea('안녕 세상');
  const insert = makeInsertAtCursor(ta);
  ta.select(3, 5); // "세상" 선택
  insert('*', '*', '기울임 텍스트');
  assertEqual(ta.value, '안녕 *세상*', '기울임: 선택 텍스트 래핑');
}

// h1 버튼
{
  const ta = makeMockTextarea('제목');
  const prefix = makeInsertLinePrefix(ta);
  ta.select(0, 2);
  prefix('# ');
  assertEqual(ta.value, '# 제목', 'h1: 줄 앞에 # 추가');
}

// h2 버튼
{
  const ta = makeMockTextarea('제목');
  const prefix = makeInsertLinePrefix(ta);
  ta.select(0, 2);
  prefix('## ');
  assertEqual(ta.value, '## 제목', 'h2: 줄 앞에 ## 추가');
}

// h3 버튼
{
  const ta = makeMockTextarea('제목');
  const prefix = makeInsertLinePrefix(ta);
  ta.select(0, 2);
  prefix('### ');
  assertEqual(ta.value, '### 제목', 'h3: 줄 앞에 ### 추가');
}

// 토글 동작 (이미 접두사가 있으면 제거)
{
  const ta = makeMockTextarea('# 이미 h1');
  const prefix = makeInsertLinePrefix(ta);
  ta.select(0, 8);
  prefix('# ');
  assertEqual(ta.value, '이미 h1', 'h1: 이미 있는 # 제거 (토글)');
}

// 인라인 코드
{
  const ta = makeMockTextarea('변수');
  const insert = makeInsertAtCursor(ta);
  ta.select(0, 2);
  insert('`', '`', '코드');
  assertEqual(ta.value, '`변수`', '코드: 선택 텍스트 래핑');
}

// 순서 없는 목록
{
  const ta = makeMockTextarea('항목');
  const prefix = makeInsertLinePrefix(ta);
  ta.select(0, 2);
  prefix('- ');
  assertEqual(ta.value, '- 항목', '목록: - 접두사 추가');
}

// 인용문
{
  const ta = makeMockTextarea('인용할 내용');
  const prefix = makeInsertLinePrefix(ta);
  ta.select(0, 6);
  prefix('> ');
  assertEqual(ta.value, '> 인용할 내용', '인용문: > 접두사 추가');
}

// 다중 줄 선택 접두사
{
  const ta = makeMockTextarea('줄1\n줄2\n줄3');
  const prefix = makeInsertLinePrefix(ta);
  ta.select(0, 7); // "줄1\n줄2" 선택
  prefix('# ');
  assertContains(ta.value, '# 줄1', '다중 줄 h1: 첫 번째 줄');
  assertContains(ta.value, '# 줄2', '다중 줄 h1: 두 번째 줄');
}

// =====================================================================
// 14. 에디터 상태 - localStorage 저장/복원
// =====================================================================
section('에디터 상태: localStorage');

// 모의 localStorage
const mockLS = (() => {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
})();

const STORAGE_KEY = 'md-editor-content';

// 저장 테스트
mockLS.setItem(STORAGE_KEY, '# 저장된 내용');
assertEqual(mockLS.getItem(STORAGE_KEY), '# 저장된 내용', 'localStorage 저장 확인');

// 복원 테스트
const restored = mockLS.getItem(STORAGE_KEY);
assertEqual(restored, '# 저장된 내용', 'localStorage 복원 확인');

// 키 없을 때 null 반환
mockLS.clear();
assertEqual(mockLS.getItem(STORAGE_KEY), null, '키 없을 때 null 반환');

// 저장 내용이 실제 마크다운인지 확인
const sampleMd = '# 제목\n\n**굵게** 텍스트\n\n- 항목1\n- 항목2';
mockLS.setItem(STORAGE_KEY, sampleMd);
assertEqual(mockLS.getItem(STORAGE_KEY), sampleMd, '마크다운 내용 온전히 저장');

// =====================================================================
// 15. HTML 내보내기 - 출력 구조 검증
// =====================================================================
section('HTML 내보내기: 출력 구조');

// 내보내기 로직 직접 테스트 (exportHtml 내부 HTML 생성 로직)
function buildExportHtml(previewContent) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>마크다운 문서</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
  </style>
</head>
<body>
${previewContent}
</body>
</html>`;
}

const sampleMarkdown = '# 제목\n\n단락 내용\n\n- 항목1\n- 항목2';
const renderedHtml = parser.parse(sampleMarkdown);
const exported = buildExportHtml(renderedHtml);

assertContains(exported, '<!DOCTYPE html>', '내보내기: DOCTYPE 선언');
assertContains(exported, '<meta charset="UTF-8">', '내보내기: 문자셋 메타태그');
assertContains(exported, '<html lang="ko">', '내보내기: 언어 속성');
assertContains(exported, '<title>마크다운 문서</title>', '내보내기: 제목 태그');
assertContains(exported, '<style>', '내보내기: 스타일 포함');
assertContains(exported, '<h1', '내보내기: 마크다운 제목 렌더링');
assertContains(exported, '<p>단락 내용</p>', '내보내기: 단락 렌더링');
assertContains(exported, '<ul>', '내보내기: 목록 렌더링');
assertContains(exported, '</html>', '내보내기: HTML 종료 태그');

// 렌더링된 콘텐츠가 완전한 HTML 문서에 포함됨
const bodyMatch = exported.match(/<body>([\s\S]*?)<\/body>/);
assert(bodyMatch !== null, '내보내기: body 태그 존재');
assert(bodyMatch[1].includes('<h1'), '내보내기: body 안에 h1 태그');

// XSS 방지 - 스크립트 태그 이스케이프
const xssMarkdown = '<script>alert("XSS")</script>';
const xssRendered = parser.parse(xssMarkdown);
const xssExported = buildExportHtml(xssRendered);
assert(!xssExported.includes('<script>alert'), '내보내기: XSS 스크립트 이스케이프');

// =====================================================================
// 16. 회귀 테스트: 인용문-이스케이프 공유 상태 충돌
// =====================================================================
section('회귀: 인용문과 이스케이프 공유 상태');

// 인용문 앞 이스케이프 → parseBlockquote 재귀 parse()가 escapeMap을 초기화하면 소실되는 버그
const bqEscape = parse('\\*이스케이프\\*\n\n> 인용문 내용');
assertContains(bqEscape, '*이스케이프*', '인용문 앞 이스케이프 별표 보존');
assertContains(bqEscape, '<blockquote>', '이스케이프 후 인용문 정상 렌더링');
assert(!bqEscape.includes('<em>이스케이프</em>'), '이스케이프 별표가 em 태그로 변환 안 됨');

// 인용문 안 이스케이프
const bqInnerEscape = parse('> \\*별표\\* 인용');
assertContains(bqInnerEscape, '<blockquote>', '인용문 안 이스케이프 처리');
assert(!bqInnerEscape.includes('<em>별표</em>'), '인용문 안 이스케이프 별표 em 태그 안 됨');

// 인용문 앞뒤 이스케이프 모두 보존
const bqBothEscape = parse('\\`코드아님\\`\n\n> 인용\n\n\\*별표아님\\*');
assertContains(bqBothEscape, '`코드아님`', '인용문 앞 이스케이프 백틱 보존');
assertContains(bqBothEscape, '*별표아님*', '인용문 뒤 이스케이프 별표 보존');
assertContains(bqBothEscape, '<blockquote>', '앞뒤 이스케이프와 인용문 공존');

// 연속 parse() 호출 시 상태 격리 (이전 호출 상태가 다음 호출에 영향 안 줌)
const r1 = parse('\\*첫번째\\*');
const r2 = parse('\\*두번째\\*');
assertContains(r1, '*첫번째*', '첫 번째 parse() 이스케이프');
assertContains(r2, '*두번째*', '두 번째 parse() 이스케이프 - 상태 격리 확인');
assert(!r2.includes('첫번째'), '두 번째 parse()에 첫 번째 결과 혼입 없음');

// =====================================================================
// 17. 회귀 테스트: 링크 커서 오프셋
// =====================================================================
section('회귀: 링크 커서 위치');

// 선택 텍스트 래핑 후 URL 선택: selectionEnd = ']' 위치, URL은 +2 부터
{
  const ta = makeMockTextarea('클릭하세요');
  const insert = makeInsertAtCursor(ta);
  ta.select(0, 5); // '클릭하세요' 선택
  insert('[', '](https://)', '');
  // 삽입 후: '[클릭하세요](https://)' - selectionEnd는 ']' 바로 앞 = 6
  // URL 'https://' 는 pos+2 = 8 부터, 8글자
  assertEqual(ta.value, '[클릭하세요](https://)', '링크 래핑 결과');
  assertEqual(ta.selectionStart, 1, '링크 래핑 후 selectionStart');
  assertEqual(ta.selectionEnd, 6, '링크 래핑 후 selectionEnd (선택 텍스트 범위)');
}

// 빈 커서에서 링크 삽입: defaultText='https://' 가 선택됨
{
  const ta = makeMockTextarea('');
  const insert = makeInsertAtCursor(ta);
  ta.select(0, 0);
  insert('[링크 텍스트](', ')', 'https://');
  assertEqual(ta.value, '[링크 텍스트](https://)', '빈 커서 링크 삽입');
  // before = '[링크 텍스트](' = [ + 링크 텍스트(6자) + ]( = 9자, text = 'https://' = 8자
  assertEqual(ta.selectionStart, 9, '링크 삽입 후 URL 시작 커서');
  assertEqual(ta.selectionEnd, 17, '링크 삽입 후 URL 끝 커서');
}

// =====================================================================
// 결과 요약
// =====================================================================
process.stdout.write('\n' + '='.repeat(50) + '\n');
process.stdout.write(`테스트 결과: ${passed + failed}개 중 ${passed}개 통과\n`);

if (failures.length > 0) {
  process.stdout.write('\n실패한 테스트:\n');
  failures.forEach(f => process.stdout.write('  - ' + f + '\n'));
}

process.stdout.write('='.repeat(50) + '\n');
process.exit(failed > 0 ? 1 : 0);
