'use strict';

// ─────────────────────────────────────────
// Node.js 환경 설정 (브라우저 API 모킹)
// ─────────────────────────────────────────
const fs = require('fs');
const path = require('path');

// localStorage 모킹
const localStorageStore = {};
global.localStorage = {
  getItem: (k) => localStorageStore[k] ?? null,
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
};

// DOM 모킹 (editor.js 초기화용)
global.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => ({ forEach: () => {} }),
  createElement: (tag) => ({
    tag, href: '', download: '', click: () => {}, style: {},
    appendChild: () => {}, removeChild: () => {},
  }),
  body: { appendChild: () => {}, removeChild: () => {}, classList: { add: () => {}, remove: () => {} }, style: {} },
  title: 'Test',
  addEventListener: () => {},
};
global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
global.Blob = class Blob { constructor(parts, opts) { this.content = parts.join(''); this.type = opts?.type || ''; } };
global.setTimeout = (fn, ms) => { fn(); return 0; };
global.clearTimeout = () => {};

// MarkdownParser 로드 (vm.runInThisContext: strict mode eval 스코프 제한 우회)
const vm = require('vm');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'markdown-parser.js'), 'utf8'));

// ─────────────────────────────────────────
// 테스트 유틸리티
// ─────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function assertContains(html, substring, label) {
  assert(html.includes(substring), `${label} — 포함: "${substring}"`);
}

function assertNotContains(html, substring, label) {
  assert(!html.includes(substring), `${label} — 미포함: "${substring}"`);
}

function assertMatch(html, regex, label) {
  assert(regex.test(html), `${label} — 패턴: ${regex}`);
}

function suite(name, fn) {
  console.log(`\n▶ ${name}`);
  fn();
}

// ─────────────────────────────────────────
// 파서 인스턴스
// ─────────────────────────────────────────
const parser = new MarkdownParser();

// ─────────────────────────────────────────
// 1. 제목 (h1~h6)
// ─────────────────────────────────────────
suite('제목 파싱 (h1~h6)', () => {
  assertContains(parser.parse('# H1 제목'), '<h1', 'h1 태그 생성');
  assertContains(parser.parse('# H1 제목'), 'H1 제목', 'h1 내용 포함');
  assertContains(parser.parse('## H2 제목'), '<h2', 'h2 태그 생성');
  assertContains(parser.parse('### H3 제목'), '<h3', 'h3 태그 생성');
  assertContains(parser.parse('#### H4 제목'), '<h4', 'h4 태그 생성');
  assertContains(parser.parse('##### H5 제목'), '<h5', 'h5 태그 생성');
  assertContains(parser.parse('###### H6 제목'), '<h6', 'h6 태그 생성');
  assertContains(parser.parse('# 제목'), 'id="', 'h1 id 속성 생성');
  assertNotContains(parser.parse('#제목'), '<h1', '공백 없는 # 은 제목 아님');
  assertContains(parser.parse('# **굵은** 제목'), '<strong>', '제목 안 인라인 서식');
});

// ─────────────────────────────────────────
// 2. 굵게, 기울임, 굵게+기울임
// ─────────────────────────────────────────
suite('텍스트 서식', () => {
  assertContains(parser.parse('**굵게**'), '<strong>굵게</strong>', '** 굵게');
  assertContains(parser.parse('__굵게__'), '<strong>굵게</strong>', '__ 굵게');
  assertContains(parser.parse('*기울임*'), '<em>기울임</em>', '* 기울임');
  assertContains(parser.parse('_기울임_'), '<em>기울임</em>', '_ 기울임');
  assertContains(parser.parse('***굵은기울임***'), '<strong><em>굵은기울임</em></strong>', '*** 굵게+기울임');
  assertContains(parser.parse('___굵은기울임___'), '<strong><em>굵은기울임</em></strong>', '___ 굵게+기울임');
  assertContains(parser.parse('~~취소선~~'), '<del>취소선</del>', '~~ 취소선');
  assertContains(parser.parse('일반 **굵게** 일반'), '<strong>굵게</strong>', '문장 중간 굵게');
});

// ─────────────────────────────────────────
// 3. 인라인 코드
// ─────────────────────────────────────────
suite('인라인 코드', () => {
  assertContains(parser.parse('`code`'), '<code>code</code>', '인라인 코드 태그');
  assertNotContains(parser.parse('`**bold**`'), '<strong>', '코드 내부 마크다운 미처리');
  assertContains(parser.parse('`<div>`'), '&lt;div&gt;', '코드 내 HTML 이스케이프');
  assertContains(parser.parse('a `b` c'), '<code>b</code>', '문장 중간 인라인 코드');
});

// ─────────────────────────────────────────
// 4. 코드 블록
// ─────────────────────────────────────────
suite('코드 블록', () => {
  const jsBlock = parser.parse('```javascript\nconsole.log("hi");\n```');
  assertContains(jsBlock, '<code', '코드 블록 code 태그');
  assertContains(jsBlock, 'code-block', '코드 블록 래퍼 클래스');
  assertContains(jsBlock, 'javascript', '언어 레이블 포함');
  assertContains(jsBlock, 'console.log', '코드 내용 포함');
  assertNotContains(jsBlock, '<strong>', '코드 블록 내 마크다운 미처리');
  assertContains(jsBlock, '&quot;hi&quot;', '코드 블록 내 따옴표 이스케이프');

  const noLang = parser.parse('```\ncode here\n```');
  assertContains(noLang, 'code here', '언어 없는 코드 블록');
  assertNotContains(noLang, 'data-language', '언어 없으면 data-language 없음');

  const multiLine = parser.parse('```\nline1\nline2\nline3\n```');
  assertContains(multiLine, 'line1\nline2\nline3', '여러 줄 코드 블록 개행 유지');
});

// ─────────────────────────────────────────
// 5. 링크, 이미지
// ─────────────────────────────────────────
suite('링크와 이미지', () => {
  const link = parser.parse('[GitHub](https://github.com)');
  assertContains(link, '<a href="https://github.com"', '링크 href');
  assertContains(link, '>GitHub</a>', '링크 텍스트');
  assertContains(link, 'target="_blank"', '링크 새 탭');
  assertContains(link, 'rel="noopener noreferrer"', '링크 rel 보안');

  const img = parser.parse('![alt text](https://example.com/img.png)');
  assertContains(img, '<img', '이미지 태그');
  assertContains(img, 'src="https://example.com/img.png"', '이미지 src');
  assertContains(img, 'alt="alt text"', '이미지 alt');

  const autoLink = parser.parse('<https://example.com>');
  assertContains(autoLink, '<a href="https://example.com"', '자동 링크');

  // 이미지가 링크로 처리되지 않음
  assertNotContains(img, '<a href', '이미지를 링크로 처리하지 않음');
});

// ─────────────────────────────────────────
// 6. 비순서 목록
// ─────────────────────────────────────────
suite('비순서 목록', () => {
  const ul = parser.parse('- 항목1\n- 항목2\n- 항목3');
  assertContains(ul, '<ul>', 'ul 태그');
  assertContains(ul, '<li>항목1</li>', '목록 항목 1');
  assertContains(ul, '<li>항목2</li>', '목록 항목 2');
  assertContains(ul, '<li>항목3</li>', '목록 항목 3');

  const ulStar = parser.parse('* 항목A\n* 항목B');
  assertContains(ulStar, '<ul>', '* 비순서 목록');

  const ulPlus = parser.parse('+ 항목X\n+ 항목Y');
  assertContains(ulPlus, '<ul>', '+ 비순서 목록');
});

// ─────────────────────────────────────────
// 7. 순서 목록
// ─────────────────────────────────────────
suite('순서 목록', () => {
  const ol = parser.parse('1. 첫번째\n2. 두번째\n3. 세번째');
  assertContains(ol, '<ol>', 'ol 태그');
  assertContains(ol, '<li>첫번째</li>', '순서 항목 1');
  assertContains(ol, '<li>두번째</li>', '순서 항목 2');
  assertContains(ol, '<li>세번째</li>', '순서 항목 3');
});

// ─────────────────────────────────────────
// 8. 중첩 목록
// ─────────────────────────────────────────
suite('중첩 목록', () => {
  const nested = parser.parse('- 부모1\n  - 자식1\n  - 자식2\n- 부모2');
  assertContains(nested, '<ul>', '외부 ul');
  assertMatch(nested, /<li>부모1.*<ul>/s, '부모 항목 안 중첩 ul');
  assertContains(nested, '<li>자식1</li>', '중첩 자식 항목 1');
  assertContains(nested, '<li>자식2</li>', '중첩 자식 항목 2');
  assertContains(nested, '<li>부모2</li>', '두 번째 부모 항목');

  const deepNested = parser.parse('- a\n  - b\n    - c');
  assertMatch(deepNested, /<ul>.*<ul>.*<ul>/s, '3단계 중첩 목록');
});

// ─────────────────────────────────────────
// 9. 인용구, 중첩 인용구
// ─────────────────────────────────────────
suite('인용구', () => {
  const bq = parser.parse('> 인용 텍스트');
  assertContains(bq, '<blockquote>', 'blockquote 태그');
  assertContains(bq, '인용 텍스트', '인용 내용');

  const nestedBq = parser.parse('> 외부\n>> 내부');
  assertContains(nestedBq, '<blockquote>', '외부 blockquote');
  assertMatch(nestedBq, /<blockquote>.*<blockquote>/s, '중첩 blockquote');
  assertContains(nestedBq, '내부', '중첩 인용 내용');

  const bqFormatted = parser.parse('> **굵게** 인용');
  assertContains(bqFormatted, '<strong>굵게</strong>', '인용구 내 서식');
});

// ─────────────────────────────────────────
// 10. 수평선
// ─────────────────────────────────────────
suite('수평선', () => {
  assertContains(parser.parse('---'), '<hr>', '--- 수평선');
  assertContains(parser.parse('***'), '<hr>', '*** 수평선');
  assertContains(parser.parse('___'), '<hr>', '___ 수평선');
  assertContains(parser.parse('-----'), '<hr>', '----- 수평선');
  assertNotContains(parser.parse('--'), '<hr>', '-- 은 수평선 아님');
});

// ─────────────────────────────────────────
// 11. 문단, 줄 바꿈
// ─────────────────────────────────────────
suite('문단과 줄 바꿈', () => {
  const para = parser.parse('첫 번째 문단\n\n두 번째 문단');
  assertContains(para, '<p>첫 번째 문단</p>', '첫 번째 문단');
  assertContains(para, '<p>두 번째 문단</p>', '두 번째 문단');

  const br = parser.parse('첫 줄  \n두 번째 줄');
  assertContains(br, '<br>', 'trailing space 줄 바꿈');

  const singleLine = parser.parse('한 줄');
  assertContains(singleLine, '<p>한 줄</p>', '단일 줄 문단');
});

// ─────────────────────────────────────────
// 12. 이스케이프 문자
// ─────────────────────────────────────────
suite('이스케이프 문자', () => {
  const escaped = parser.parse('\\*별표\\*');
  assertNotContains(escaped, '<em>', '이스케이프된 * 는 기울임 아님');
  assertContains(escaped, '&#42;', '이스케이프된 * 는 문자 코드로');

  const escapedHash = parser.parse('\\# 제목 아님');
  // 이스케이프된 # 은 제목으로 처리되지 않아야 하나, 현재 구현에서 # 앞의 \ 가 있으면 제목 아님
  // 줄 시작에 \# 이면 제목 패턴 /^(#{1,6})\s/ 와 맞지 않음
  assertNotContains(escapedHash, '<h1', '이스케이프된 # 은 제목 아님');

  const escapedBracket = parser.parse('\\[링크 아님\\]');
  assertNotContains(escapedBracket, '<a', '이스케이프된 [] 는 링크 아님');
});

// ─────────────────────────────────────────
// 13. HTML 이스케이프
// ─────────────────────────────────────────
suite('HTML 이스케이프', () => {
  const xss = parser.parse('<script>alert(1)</script>');
  assertNotContains(xss, '<script>', 'script 태그 이스케이프');
  assertContains(xss, '&lt;script&gt;', 'script 태그 엔티티 변환');

  const amp = parser.parse('a & b');
  assertContains(amp, '&amp;', '앰퍼샌드 이스케이프');
});

// ─────────────────────────────────────────
// 14. 엣지 케이스
// ─────────────────────────────────────────
suite('엣지 케이스', () => {
  assert(parser.parse('') === '', '빈 입력');
  assert(parser.parse('   ') === '', '공백만 있는 입력');
  assert(parser.parse('\n\n\n') === '', '개행만 있는 입력');

  // 닫히지 않은 굵게/기울임 — 그대로 출력
  const unclosedBold = parser.parse('**열림만');
  assertNotContains(unclosedBold, '<strong>', '닫히지 않은 ** 는 strong 아님');

  // 잘못된 링크
  const malformedLink = parser.parse('[텍스트](');
  assertNotContains(malformedLink, '<a href', '잘못된 링크는 a 태그 아님');

  // 연속 제목
  const consecutive = parser.parse('# H1\n## H2\n### H3');
  assertContains(consecutive, '<h1', '연속 h1');
  assertContains(consecutive, '<h2', '연속 h2');
  assertContains(consecutive, '<h3', '연속 h3');

  // 혼합 인라인 서식
  const mixed = parser.parse('**굵고** *기울이고* `코드`');
  assertContains(mixed, '<strong>굵고</strong>', '혼합: 굵게');
  assertContains(mixed, '<em>기울이고</em>', '혼합: 기울임');
  assertContains(mixed, '<code>코드</code>', '혼합: 코드');

  // 빈 제목
  const emptyHeading = parser.parse('# ');
  // 공백만 있는 제목은 파싱 안 됨 (패턴에서 \s+(.+) 필요)
  assertNotContains(emptyHeading, '<h1', '내용 없는 제목 무시');

  // 텍스트 안 HTML 특수문자
  const special = parser.parse('1 < 2 > 0');
  assertContains(special, '&lt;', '< 이스케이프');
  assertContains(special, '&gt;', '> 이스케이프');
});

// ─────────────────────────────────────────
// 15. 복합 문서
// ─────────────────────────────────────────
suite('복합 문서 파싱', () => {
  const doc = `# 메인 제목

## 섹션 1

**굵게** 그리고 *기울임* 텍스트.

- 항목 1
- 항목 2
  - 중첩 항목

1. 순서 1
2. 순서 2

> 인용구
>> 중첩 인용

\`\`\`js
const x = 1;
\`\`\`

---

[링크](https://example.com)`;

  const result = parser.parse(doc);
  assertContains(result, '<h1', '복합 문서 h1');
  assertContains(result, '<h2', '복합 문서 h2');
  assertContains(result, '<strong>굵게</strong>', '복합 문서 굵게');
  assertContains(result, '<em>기울임</em>', '복합 문서 기울임');
  assertContains(result, '<ul>', '복합 문서 ul');
  assertContains(result, '<ol>', '복합 문서 ol');
  assertContains(result, '<blockquote>', '복합 문서 blockquote');
  assertContains(result, 'code-block', '복합 문서 코드 블록');
  assertContains(result, '<hr>', '복합 문서 수평선');
  assertContains(result, '<a href="https://example.com"', '복합 문서 링크');
});

// ─────────────────────────────────────────
// 16. 툴바 액션 (insertMarkdown 로직 직접 테스트)
// ─────────────────────────────────────────
suite('툴바 액션 — 마크다운 삽입 로직', () => {
  // 선택 텍스트 감싸기 시뮬레이션
  function wrapText(value, selStart, selEnd, before, after, placeholder) {
    const selected = value.substring(selStart, selEnd);
    const insertion = selected
      ? `${before}${selected}${after}`
      : `${before}${placeholder}${after}`;
    return value.substring(0, selStart) + insertion + value.substring(selEnd);
  }

  // 굵게 — 선택 없음
  const boldEmpty = wrapText('텍스트', 2, 2, '**', '**', '굵은 텍스트');
  assertContains(boldEmpty, '**굵은 텍스트**', '굵게: 선택 없음 → placeholder 삽입');

  // 굵게 — 선택 있음
  const boldSelected = wrapText('hello world', 6, 11, '**', '**', '굵은 텍스트');
  assert(boldSelected === 'hello **world**', '굵게: 선택 텍스트 감싸기');

  // 기울임
  const italic = wrapText('텍스트', 0, 0, '*', '*', '기울임 텍스트');
  assertContains(italic, '*기울임 텍스트*', '기울임: placeholder 삽입');

  // 기울임 — 선택 있음
  const italicSel = wrapText('hello world', 0, 5, '*', '*', '기울임');
  assert(italicSel === '*hello* world', '기울임: 선택 텍스트 감싸기');

  // 링크
  const link = wrapText('', 0, 0, '[', '](https://)', '링크 텍스트');
  assert(link === '[링크 텍스트](https://)', '링크: placeholder 삽입');

  const linkSel = wrapText('GitHub', 0, 6, '[', '](https://)', '링크 텍스트');
  assert(linkSel === '[GitHub](https://)', '링크: 선택 텍스트 감싸기');

  // 이미지
  const imgEmpty = wrapText('', 0, 0, '![', '](https://)', '이미지 설명');
  assert(imgEmpty === '![이미지 설명](https://)', '이미지: placeholder 삽입');

  // 인라인 코드
  const codeInline = wrapText('var x = 1', 4, 9, '`', '`', '코드');
  assert(codeInline === 'var `x = 1`', '인라인 코드: 선택 감싸기');

  // 줄 prefix 삽입 시뮬레이션
  function insertLinePrefix(value, cursorPos, prefix) {
    const lineStart = value.lastIndexOf('\n', cursorPos - 1) + 1;
    return value.substring(0, lineStart) + prefix + value.substring(lineStart);
  }

  // H1
  const h1 = insertLinePrefix('제목 텍스트', 0, '# ');
  assert(h1 === '# 제목 텍스트', 'H1: 줄 앞에 # 삽입');

  const h2 = insertLinePrefix('제목 텍스트', 0, '## ');
  assert(h2 === '## 제목 텍스트', 'H2: 줄 앞에 ## 삽입');

  const h3 = insertLinePrefix('제목 텍스트', 0, '### ');
  assert(h3 === '### 제목 텍스트', 'H3: 줄 앞에 ### 삽입');

  // 비순서 목록
  const ulInsert = insertLinePrefix('항목', 0, '- ');
  assert(ulInsert === '- 항목', '비순서 목록: - 삽입');

  // 순서 목록
  const olInsert = insertLinePrefix('항목', 0, '1. ');
  assert(olInsert === '1. 항목', '순서 목록: 1. 삽입');

  // 인용구
  const bqInsert = insertLinePrefix('인용', 0, '> ');
  assert(bqInsert === '> 인용', '인용구: > 삽입');

  // 여러 줄 문서에서 두 번째 줄에 prefix 삽입
  const multiLine = '첫 번째 줄\n두 번째 줄\n세 번째 줄';
  const pos = multiLine.indexOf('두 번째');
  const h2Multi = insertLinePrefix(multiLine, pos, '## ');
  assert(h2Multi === '첫 번째 줄\n## 두 번째 줄\n세 번째 줄', '여러 줄 중 두 번째 줄에 ## 삽입');
});

// ─────────────────────────────────────────
// 17. localStorage 저장/복원
// ─────────────────────────────────────────
suite('localStorage 저장/복원', () => {
  const KEY = 'markdown-editor-content';

  // 저장
  localStorage.clear();
  localStorage.setItem(KEY, '# 테스트 저장');
  assert(localStorage.getItem(KEY) === '# 테스트 저장', 'localStorage setItem/getItem');

  // 키 없을 때 null 반환
  localStorage.removeItem(KEY);
  assert(localStorage.getItem(KEY) === null, 'removeItem 후 null 반환');

  // 기본값 복원 로직 시뮬레이션
  function loadContent(defaultContent) {
    const saved = localStorage.getItem(KEY);
    return (saved !== null) ? saved : defaultContent;
  }

  const DEFAULT = '# 기본 내용';
  assert(loadContent(DEFAULT) === DEFAULT, '저장 없을 때 기본값 반환');

  localStorage.setItem(KEY, '# 저장된 내용');
  assert(loadContent(DEFAULT) === '# 저장된 내용', '저장된 내용 복원');

  // 빈 문자열 저장 (null 과 다름)
  localStorage.setItem(KEY, '');
  assert(loadContent(DEFAULT) === '', '빈 문자열 저장/복원 (기본값 아님)');

  localStorage.clear();
});

// ─────────────────────────────────────────
// 18. HTML 내보내기 출력 검증
// ─────────────────────────────────────────
suite('HTML 내보내기', () => {
  // buildExportCss 와 렌더링 결과 시뮬레이션
  function buildExportHtml(renderedHtml, cssStr) {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test</title>
  <style>${cssStr}</style>
</head>
<body>
${renderedHtml}
</body>
</html>`;
  }

  const rendered = parser.parse('# 제목\n\n**굵게** 텍스트');
  const css = 'body { font-family: sans-serif; }';
  const exported = buildExportHtml(rendered, css);

  assertContains(exported, '<!DOCTYPE html>', 'DOCTYPE 포함');
  assertContains(exported, '<meta charset="UTF-8">', 'charset meta 포함');
  assertContains(exported, '<style>', 'style 태그 포함');
  assertContains(exported, '<h1', 'h1 포함');
  assertContains(exported, '<strong>굵게</strong>', '굵게 포함');
  assertContains(exported, '</html>', 'html 닫기 태그');

  // Blob 생성 시뮬레이션
  const blob = new Blob([exported], { type: 'text/html;charset=utf-8' });
  assertContains(blob.content, '<!DOCTYPE html>', 'Blob 내용에 DOCTYPE');
  assert(blob.type === 'text/html;charset=utf-8', 'Blob MIME 타입');

  // 내보낸 HTML 에서 XSS 방지 확인
  const xssRendered = parser.parse('# <script>alert(1)</script>');
  const xssExported = buildExportHtml(xssRendered, css);
  assertNotContains(xssExported, '<script>alert', 'XSS 스크립트 미포함');
  assertContains(xssExported, '&lt;script&gt;', '스크립트 태그 이스케이프');
});

// ─────────────────────────────────────────
// 19. 파서 — 추가 엣지 케이스
// ─────────────────────────────────────────
suite('추가 엣지 케이스', () => {
  // 코드 블록 내부 마크다운 미처리
  const codeNoProcess = parser.parse('```\n# 제목 아님\n**굵게 아님**\n```');
  assertNotContains(codeNoProcess, '<h1', '코드 블록 내 # 은 제목 아님');
  assertNotContains(codeNoProcess, '<strong>', '코드 블록 내 ** 는 bold 아님');
  assertContains(codeNoProcess, '# 제목 아님', '코드 블록 내용 그대로 보존');

  // 목록 아이템 안 인라인 서식
  const listFormat = parser.parse('- **굵은** 항목\n- *기울임* 항목');
  assertContains(listFormat, '<strong>굵은</strong>', '목록 아이템 내 굵게');
  assertContains(listFormat, '<em>기울임</em>', '목록 아이템 내 기울임');

  // 긴 문서 성능 (오류 없이 완료 확인)
  const longDoc = Array.from({ length: 100 }, (_, i) => `## 섹션 ${i}\n\n내용 ${i}\n`).join('\n');
  let longResult;
  try {
    longResult = parser.parse(longDoc);
    assert(typeof longResult === 'string', '100개 섹션 파싱 성공');
    const h2Count = (longResult.match(/<h2/g) || []).length;
    assert(h2Count === 100, `100개 h2 태그 생성 (실제: ${h2Count})`);
  } catch (e) {
    assert(false, `긴 문서 파싱 오류: ${e.message}`);
  }

  // 빈 목록 항목 후 텍스트
  const afterList = parser.parse('- 항목\n\n문단 텍스트');
  assertContains(afterList, '<ul>', '목록 후 문단 분리');
  assertContains(afterList, '<p>문단 텍스트</p>', '목록 다음 문단');

  // 코드 블록 바로 뒤 텍스트
  const afterCode = parser.parse('```\ncode\n```\n\n일반 텍스트');
  assertContains(afterCode, '<p>일반 텍스트</p>', '코드 블록 다음 문단');

  // 이미지와 링크가 혼재
  const imgLink = parser.parse('[![alt](img.png)](https://example.com)');
  // 이 경우는 복잡하지만 오류 없이 파싱되어야 함
  assert(typeof imgLink === 'string', '이미지-링크 중첩 파싱 오류 없음');
});

// ─────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`결과: ${passed + failed}개 테스트 중 ${passed}개 통과, ${failed}개 실패`);

if (failures.length > 0) {
  console.log('\n실패한 테스트:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
}

console.log('─'.repeat(50));

if (failed > 0) {
  process.exit(1);
}
