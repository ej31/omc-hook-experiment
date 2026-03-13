'use strict';

const STORAGE_KEY = 'md-editor-content';
const SAVE_DEBOUNCE_MS = 400;

// 기본 샘플 마크다운
const DEFAULT_CONTENT = `# Markdown Editor에 오신 것을 환영합니다

**실시간 미리보기**가 있는 마크다운 편집기입니다. *왼쪽*에서 작성하고 *오른쪽*에서 결과를 확인하세요.

## 텍스트 강조

**굵게**, *이탤릭*, ***굵은 이탤릭*** 모두 지원합니다.

인라인 \`코드\`와 [링크](https://example.com)도 사용할 수 있습니다.

## 코드 블록

\`\`\`javascript
// 피보나치 수열
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10)); // 55
\`\`\`

## 리스트

### 비순서 목록
- 항목 하나
- 항목 둘
  - 중첩 항목 A
  - 중첩 항목 B
- 항목 셋

### 순서 목록
1. 첫 번째 단계
2. 두 번째 단계
3. 세 번째 단계

## 인용 블록

> 마크다운은 간단한 문법으로
> 서식 있는 문서를 만들 수 있습니다.
>
> > 중첩 인용도 지원합니다.

## 수평선

---

*이제 직접 편집해 보세요!*
`;

let editor, preview, resizer, editorPane, previewPane;
let saveTimer = null;
let isResizing = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartEditorWidth  = 0;
let resizeStartPreviewWidth = 0;
let resizeStartEditorHeight = 0;

// ─── 미리보기 갱신 ────────────────────────────────────────────────────────────

function updatePreview() {
  const html = MarkdownParser.parse(editor.value);
  preview.innerHTML = html;
}

// ─── localStorage 저장/복원 ───────────────────────────────────────────────────

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, editor.value);
    } catch (e) {
      // 스토리지 용량 초과 등의 오류 (QuotaExceededError)
      console.warn('자동 저장 실패:', e.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    editor.value = (saved !== null) ? saved : DEFAULT_CONTENT;
  } catch (e) {
    editor.value = DEFAULT_CONTENT;
  }
}

// ─── 커서 위치에 텍스트 삽입 ─────────────────────────────────────────────────

/**
 * 선택 영역을 before/after로 감싸거나, 선택이 없으면 placeholder를 삽입한다.
 * @param {string} before  - 앞에 삽입할 마크다운
 * @param {string} after   - 뒤에 삽입할 마크다운
 * @param {string} placeholder - 선택이 없을 때 사용할 기본 텍스트
 */
function insertInline(before, after = '', placeholder = '') {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const selected = text.substring(start, end);

  const content = selected || placeholder;
  const insertion = `${before}${content}${after}`;

  editor.value = text.substring(0, start) + insertion + text.substring(end);

  if (selected) {
    editor.selectionStart = start;
    editor.selectionEnd = start + insertion.length;
  } else {
    editor.selectionStart = start + before.length;
    editor.selectionEnd = start + before.length + placeholder.length;
  }

  commitEdit();
}

/**
 * 현재 줄의 앞에 prefix를 추가한다.
 * 이미 동일한 prefix가 있으면 제거한다(토글).
 * @param {string} prefix
 */
function insertLinePrefix(prefix) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;

  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = (() => {
    const idx = text.indexOf('\n', end);
    return idx === -1 ? text.length : idx;
  })();

  const currentLine = text.substring(lineStart, lineEnd);

  let newLine, delta;
  if (currentLine.startsWith(prefix)) {
    newLine = currentLine.substring(prefix.length);
    delta = -prefix.length;
  } else {
    newLine = prefix + currentLine;
    delta = prefix.length;
  }

  editor.value = text.substring(0, lineStart) + newLine + text.substring(lineEnd);
  editor.selectionStart = Math.max(lineStart, start + delta);
  editor.selectionEnd = Math.max(lineStart, end + delta);

  commitEdit();
}

/** 현재 줄에 제목 마크다운을 삽입한다. 기존 제목 prefix는 교체한다. */
function insertHeading(level) {
  const prefix = '#'.repeat(level) + ' ';
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;

  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = (() => {
    const idx = text.indexOf('\n', end);
    return idx === -1 ? text.length : idx;
  })();

  const currentLine = text.substring(lineStart, lineEnd);
  // 기존 제목 prefix 제거 후 새 prefix 추가
  const stripped = currentLine.replace(/^#{1,6}\s/, '');
  const newLine = prefix + stripped;

  editor.value = text.substring(0, lineStart) + newLine + text.substring(lineEnd);
  editor.selectionStart = lineStart + newLine.length;
  editor.selectionEnd = lineStart + newLine.length;

  commitEdit();
}

/** 링크 삽입: 선택 텍스트는 링크 레이블로, url 부분에 커서를 위치시킨다. */
function insertLink() {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const selected = text.substring(start, end);

  const label = selected || '링크 텍스트';
  const insertion = `[${label}](url)`;

  editor.value = text.substring(0, start) + insertion + text.substring(end);

  // 'url' 부분 선택
  const urlStart = start + label.length + 3; // "[label](" 이후
  editor.selectionStart = urlStart;
  editor.selectionEnd = urlStart + 3; // 'url' 길이 3

  commitEdit();
}

/** 이미지 삽입 */
function insertImage() {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const selected = text.substring(start, end);

  const alt = selected || '이미지 설명';
  const insertion = `![${alt}](image-url)`;

  editor.value = text.substring(0, start) + insertion + text.substring(end);

  // 'image-url' 부분 선택
  const urlStart = start + alt.length + 4; // "![alt](" 이후
  const urlPlaceholder = 'image-url';
  editor.selectionStart = urlStart;
  editor.selectionEnd = urlStart + urlPlaceholder.length;

  commitEdit();
}

/** 코드 블록 삽입: 선택된 텍스트는 블록 안으로 */
function insertCodeBlock() {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const selected = text.substring(start, end);

  // 앞에 빈 줄 확보
  const needsLeadingNewline = start > 0 && text[start - 1] !== '\n';
  const leading = needsLeadingNewline ? '\n' : '';

  const insertion = `${leading}\`\`\`\n${selected || '코드를 입력하세요'}\n\`\`\`\n`;
  editor.value = text.substring(0, start) + insertion + text.substring(end);

  if (selected) {
    editor.selectionStart = start + leading.length + 4;
    editor.selectionEnd = start + leading.length + 4 + selected.length;
  } else {
    const codeStart = start + leading.length + 4;
    editor.selectionStart = codeStart;
    editor.selectionEnd = codeStart + '코드를 입력하세요'.length;
  }

  commitEdit();
}

/** 수평선 삽입 */
function insertHR() {
  const start = editor.selectionStart;
  const text = editor.value;

  const needsLeadingNewline = start > 0 && text[start - 1] !== '\n';
  const insertion = (needsLeadingNewline ? '\n' : '') + '\n---\n\n';

  editor.value = text.substring(0, start) + insertion + text.substring(start);
  editor.selectionStart = start + insertion.length;
  editor.selectionEnd = start + insertion.length;

  commitEdit();
}

/** 편집 후 공통 처리: 미리보기 갱신 + 자동 저장 예약 */
function commitEdit() {
  editor.focus();
  updatePreview();
  scheduleAutoSave();
}

// ─── 툴바 액션 처리 ───────────────────────────────────────────────────────────

const TOOLBAR_ACTIONS = {
  bold:       () => insertInline('**', '**', '굵은 텍스트'),
  italic:     () => insertInline('*', '*', '이탤릭 텍스트'),
  h1:         () => insertHeading(1),
  h2:         () => insertHeading(2),
  h3:         () => insertHeading(3),
  link:       () => insertLink(),
  image:      () => insertImage(),
  code:       () => insertCodeBlock(),
  ul:         () => insertLinePrefix('- '),
  ol:         () => insertLinePrefix('1. '),
  blockquote: () => insertLinePrefix('> '),
  hr:         () => insertHR(),
};

function handleToolbarClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (TOOLBAR_ACTIONS[action]) {
    TOOLBAR_ACTIONS[action]();
  }
}

// ─── 키보드 단축키 ─────────────────────────────────────────────────────────────

function handleKeydown(e) {
  if (!e.ctrlKey && !e.metaKey) return;

  switch (e.key.toLowerCase()) {
    case 'b':
      e.preventDefault();
      TOOLBAR_ACTIONS.bold();
      break;
    case 'i':
      e.preventDefault();
      TOOLBAR_ACTIONS.italic();
      break;
    case 'k':
      e.preventDefault();
      TOOLBAR_ACTIONS.link();
      break;
    default:
      break;
  }
}

// ─── 드래그로 분할 패널 크기 조절 ─────────────────────────────────────────────

function initResizer() {
  const RESIZE_STEP = 20; // 키보드 한 번에 이동할 픽셀

  /** 현재 레이아웃이 세로(모바일) 방향인지 여부 */
  function isVerticalLayout() {
    return window.getComputedStyle(editorPane.parentElement).flexDirection === 'column';
  }

  /**
   * 리사이저를 delta 픽셀만큼 이동한다.
   * 세로 레이아웃이면 높이, 가로 레이아웃이면 너비를 조절한다.
   * 패널 최소 크기(200px/150px)를 보장하고, 리사이저 자체 크기를 빼서
   * 퍼센트 오차 없이 정확한 픽셀 값으로 flex-basis를 설정한다.
   */
  function applyDelta(delta) {
    if (isVerticalLayout()) {
      const containerH = editorPane.parentElement.offsetHeight;
      const resizerH   = resizer.offsetHeight;
      const available  = containerH - resizerH;
      const newH = Math.max(150, Math.min(available - 150, resizeStartEditorHeight + delta));
      editorPane.style.flex  = `0 0 ${newH}px`;
      previewPane.style.flex = `0 0 ${available - newH}px`;
    } else {
      const containerW = editorPane.parentElement.offsetWidth;
      const resizerW   = resizer.offsetWidth;
      const available  = containerW - resizerW;
      const newW = Math.max(200, Math.min(available - 200, resizeStartEditorWidth + delta));
      editorPane.style.flex  = `0 0 ${newW}px`;
      previewPane.style.flex = `0 0 ${available - newW}px`;
    }
  }

  /** 드래그 시작 공통 처리 */
  function captureStart(clientX, clientY) {
    isResizing = true;
    resizeStartX = clientX;
    resizeStartY = clientY;
    resizeStartEditorWidth  = editorPane.offsetWidth;
    resizeStartPreviewWidth = previewPane.offsetWidth;
    resizeStartEditorHeight = editorPane.offsetHeight;
    document.body.classList.add('is-resizing');
  }

  function releaseResize() {
    isResizing = false;
    document.body.classList.remove('is-resizing');
  }

  // ── 마우스: mousemove/mouseup을 mousedown 시에만 등록해 메모리 누수 방지 ──
  function onMouseMove(e) {
    const delta = isVerticalLayout()
      ? e.clientY - resizeStartY
      : e.clientX - resizeStartX;
    applyDelta(delta);
  }

  function onMouseUp() {
    releaseResize();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  }

  resizer.addEventListener('mousedown', (e) => {
    captureStart(e.clientX, e.clientY);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    e.preventDefault();
  });

  // ── 터치: 모바일/태블릿 지원, passive:false로 스크롤 차단 ──
  function onTouchMove(e) {
    const t = e.touches[0];
    const delta = isVerticalLayout()
      ? t.clientY - resizeStartY
      : t.clientX - resizeStartX;
    applyDelta(delta);
    e.preventDefault();
  }

  function onTouchEnd() {
    releaseResize();
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend',  onTouchEnd);
  }

  resizer.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    captureStart(t.clientX, t.clientY);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  onTouchEnd);
    e.preventDefault();
  }, { passive: false });

  // ── 키보드: 접근성(WAI-ARIA separator) — ArrowLeft/Right/Up/Down ──
  resizer.addEventListener('keydown', (e) => {
    const vert = isVerticalLayout();
    const prevKey = vert ? 'ArrowUp'   : 'ArrowLeft';
    const nextKey = vert ? 'ArrowDown' : 'ArrowRight';
    if (e.key !== prevKey && e.key !== nextKey) return;
    e.preventDefault();
    // 현재 크기를 기준으로 이동
    resizeStartEditorWidth  = editorPane.offsetWidth;
    resizeStartEditorHeight = editorPane.offsetHeight;
    applyDelta(e.key === prevKey ? -RESIZE_STEP : RESIZE_STEP);
  });
}

// ─── HTML 내보내기 ─────────────────────────────────────────────────────────────

function exportHtml() {
  const bodyHtml = MarkdownParser.parse(editor.value);

  // 미리보기 스타일을 포함한 완전한 HTML 문서 생성
  const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>내보낸 마크다운</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.7;
      color: #24292f;
      background: #ffffff;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 24px;
    }
    h1, h2, h3, h4, h5, h6 {
      font-weight: 600;
      line-height: 1.3;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    p { margin-bottom: 1em; }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    strong { font-weight: 600; }
    em { font-style: italic; }
    code {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 0.875em;
      background: #f6f8fa;
      padding: 0.2em 0.4em;
      border-radius: 4px;
      color: #e03e2f;
    }
    pre {
      background: #f6f8fa;
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      margin-bottom: 1em;
      position: relative;
    }
    pre code {
      background: none;
      padding: 0;
      font-size: 0.875em;
      color: #24292f;
    }
    .code-lang-label {
      font-family: monospace;
      font-size: 0.75em;
      color: #57606a;
      margin-bottom: 8px;
    }
    blockquote {
      border-left: 4px solid #d0d7de;
      padding: 0 1em;
      color: #57606a;
      margin: 0 0 1em;
    }
    ul, ol { padding-left: 2em; margin-bottom: 1em; }
    li { margin-bottom: 0.25em; }
    hr { border: none; border-top: 1px solid #d0d7de; margin: 2em 0; }
    img { max-width: 100%; height: auto; border-radius: 4px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
    th, td { border: 1px solid #d0d7de; padding: 8px 12px; }
    th { background: #f6f8fa; font-weight: 600; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'document.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── 초기화 ───────────────────────────────────────────────────────────────────

function init() {
  editor = document.getElementById('editor');
  preview = document.getElementById('preview');
  resizer = document.getElementById('resizer');
  editorPane = document.getElementById('editor-pane');
  previewPane = document.getElementById('preview-pane');

  loadFromStorage();
  updatePreview();

  // 입력 이벤트: 미리보기 갱신 + 자동 저장
  editor.addEventListener('input', () => {
    updatePreview();
    scheduleAutoSave();
  });

  // 툴바 클릭
  document.getElementById('toolbar').addEventListener('click', handleToolbarClick);

  // 키보드 단축키
  editor.addEventListener('keydown', handleKeydown);

  // 드래그 리사이저
  initResizer();

  // 내보내기 버튼
  document.getElementById('export-btn').addEventListener('click', exportHtml);
}

document.addEventListener('DOMContentLoaded', init);
