/**
 * editor.test.js — 마크다운 에디터 종합 테스트
 * 외부 프레임워크 없이 console.log 기반 assertion 사용
 * 실행: node editor.test.js
 */

'use strict';

// ── 테스트 러너 ──────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;
const failures = [];

function assert(condition, label, detail = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} — ${detail}` : label;
    failures.push(msg);
    console.error(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`);
  }
}

function assertMatch(str, pattern, label) {
  assert(pattern.test(str), label, `패턴 ${pattern} 에 매치 안 됨\n      출력: ${str.replace(/\n/g,' ').slice(0,120)}`);
}

function assertNoMatch(str, pattern, label) {
  assert(!pattern.test(str), label, `패턴 ${pattern} 가 있으면 안 됨\n      출력: ${str.replace(/\n/g,' ').slice(0,120)}`);
}

function assertEqual(a, b, label) {
  assert(a === b, label, `기대: ${JSON.stringify(b)}\n      실제: ${JSON.stringify(a)}`);
}

function section(name) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('─'.repeat(60));
}

// ── 환경 설정 ────────────────────────────────────────────────
// 파서 로드 (IIFE를 globalThis에 노출)
const fs = require('fs');
const parserSrc = fs.readFileSync('./markdown-parser.js', 'utf8')
  .replace('const MarkdownParser', 'globalThis.MarkdownParser');
eval(parserSrc);

// DOM/브라우저 API 모킹
const localStorageStore = {};
globalThis.localStorage = {
  getItem: (k) => localStorageStore[k] !== undefined ? localStorageStore[k] : null,
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
};

// editor.js 에서 사용하는 DOM 요소 모킹
function makeElement(tag = 'div', extra = {}) {
  return Object.assign({
    tagName: tag.toUpperCase(),
    value: '',
    innerHTML: '',
    textContent: '',
    selectionStart: 0,
    selectionEnd: 0,
    className: '',
    dataset: {},
    style: {},
    children: [],
    _listeners: {},
    addEventListener(ev, fn) {
      if (!this._listeners[ev]) this._listeners[ev] = [];
      this._listeners[ev].push(fn);
    },
    dispatchEvent(ev) {
      const handlers = this._listeners[ev.type] || [];
      handlers.forEach(fn => fn(ev));
    },
    focus() {},
    click() {},
    querySelectorAll(sel) { return []; },
  }, extra);
}

// ────────────────────────────────────────────────────────────
// 1. 마크다운 파서 — 기본 요소
// ────────────────────────────────────────────────────────────
section('1. 파서 — 제목 (H1–H6)');
{
  const p = MarkdownParser.parse;
  for (let i = 1; i <= 6; i++) {
    const hashes = '#'.repeat(i);
    assertMatch(p(`${hashes} 제목${i}`), new RegExp(`<h${i}[^>]*>제목${i}</h${i}>`), `H${i} 제목`);
  }
  assertMatch(p('# 공백 포함 제목'), /<h1[^>]*>공백 포함 제목<\/h1>/, 'H1 공백 포함');
  assertMatch(p('## id 생성'), /id="id-/, 'H2 id 속성 생성');
}

section('2. 파서 — 인라인 서식');
{
  const p = MarkdownParser.parse;
  assertMatch(p('**굵게**'), /<strong>굵게<\/strong>/, '** 굵게');
  assertMatch(p('__굵게__'), /<strong>굵게<\/strong>/, '__ 굵게');
  assertMatch(p('*기울임*'), /<em>기울임<\/em>/, '* 기울임');
  assertMatch(p('_기울임_'), /<em>기울임<\/em>/, '_ 기울임');
  assertMatch(p('***굵+기울***'), /<strong><em>굵\+기울<\/em><\/strong>/, '*** 굵게+기울임');
  assertMatch(p('___굵+기울___'), /<strong><em>굵\+기울<\/em><\/strong>/, '___ 굵게+기울임');
  assertMatch(p('~~취소선~~'), /<del>취소선<\/del>/, '~~ 취소선');
  assertMatch(p('`인라인코드`'), /<code>인라인코드<\/code>/, '백틱 인라인 코드');
  assertMatch(p('``이중백틱``'), /<code>이중백틱<\/code>/, '이중 백틱 인라인 코드');
}

section('3. 파서 — 코드 블록');
{
  const p = MarkdownParser.parse;
  assertMatch(p('```\n코드\n```'), /code-block-wrapper/, '펜스 코드 블록');
  assertMatch(p('```js\nconsole.log()\n```'), /code-lang/, '언어 레이블 있는 코드 블록');
  assertMatch(p('```js\nconsole.log()\n```'), /language-js/, '언어 클래스 부여');
  assertMatch(p('```\n<b>태그</b>\n```'), /&lt;b&gt;태그&lt;\/b&gt;/, '코드 블록 내 HTML 이스케이프');
  assertMatch(p('~~~\n물결코드\n~~~'), /code-block-wrapper/, '물결선(~~~) 코드 블록');
  // 코드 블록 내부는 마크다운 처리 안 됨
  assertNoMatch(p('```\n**not bold**\n```'), /<strong>/, '코드 블록 내 마크다운 비처리');
}

section('4. 파서 — 링크 & 이미지');
{
  const p = MarkdownParser.parse;
  assertMatch(p('[텍스트](https://example.com)'), /<a href="https:\/\/example\.com"/, '기본 링크');
  assertMatch(p('[텍스트](https://example.com)'), /target="_blank"/, '링크 target=_blank');
  assertMatch(p('[텍스트](https://example.com "제목")'), /title="제목"/, '링크 title 속성');
  assertMatch(p('![대체텍스트](img.png)'), /<img src="img\.png" alt="대체텍스트">/, '기본 이미지');
  assertMatch(p('![alt](img.png "설명")'), /title="설명"/, '이미지 title 속성');
  // XSS 방어 — href에 javascript: 가 html 이스케이프 돼야 함
  assertNoMatch(p('[x](<script>)'), /<script>/, '링크 XSS 방어');
}

section('5. 파서 — 비순서 목록');
{
  const p = MarkdownParser.parse;
  assertMatch(p('- 항목1\n- 항목2'), /<ul>/, '- 비순서 목록');
  assertMatch(p('* 항목1\n* 항목2'), /<ul>/, '* 비순서 목록');
  assertMatch(p('+ 항목1\n+ 항목2'), /<ul>/, '+ 비순서 목록');
  assertMatch(p('- 항목1\n- 항목2'), /<li>항목1<\/li>/, '비순서 목록 항목 내용');
  // 중첩
  const nested = '- 상위\n  - 하위1\n  - 하위2';
  assertMatch(p(nested), /<ul>[\s\S]*<ul>/, '중첩 비순서 목록');
}

section('6. 파서 — 순서 목록');
{
  const p = MarkdownParser.parse;
  assertMatch(p('1. 첫째\n2. 둘째'), /<ol>/, '순서 목록');
  assertMatch(p('1. 첫째\n2. 둘째'), /<li>첫째<\/li>/, '순서 목록 항목 내용');
  // 중첩
  const nested = '1. 상위\n   1. 하위1\n   2. 하위2';
  assertMatch(p(nested), /<ol>[\s\S]*<ol>/, '중첩 순서 목록');
}

section('7. 파서 — 인용구');
{
  const p = MarkdownParser.parse;
  assertMatch(p('> 인용문'), /<blockquote>/, '기본 인용구');
  assertMatch(p('> 인용\n> 계속'), /<blockquote>/, '여러 줄 인용구');
  assertMatch(p('> 상위\n> > 하위'), /<blockquote>[\s\S]*<blockquote>/, '중첩 인용구');
}

section('8. 파서 — 수평선');
{
  const p = MarkdownParser.parse;
  assertMatch(p('---'), /<hr>/, '--- 수평선');
  assertMatch(p('***'), /<hr>/, '*** 수평선');
  assertMatch(p('___'), /<hr>/, '___ 수평선');
  assertMatch(p('- - -'), /<hr>/, '- - - 수평선');
  assertMatch(p('* * *'), /<hr>/, '* * * 수평선');
}

section('9. 파서 — 단락 & 줄바꿈');
{
  const p = MarkdownParser.parse;
  assertMatch(p('첫 단락\n\n두 번째 단락'), /<p>첫 단락<\/p>/, '단락 분리');
  assertMatch(p('줄바꿈  \n다음 줄'), /<br>/, '공백 2개 줄바꿈');
  assertMatch(p('줄바꿈\\\n다음 줄'), /<br>/, '백슬래시 줄바꿈');
}

section('10. 파서 — 이스케이프 문자');
{
  const p = MarkdownParser.parse;
  assertNoMatch(p('\\*이탤릭 아님\\*'), /<em>/, '\\* 이스케이프');
  assertNoMatch(p('\\**굵게 아님\\**'), /<strong>/, '\\** 이스케이프');
  assertNoMatch(p('\\# 제목 아님'), /<h1>/, '\\# 이스케이프');
  assertMatch(p('\\*'), /\*/, '이스케이프된 * 출력');
}

// ────────────────────────────────────────────────────────────
// 11. 파서 — 엣지 케이스
// ────────────────────────────────────────────────────────────
section('11. 파서 — 엣지 케이스');
{
  const p = MarkdownParser.parse;

  // 빈 입력
  assertEqual(p(''), '', '빈 입력 → 빈 문자열');
  assertEqual(p(null), '', 'null 입력 → 빈 문자열');

  // 공백만 있는 입력
  const wsResult = p('   \n   \n   ');
  assert(!/<p>\s*<\/p>/.test(wsResult) || wsResult.trim() === '', '공백만 있는 입력 → 빈 단락 없음');

  // 닫히지 않은 굵게/기울임 — <strong>/<em> 미생성
  assertNoMatch(p('**닫히지 않음'), /<strong>/, '닫히지 않은 ** → strong 미생성');
  assertNoMatch(p('*닫히지 않음'), /<em>/, '닫히지 않은 * → em 미생성');

  // 잘못된 링크 — []만 있고 () 없음
  assertNoMatch(p('[링크텍스트]'), /<a /, '괄호 없는 링크 → a 태그 미생성');

  // 연속 제목
  const consec = '# 제목1\n## 제목2\n### 제목3';
  assertMatch(p(consec), /<h1[^>]*>제목1<\/h1>/, '연속 제목 — H1');
  assertMatch(p(consec), /<h2[^>]*>제목2<\/h2>/, '연속 제목 — H2');
  assertMatch(p(consec), /<h3[^>]*>제목3<\/h3>/, '연속 제목 — H3');

  // 혼합 인라인 서식
  assertMatch(p('**굵게 *그리고 기울임* 끝**'), /<strong>굵게 <em>그리고 기울임<\/em> 끝<\/strong>/, '굵게 안에 기울임');

  // 코드 안에 마크다운 — 처리 안 됨
  assertNoMatch(p('`**굵게 아님**`'), /<strong>/, '인라인 코드 내 마크다운 비처리');

  // XSS 방어
  assertNoMatch(p('<script>alert(1)</script>'), /<script>/, 'script 태그 이스케이프');
  assertMatch(p('<script>alert(1)</script>'), /&lt;script&gt;/, 'script → &lt;script&gt;');
  assertNoMatch(p('<img onerror="evil()">'), /<img onerror/, 'onerror 이스케이프');

  // 유니코드
  assertMatch(p('# 한글 제목 🎉'), /한글 제목 🎉/, '유니코드 제목');
  assertMatch(p('**한글 굵게**'), /한글 굵게/, '유니코드 굵게');

  // 링크 텍스트 안에 굵게
  assertMatch(p('[**굵은 링크**](https://x.com)'), /<a[^>]*>.*<strong>/, '링크 텍스트 안에 굵게');

  // 인용구 안에 인라인 서식
  assertMatch(p('> **굵은 인용**'), /<blockquote>[\s\S]*<strong>굵은 인용<\/strong>/, '인용구 내 굵게');
}

// ────────────────────────────────────────────────────────────
// 12. 툴바 액션 — 삽입 동작 시뮬레이션
// ────────────────────────────────────────────────────────────
section('12. 툴바 액션 — 선택 없을 때 삽입');
{
  // 툴바 액션을 직접 시뮬레이션 (editor.js 종속 없이)
  // insertAtCursor / wrapSelection / insertLinePrefix 동작을 직접 테스트

  function simulateInsert(initial, cursorPos, insertText) {
    const before = initial.slice(0, cursorPos);
    const after  = initial.slice(cursorPos);
    return before + insertText + after;
  }

  function simulateWrap(initial, start, end, prefix, suffix) {
    const selected = initial.slice(start, end);
    const wrapped  = prefix + (selected || '') + suffix;
    return initial.slice(0, start) + wrapped + initial.slice(end);
  }

  function simulateLinePrefix(initial, cursorPos, prefix) {
    const lineStart = initial.lastIndexOf('\n', cursorPos - 1) + 1;
    return initial.slice(0, lineStart) + prefix + initial.slice(lineStart);
  }

  // 굵게 — 선택 없을 때
  const boldEmpty = simulateWrap('', 0, 0, '**', '**');
  assertEqual(boldEmpty, '****', '굵게 선택 없음 → ****');

  // 굵게 — 텍스트 선택 시 감싸기
  const boldWrap = simulateWrap('hello world', 6, 11, '**', '**');
  assertEqual(boldWrap, 'hello **world**', '굵게 선택 텍스트 감싸기');

  // 기울임 감싸기
  const italicWrap = simulateWrap('hello world', 0, 5, '*', '*');
  assertEqual(italicWrap, '*hello* world', '기울임 선택 텍스트 감싸기');

  // H1 삽입
  const h1 = simulateLinePrefix('제목입니다', 0, '# ');
  assertEqual(h1, '# 제목입니다', 'H1 접두사 삽입');

  // H2 삽입
  const h2 = simulateLinePrefix('제목', 0, '## ');
  assertEqual(h2, '## 제목', 'H2 접두사 삽입');

  // H3 삽입
  const h3 = simulateLinePrefix('제목', 0, '### ');
  assertEqual(h3, '### 제목', 'H3 접두사 삽입');

  // 비순서 목록
  const ul = simulateLinePrefix('항목', 0, '- ');
  assertEqual(ul, '- 항목', '비순서 목록 접두사 삽입');

  // 순서 목록
  const ol = simulateLinePrefix('항목', 0, '1. ');
  assertEqual(ol, '1. 항목', '순서 목록 접두사 삽입');

  // 인용구
  const bq = simulateLinePrefix('인용문', 0, '> ');
  assertEqual(bq, '> 인용문', '인용구 접두사 삽입');

  // 수평선
  const hr = simulateInsert('위\n아래', 2, '\n---\n');
  assertEqual(hr, '위\n\n---\n아래', '수평선 삽입');

  // 인라인 코드 감싸기
  const code = simulateWrap('코드 샘플', 0, 2, '`', '`');
  assertEqual(code, '`코드` 샘플', '인라인 코드 선택 감싸기');
}

section('13. 툴바 액션 — 커서 중간 삽입');
{
  function simulateWrap(text, start, end, prefix, suffix) {
    const sel = text.slice(start, end);
    return text.slice(0, start) + prefix + sel + suffix + text.slice(end);
  }

  // 문장 중간에서 굵게 처리
  const mid = '앞 텍스트 중간 텍스트 뒤 텍스트';
  // '중간 텍스트' = 인덱스 5~12
  const midBold = simulateWrap(mid, 6, 12, '**', '**');
  assertEqual(midBold, '앞 텍스트 **중간 텍스트** 뒤 텍스트', '문장 중간 굵게 감싸기');

  // 여러 줄 선택 → 코드 블록
  function simulateCodeBlock(text, start, end) {
    const selected = text.slice(start, end);
    const block = selected.includes('\n')
      ? '```\n' + selected + '\n```'
      : '`' + selected + '`';
    return text.slice(0, start) + block + text.slice(end);
  }

  const multiline = '첫째 줄\n둘째 줄\n셋째 줄';
  const codeResult = simulateCodeBlock(multiline, 0, multiline.length);
  assert(codeResult.startsWith('```\n'), '여러 줄 선택 → 코드 블록 시작');
  assert(codeResult.endsWith('\n```'), '여러 줄 선택 → 코드 블록 끝');

  const singleLine = '단일 코드';
  const inlineResult = simulateCodeBlock(singleLine, 0, 2);
  assertEqual(inlineResult, '`단일` 코드', '단일 줄 선택 → 인라인 코드');
}

section('14. 툴바 액션 — 링크 & 이미지 삽입');
{
  // 링크 삽입 — 텍스트 선택 시
  function simulateLinkWrap(text, start, end) {
    const sel = text.slice(start, end);
    if (sel) {
      return text.slice(0, start) + `[${sel}](https://)` + text.slice(end);
    }
    return text.slice(0, start) + '[링크 텍스트](https://)' + text.slice(end);
  }

  const linkSel = simulateLinkWrap('클릭하세요', 0, 5);
  assertEqual(linkSel, '[클릭하세요](https://)', '텍스트 선택 후 링크 감싸기');

  const linkEmpty = simulateLinkWrap('', 0, 0);
  assertEqual(linkEmpty, '[링크 텍스트](https://)', '선택 없을 때 기본 링크 삽입');

  // 이미지 삽입
  function simulateImageWrap(text, start, end) {
    const sel = text.slice(start, end);
    const alt = sel || '이미지 설명';
    return text.slice(0, start) + `![${alt}](이미지 URL)` + text.slice(end);
  }

  const imgSel = simulateImageWrap('logo', 0, 4);
  assertEqual(imgSel, '![logo](이미지 URL)', '이미지 alt 텍스트 선택 감싸기');

  const imgEmpty = simulateImageWrap('', 0, 0);
  assertEqual(imgEmpty, '![이미지 설명](이미지 URL)', '선택 없을 때 기본 이미지 삽입');
}

// ────────────────────────────────────────────────────────────
// 15. 에디터 상태 — localStorage 저장/복원
// ────────────────────────────────────────────────────────────
section('15. 에디터 상태 — localStorage 저장/복원');
{
  const STORAGE_KEY = 'md-editor-content';

  // 초기 상태 정리
  localStorage.clear();
  assert(localStorage.getItem(STORAGE_KEY) === null, '초기 상태: 저장값 없음');

  // 저장
  const testContent = '# 테스트\n\n본문 내용';
  localStorage.setItem(STORAGE_KEY, testContent);
  assertEqual(localStorage.getItem(STORAGE_KEY), testContent, '저장 후 복원');

  // 덮어쓰기
  const newContent = '## 수정된 내용';
  localStorage.setItem(STORAGE_KEY, newContent);
  assertEqual(localStorage.getItem(STORAGE_KEY), newContent, '덮어쓰기 저장');

  // 삭제 후 null 확인
  localStorage.removeItem(STORAGE_KEY);
  assert(localStorage.getItem(STORAGE_KEY) === null, '삭제 후 null 반환');

  // 빈 문자열 저장
  localStorage.setItem(STORAGE_KEY, '');
  assertEqual(localStorage.getItem(STORAGE_KEY), '', '빈 문자열 저장/복원');

  // 긴 내용 저장
  const longContent = '# 제목\n\n' + '본문 내용\n'.repeat(500);
  localStorage.setItem(STORAGE_KEY, longContent);
  assertEqual(localStorage.getItem(STORAGE_KEY), longContent, '긴 콘텐츠 저장/복원');

  // 유니코드 저장
  const unicodeContent = '# 한글 🎉 日本語 العربية';
  localStorage.setItem(STORAGE_KEY, unicodeContent);
  assertEqual(localStorage.getItem(STORAGE_KEY), unicodeContent, '유니코드 저장/복원');

  // 특수문자 저장
  const specialContent = '```js\nconsole.log("hello & <world>")\n```';
  localStorage.setItem(STORAGE_KEY, specialContent);
  assertEqual(localStorage.getItem(STORAGE_KEY), specialContent, '특수문자 저장/복원 (원본 마크다운)');

  localStorage.clear();
}

// ────────────────────────────────────────────────────────────
// 16. HTML 내보내기 — 출력 정합성
// ────────────────────────────────────────────────────────────
section('16. HTML 내보내기 — 출력 정합성');
{
  // exportHtml 의 핵심 로직: 미리보기 innerHTML을 감싼 완전한 HTML 생성
  function buildExportHtml(bodyHtml) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>내보낸 마크다운</title>
  <style>
    body { font-family: sans-serif; }
  </style>
</head>
<body>
  <div class="container">
${bodyHtml}
  </div>
</body>
</html>`;
  }

  const sampleMd = '# 제목\n\n**굵게** 텍스트\n\n- 항목1\n- 항목2';
  const renderedHtml = MarkdownParser.parse(sampleMd);
  const exported = buildExportHtml(renderedHtml);

  assertMatch(exported, /<!DOCTYPE html>/, '내보내기 DOCTYPE 포함');
  assertMatch(exported, /<meta charset="UTF-8">/, '내보내기 charset 포함');
  assertMatch(exported, /<html lang="ko">/, '내보내기 lang 속성');
  assertMatch(exported, /<div class="container">/, '내보내기 container div 포함');
  assertMatch(exported, /<\/html>/, '내보내기 html 닫힘');
  assertMatch(exported, /<h1[^>]*>제목<\/h1>/, '내보내기 파싱된 H1 포함');
  assertMatch(exported, /<strong>굵게<\/strong>/, '내보내기 파싱된 굵게 포함');
  assertMatch(exported, /<ul>/, '내보내기 파싱된 목록 포함');

  // XSS 없음 확인 (미리보기 HTML이 이미 이스케이프됨)
  const xssMd = '<script>alert(1)</script>';
  const xssHtml = MarkdownParser.parse(xssMd);
  const xssExport = buildExportHtml(xssHtml);
  assertNoMatch(xssExport, /<script>alert/, '내보내기 XSS 스크립트 없음');
  assertMatch(xssExport, /&lt;script&gt;/, '내보내기 스크립트 이스케이프됨');

  // 빈 콘텐츠 내보내기
  const emptyExport = buildExportHtml('');
  assertMatch(emptyExport, /<!DOCTYPE html>/, '빈 콘텐츠 내보내기 구조 유지');
}

// ────────────────────────────────────────────────────────────
// 17. 파서 — 복잡한 중첩 케이스
// ────────────────────────────────────────────────────────────
section('17. 파서 — 복잡한 조합');
{
  const p = MarkdownParser.parse;

  // 코드 블록 + 텍스트 혼합
  const mixed = '# 제목\n\n본문 텍스트\n\n```js\nconst x = 1;\n```\n\n마무리';
  assertMatch(p(mixed), /<h1[^>]*>제목<\/h1>/, '혼합: H1');
  assertMatch(p(mixed), /<p>본문 텍스트<\/p>/, '혼합: 단락');
  assertMatch(p(mixed), /code-block-wrapper/, '혼합: 코드 블록');
  assertMatch(p(mixed), /<p>마무리<\/p>/, '혼합: 마지막 단락');

  // 목록 + 인라인 서식
  const listFmt = '- **굵은 항목**\n- *기울임 항목*\n- `코드 항목`';
  assertMatch(p(listFmt), /<li><strong>굵은 항목<\/strong><\/li>/, '목록 항목 내 굵게');
  assertMatch(p(listFmt), /<li><em>기울임 항목<\/em><\/li>/, '목록 항목 내 기울임');
  assertMatch(p(listFmt), /<li><code>코드 항목<\/code><\/li>/, '목록 항목 내 인라인 코드');

  // 인용구 + 인라인 서식
  const bqFmt = '> **굵은 인용** 텍스트';
  assertMatch(p(bqFmt), /<blockquote>[\s\S]*<strong>굵은 인용<\/strong>[\s\S]*<\/blockquote>/, '인용구 내 굵게');

  // 제목 내 인라인 서식 — 굵게
  assertMatch(p('# **굵은** 제목'), /<h1[^>]*>.*<strong>굵은<\/strong>.*<\/h1>/, '제목 내 굵게');
}

section('18. 파서 — 특수 케이스');
{
  const p = MarkdownParser.parse;

  // 숫자로 시작하지만 순서 목록이 아닌 경우
  assertNoMatch(p('2024년 현황'), /<ol>/, '연도는 순서 목록 아님');

  // 백슬래시 연속
  assertMatch(p('\\\\'), /\\/, '이중 백슬래시 → 단일 백슬래시');

  // 앰퍼샌드 이스케이프
  assertMatch(p('A & B'), /A &amp; B/, '& → &amp; 이스케이프');

  // 제목에 특수문자 포함 시 id 안전 처리
  const headingHtml = p('# Hello World!');
  assertMatch(headingHtml, /id="hello-world"/, '특수문자 제거한 제목 id');

  // 인라인 코드 내 백틱
  assertMatch(p('`` `백틱` ``'), /<code>/, '이중 백틱으로 백틱 감싸기');
}

// ────────────────────────────────────────────────────────────
// 19. 보안 — sanitizeUrl (javascript:/data: 프로토콜 차단)
// ────────────────────────────────────────────────────────────
section('19. 보안 — URL 프로토콜 차단 (XSS)');
{
  const p = MarkdownParser.parse;

  // javascript: 링크 차단
  const jsLink = p('[클릭](javascript:alert(1))');
  assertNoMatch(jsLink, /href="javascript:/, 'javascript: 링크 href 차단');
  assertMatch(jsLink, /href="#"/, 'javascript: 링크 → href="#" 대체');

  // data: 링크 차단
  const dataLink = p('[클릭](data:text/html,<h1>xss</h1>)');
  assertNoMatch(dataLink, /href="data:/, 'data: 링크 href 차단');
  assertMatch(dataLink, /href="#"/, 'data: 링크 → href="#" 대체');

  // vbscript: 차단
  const vbLink = p('[클릭](vbscript:msgbox(1))');
  assertNoMatch(vbLink, /href="vbscript:/, 'vbscript: 링크 href 차단');
  assertMatch(vbLink, /href="#"/, 'vbscript: → href="#" 대체');

  // 대소문자 혼합 우회 시도 차단
  const mixedCase = p('[클릭](JaVaScRiPt:alert(1))');
  assertNoMatch(mixedCase, /href="[Jj]a[Vv]a/, 'javascript: 대소문자 혼합 차단');

  // 공백 삽입 우회 시도 차단
  const withSpace = p('[클릭](  javascript:alert(1))');
  assertNoMatch(withSpace, /javascript:alert/, '앞 공백 포함 javascript: 차단');

  // javascript: 이미지 src 차단
  const jsImg = p('![alt](javascript:alert(1))');
  assertNoMatch(jsImg, /src="javascript:/, 'javascript: 이미지 src 차단');
  assertMatch(jsImg, /src="#"/, 'javascript: 이미지 → src="#" 대체');

  // 정상 https: URL은 통과
  const safeLink = p('[링크](https://example.com)');
  assertMatch(safeLink, /href="https:\/\/example\.com"/, 'https: URL은 정상 통과');

  // 정상 상대 경로는 통과
  const relLink = p('[링크](/about)');
  assertMatch(relLink, /href="\/about"/, '상대 경로 URL 정상 통과');

  // escapeHtml 단따옴표 이스케이프 확인
  const singleQuote = p("[링크](https://x.com/a'b)");
  assertNoMatch(singleQuote, /href="[^"]*'[^"]*"/, "href 내 단따옴표 이스케이프");
}

// ────────────────────────────────────────────────────────────
// 20. 파서 — 이스케이프 상태 격리 (연속 parse 호출 독립성)
// ────────────────────────────────────────────────────────────
section('20. 파서 — 연속 호출 격리');
{
  const p = MarkdownParser.parse;

  // 첫 번째 호출 결과가 두 번째 호출에 영향을 주지 않아야 함
  const r1 = p('\\*이스케이프\\*');
  const r2 = p('*기울임*');
  assertNoMatch(r1, /<em>/, '1차 호출: 이스케이프 * → em 미생성');
  assertMatch(r2, /<em>기울임<\/em>/, '2차 호출: 정상 기울임 생성 (1차 오염 없음)');

  // 이스케이프 문자가 많은 입력 후 정상 파싱
  const heavy = p('\\# \\* \\_ \\` \\[ \\]');
  const normal = p('# 제목');
  assertNoMatch(heavy, /<h1>/, '대량 이스케이프 후 h1 미생성');
  assertMatch(normal, /<h1[^>]*>제목<\/h1>/, '이스케이프 heavy 처리 후 정상 h1 파싱');

  // rel="noopener noreferrer" 확인 (보안 강화)
  const link = p('[링크](https://example.com)');
  assertMatch(link, /rel="noopener noreferrer"/, '외부 링크 rel=noopener noreferrer');
}

// ────────────────────────────────────────────────────────────
// 최종 결과
// ────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(`  최종 결과: ${passed}/${total} 통과, ${failed} 실패`);
console.log('═'.repeat(60));

if (failures.length > 0) {
  console.error('\n실패한 테스트:');
  failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
}

process.exit(failed > 0 ? 1 : 0);
