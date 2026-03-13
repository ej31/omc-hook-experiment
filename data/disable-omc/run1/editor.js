'use strict';

const STORAGE_KEY = 'markdown-editor-content';

const DEFAULT_CONTENT = `# Markdown 에디터에 오신 것을 환영합니다

**빠르고** _아름다운_ 마크다운 에디터. 라이브 미리보기를 지원합니다.

## 주요 기능

- **실시간 미리보기** — 타이핑하는 즉시 결과를 확인
- **코드 블록 하이라이팅** — 언어 레이블 표시
- **HTML 내보내기** — 렌더링된 결과를 파일로 저장
- **키보드 단축키** — Ctrl+B, Ctrl+I, Ctrl+K

---

## 텍스트 서식

**굵은 텍스트**, *기울임 텍스트*, ***굵은 기울임***, ~~취소선~~

인라인 \`코드\`는 이렇게 표시됩니다.

---

## 코드 블록

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));
\`\`\`

\`\`\`python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(10))
\`\`\`

---

## 링크와 이미지

[GitHub 방문하기](https://github.com)

![샘플 이미지](https://via.placeholder.com/400x200/0d1117/58a6ff?text=Markdown+Editor)

---

## 목록

### 비순서 목록

- 항목 1
- 항목 2
  - 중첩 항목 2-1
  - 중첩 항목 2-2
    - 깊은 중첩 항목
- 항목 3

### 순서 목록

1. 첫 번째 단계
2. 두 번째 단계
3. 세 번째 단계
   1. 하위 단계 A
   2. 하위 단계 B

---

## 인용구

> 이것은 인용구입니다.
>
> > 중첩된 인용구도 지원합니다.
>
> **굵은 텍스트**와 \`코드\`도 인용구 안에서 동작합니다.

---

> **팁:** **Ctrl+B** 굵게, **Ctrl+I** 기울임, **Ctrl+K** 링크 삽입.
`;

// ─────────────────────────────────────────
// 상태
// ─────────────────────────────────────────
const parser = new MarkdownParser();
let updateTimer = null;

// ─────────────────────────────────────────
// DOM 요소
// ─────────────────────────────────────────
const editorEl = document.getElementById('editor');
const previewEl = document.getElementById('preview');
const resizerEl = document.getElementById('resizer');
const editorPaneEl = document.getElementById('editorPane');
const previewPaneEl = document.getElementById('previewPane');
const exportBtn = document.getElementById('exportBtn');
const containerEl = document.querySelector('.editor-container');

// ─────────────────────────────────────────
// 미리보기 업데이트
// ─────────────────────────────────────────
function updatePreview() {
  const markdown = editorEl.value;
  previewEl.innerHTML = parser.parse(markdown);
  saveToStorage();
}

function scheduleUpdate() {
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(updatePreview, 50);
}

// ─────────────────────────────────────────
// localStorage 자동 저장/복원
// ─────────────────────────────────────────
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, editorEl.value);
  } catch (e) {
    // 저장 실패 무시 (용량 초과 등)
  }
}

function loadFromStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    editorEl.value = (saved !== null) ? saved : DEFAULT_CONTENT;
  } catch (e) {
    editorEl.value = DEFAULT_CONTENT;
  }
  updatePreview();
}

// ─────────────────────────────────────────
// 커서 위치에 마크다운 삽입
// ─────────────────────────────────────────
function insertMarkdown(before, after, placeholder) {
  const start = editorEl.selectionStart;
  const end = editorEl.selectionEnd;
  const selected = editorEl.value.substring(start, end);
  const insertion = selected
    ? `${before}${selected}${after}`
    : `${before}${placeholder}${after}`;

  // execCommand 대신 직접 value 수정 후 selectionRange 복원
  const prev = editorEl.value;
  editorEl.value = prev.substring(0, start) + insertion + prev.substring(end);

  if (selected) {
    editorEl.selectionStart = start;
    editorEl.selectionEnd = start + insertion.length;
  } else {
    // placeholder 텍스트 선택
    editorEl.selectionStart = start + before.length;
    editorEl.selectionEnd = start + before.length + placeholder.length;
  }

  editorEl.focus();
  updatePreview();
}

function insertLinePrefix(prefix) {
  const start = editorEl.selectionStart;
  const lineStart = editorEl.value.lastIndexOf('\n', start - 1) + 1;
  const prev = editorEl.value;
  editorEl.value = prev.substring(0, lineStart) + prefix + prev.substring(lineStart);
  editorEl.selectionStart = start + prefix.length;
  editorEl.selectionEnd = start + prefix.length;
  editorEl.focus();
  updatePreview();
}

function insertBlock(text) {
  const start = editorEl.selectionStart;
  const prev = editorEl.value;
  // 줄 시작 위치 계산
  const lineStart = prev.lastIndexOf('\n', start - 1) + 1;
  // 현재 줄이 비어있으면 바로 삽입, 아니면 앞에 개행 추가
  const needLeadingNewline = lineStart !== start;
  const insertion = (needLeadingNewline ? '\n' : '') + text + '\n';
  editorEl.value = prev.substring(0, start) + insertion + prev.substring(start);
  const cursorPos = start + insertion.length;
  editorEl.selectionStart = cursorPos;
  editorEl.selectionEnd = cursorPos;
  editorEl.focus();
  updatePreview();
}

// ─────────────────────────────────────────
// 툴바 액션 정의
// ─────────────────────────────────────────
const TOOLBAR_ACTIONS = {
  h1: () => insertLinePrefix('# '),
  h2: () => insertLinePrefix('## '),
  h3: () => insertLinePrefix('### '),
  bold: () => insertMarkdown('**', '**', '굵은 텍스트'),
  italic: () => insertMarkdown('*', '*', '기울임 텍스트'),
  link: () => {
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const selected = editorEl.value.substring(start, end);
    if (selected) {
      insertMarkdown('[', '](https://)', selected);
    } else {
      insertMarkdown('[', '](https://)', '링크 텍스트');
    }
  },
  image: () => insertMarkdown('![', '](https://)', '이미지 설명'),
  code: () => {
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const selected = editorEl.value.substring(start, end);
    if (selected && selected.includes('\n')) {
      insertMarkdown('```\n', '\n```', selected);
    } else if (selected) {
      insertMarkdown('`', '`', selected);
    } else {
      insertBlock('```javascript\n코드를 여기에 입력\n```');
    }
  },
  ul: () => insertLinePrefix('- '),
  ol: () => insertLinePrefix('1. '),
  blockquote: () => insertLinePrefix('> '),
  hr: () => insertBlock('\n---'),
};

// ─────────────────────────────────────────
// 툴바 버튼 이벤트
// ─────────────────────────────────────────
document.querySelectorAll('.toolbar-btn[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (TOOLBAR_ACTIONS[action]) {
      TOOLBAR_ACTIONS[action]();
    }
  });
});

// ─────────────────────────────────────────
// 키보드 단축키
// ─────────────────────────────────────────
editorEl.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
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
    }
  }

  // Tab 키: 들여쓰기 삽입
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const prev = editorEl.value;
    editorEl.value = prev.substring(0, start) + '  ' + prev.substring(end);
    editorEl.selectionStart = start + 2;
    editorEl.selectionEnd = start + 2;
    scheduleUpdate();
  }
});

// ─────────────────────────────────────────
// 실시간 미리보기
// ─────────────────────────────────────────
editorEl.addEventListener('input', scheduleUpdate);

// ─────────────────────────────────────────
// 분할 창 드래그 리사이저
// ─────────────────────────────────────────
let isResizing = false;
let resizeStartX = 0;
let resizeStartEditorWidth = 0;

resizerEl.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizeStartX = e.clientX;
  resizeStartEditorWidth = editorPaneEl.getBoundingClientRect().width;
  document.body.classList.add('is-resizing');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const delta = e.clientX - resizeStartX;
  const containerWidth = containerEl.getBoundingClientRect().width;
  const resizerWidth = resizerEl.getBoundingClientRect().width;
  const availableWidth = containerWidth - resizerWidth;
  const minWidth = 200;
  const maxWidth = availableWidth - minWidth;
  const newEditorWidth = Math.min(Math.max(resizeStartEditorWidth + delta, minWidth), maxWidth);
  const editorPercent = (newEditorWidth / availableWidth) * 100;
  editorPaneEl.style.flex = `0 0 ${editorPercent}%`;
  previewPaneEl.style.flex = '1 1 0';
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.classList.remove('is-resizing');
  }
});

// 터치 지원
resizerEl.addEventListener('touchstart', (e) => {
  isResizing = true;
  resizeStartX = e.touches[0].clientX;
  resizeStartEditorWidth = editorPaneEl.getBoundingClientRect().width;
  document.body.classList.add('is-resizing');
  e.preventDefault();
}, { passive: false });

document.addEventListener('touchmove', (e) => {
  if (!isResizing) return;
  const delta = e.touches[0].clientX - resizeStartX;
  const containerWidth = containerEl.getBoundingClientRect().width;
  const resizerWidth = resizerEl.getBoundingClientRect().width;
  const availableWidth = containerWidth - resizerWidth;
  const minWidth = 200;
  const maxWidth = availableWidth - minWidth;
  const newEditorWidth = Math.min(Math.max(resizeStartEditorWidth + delta, minWidth), maxWidth);
  const editorPercent = (newEditorWidth / availableWidth) * 100;
  editorPaneEl.style.flex = `0 0 ${editorPercent}%`;
  previewPaneEl.style.flex = '1 1 0';
}, { passive: false });

document.addEventListener('touchend', () => {
  if (isResizing) {
    isResizing = false;
    document.body.classList.remove('is-resizing');
  }
});

// ─────────────────────────────────────────
// HTML 내보내기
// ─────────────────────────────────────────
function buildExportCss() {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 16px; line-height: 1.7; color: #24292f;
      max-width: 860px; margin: 0 auto; padding: 40px 24px;
      background: #ffffff;
    }
    h1, h2, h3, h4, h5, h6 {
      margin: 1.5em 0 0.5em; font-weight: 600; line-height: 1.25;
      border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em;
      color: #1f2328;
    }
    h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
    h4, h5, h6 { border-bottom: none; font-size: 1em; }
    p { margin: 0 0 1em; }
    a { color: #0969da; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.875em; padding: 0.2em 0.4em;
      background: rgba(175,184,193,0.2); border-radius: 6px;
    }
    pre { margin: 0 0 1em; border-radius: 8px; overflow: auto; }
    .code-block {
      position: relative; margin: 0 0 1em; border-radius: 8px;
      background: #f6f8fa; border: 1px solid #d0d7de; overflow: hidden;
    }
    .code-block[data-language]::before {
      content: attr(data-language); display: block;
      padding: 6px 16px 4px; font-size: 0.75em; font-weight: 600;
      color: #57606a; background: #f6f8fa;
      border-bottom: 1px solid #d0d7de; text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .code-block pre { margin: 0; padding: 16px; background: transparent; }
    .code-block code {
      font-size: 0.875em; background: transparent; padding: 0;
      color: #24292f; white-space: pre;
    }
    blockquote {
      margin: 0 0 1em; padding: 0 1em;
      border-left: 4px solid #d0d7de; color: #57606a;
    }
    ul, ol { margin: 0 0 1em 1.5em; }
    li { margin-bottom: 0.25em; }
    hr { margin: 2em 0; border: none; border-top: 2px solid #d0d7de; }
    strong { font-weight: 600; } em { font-style: italic; }
    del { text-decoration: line-through; color: #57606a; }
  `;
}

exportBtn.addEventListener('click', () => {
  const rendered = previewEl.innerHTML;
  const title = document.title || 'Exported Markdown';
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${buildExportCss()}</style>
</head>
<body>
${rendered}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'exported.html';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
});

// ─────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────
loadFromStorage();
