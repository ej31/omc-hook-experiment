/**
 * 에디터 로직
 * - 실시간 미리보기 업데이트
 * - 툴바 버튼 동작 (커서 위치에 마크다운 삽입, 선택 텍스트 래핑)
 * - 드래그로 분할 창 크기 조절
 * - 키보드 단축키 (Ctrl+B, Ctrl+I, Ctrl+K)
 * - localStorage 자동 저장/복원
 * - HTML 내보내기
 */

const Editor = (() => {
  const STORAGE_KEY = 'md-editor-content';
  const DEFAULT_CONTENT = `# 마크다운 에디터에 오신 것을 환영합니다

이 에디터는 **실시간 미리보기**를 지원합니다.

## 주요 기능

- **굵게**: \`**텍스트**\`
- *기울임*: \`*텍스트*\`
- \`인라인 코드\`
- [링크](https://example.com)

## 코드 블록

\`\`\`javascript
function hello(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## 목록

1. 첫 번째 항목
2. 두 번째 항목
   - 중첩 항목 A
   - 중첩 항목 B
3. 세 번째 항목

> **참고:** 툴바 버튼이나 단축키를 사용해보세요.
>
> - Ctrl+B: 굵게
> - Ctrl+I: 기울임
> - Ctrl+K: 링크

---

즐거운 마크다운 작성 되세요!
`;

  let textarea;
  let preview;
  let resizer;
  let editorPane;
  let previewPane;
  let updateTimer = null;
  let isResizing = false;

  // 미리보기 업데이트 (디바운스 적용)
  function updatePreview() {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      const markdown = textarea.value;
      try {
        preview.innerHTML = MarkdownParser.parse(markdown);
      } catch (e) {
        preview.innerHTML = `<p style="color: #f87171;">파싱 오류: ${e.message}</p>`;
      }
      saveToStorage();
    }, 50);
  }

  // localStorage에 저장
  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, textarea.value);
    } catch (e) {
      // 저장 실패 시 무시 (private 모드 등)
    }
  }

  // localStorage에서 복원
  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved !== null ? saved : DEFAULT_CONTENT;
    } catch (e) {
      return DEFAULT_CONTENT;
    }
  }

  // 커서 위치에 텍스트 삽입 또는 선택 영역 래핑
  function insertAtCursor(before, after = '', defaultText = '') {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);
    const text = selected || defaultText;

    const newText = before + text + after;
    const newValue = textarea.value.substring(0, start) + newText + textarea.value.substring(end);

    textarea.value = newValue;

    // 커서 위치: 삽입된 내용(defaultText 또는 선택 텍스트) 부분을 선택 상태로 둠
    textarea.setSelectionRange(
      start + before.length,
      start + before.length + text.length
    );

    textarea.focus();
    updatePreview();
  }

  // 줄 시작에 접두사 삽입 (헤딩, 목록, 인용문 등)
  function insertLinePrefix(prefix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;

    // 선택된 줄들의 시작 위치 찾기
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;

    // 선택 범위 내 모든 줄에 접두사 추가
    const selectedText = value.substring(lineStart, end);
    const lines = selectedText.split('\n');
    const newLines = lines.map(line => {
      // 이미 같은 접두사가 있으면 제거, 없으면 추가
      if (line.startsWith(prefix)) {
        return line.substring(prefix.length);
      }
      return prefix + line;
    });
    const newSelected = newLines.join('\n');

    textarea.value = value.substring(0, lineStart) + newSelected + value.substring(end);
    textarea.setSelectionRange(lineStart, lineStart + newSelected.length);
    textarea.focus();
    updatePreview();
  }

  // 줄 삽입 (현재 줄 다음)
  function insertLine(text) {
    const start = textarea.selectionStart;
    const value = textarea.value;
    const lineEnd = value.indexOf('\n', start);
    const insertPos = lineEnd === -1 ? value.length : lineEnd;

    const newValue = value.substring(0, insertPos) + '\n' + text + value.substring(insertPos);
    textarea.value = newValue;
    const newCursor = insertPos + 1 + text.length;
    textarea.setSelectionRange(newCursor, newCursor);
    textarea.focus();
    updatePreview();
  }

  // 툴바 버튼 동작 정의
  const TOOLBAR_ACTIONS = {
    bold: () => insertAtCursor('**', '**', '굵은 텍스트'),
    italic: () => insertAtCursor('*', '*', '기울임 텍스트'),
    h1: () => insertLinePrefix('# '),
    h2: () => insertLinePrefix('## '),
    h3: () => insertLinePrefix('### '),
    link: () => {
      const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      if (selected) {
        insertAtCursor('[', '](https://)', '');
        // 커서를 URL 위치로 이동: selectionEnd는 ']' 위치 → '(' 은 +1, 'https://' 는 +2~+9
        const pos = textarea.selectionEnd;
        textarea.setSelectionRange(pos + 2, pos + 10);
      } else {
        insertAtCursor('[링크 텍스트](', ')', 'https://');
      }
    },
    image: () => insertAtCursor('![', '](https://)', '이미지 설명'),
    code: () => {
      const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      if (selected && selected.includes('\n')) {
        insertAtCursor('```\n', '\n```', '');
      } else {
        insertAtCursor('`', '`', '코드');
      }
    },
    codeblock: () => {
      const start = textarea.selectionStart;
      const value = textarea.value;
      const lineEnd = value.indexOf('\n', start);
      const insertPos = lineEnd === -1 ? value.length : lineEnd;

      const block = '\n```javascript\n코드를 입력하세요\n```';
      const newValue = value.substring(0, insertPos) + block + value.substring(insertPos);
      textarea.value = newValue;

      const codeStart = insertPos + block.indexOf('코드를 입력하세요');
      textarea.setSelectionRange(codeStart, codeStart + '코드를 입력하세요'.length);
      textarea.focus();
      updatePreview();
    },
    ul: () => insertLinePrefix('- '),
    ol: () => {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const selectedText = value.substring(lineStart, end);
      const lines = selectedText.split('\n');
      const newLines = lines.map((line, idx) => {
        const existingMatch = line.match(/^\d+\.\s/);
        if (existingMatch) return line.substring(existingMatch[0].length);
        return `${idx + 1}. ${line}`;
      });
      const newSelected = newLines.join('\n');
      textarea.value = value.substring(0, lineStart) + newSelected + value.substring(end);
      textarea.setSelectionRange(lineStart, lineStart + newSelected.length);
      textarea.focus();
      updatePreview();
    },
    blockquote: () => insertLinePrefix('> '),
    hr: () => insertLine('\n---\n'),
  };

  // 드래그 크기 조절 초기화
  function initResizer() {
    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const container = document.querySelector('.editor-container');
      const containerRect = container.getBoundingClientRect();
      const resizerWidth = resizer.offsetWidth;

      let leftWidth = e.clientX - containerRect.left - resizerWidth / 2;
      const minWidth = 150;
      const maxWidth = containerRect.width - resizerWidth - minWidth;

      leftWidth = Math.max(minWidth, Math.min(maxWidth, leftWidth));
      const leftPercent = (leftWidth / containerRect.width) * 100;
      const rightPercent = 100 - leftPercent - (resizerWidth / containerRect.width) * 100;

      editorPane.style.flex = 'none';
      editorPane.style.width = `${leftPercent}%`;
      previewPane.style.flex = 'none';
      previewPane.style.width = `${rightPercent}%`;
    });

    // mouseup: 정상 해제
    document.addEventListener('mouseup', stopResize);
    // pointercancel: 브라우저 밖에서 버튼 해제 또는 OS 인터럽트 시 stuck 방지
    document.addEventListener('pointercancel', stopResize);

    // 키보드 접근성: 포커스 상태에서 ←/→ 화살표로 크기 조절
    resizer.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();

      const container = document.querySelector('.editor-container');
      const containerRect = container.getBoundingClientRect();
      const resizerWidth = resizer.offsetWidth;
      const step = e.shiftKey ? 50 : 10;
      const direction = e.key === 'ArrowLeft' ? -1 : 1;

      const currentLeft = editorPane.offsetWidth;
      const newLeft = Math.max(150, Math.min(
        containerRect.width - resizerWidth - 150,
        currentLeft + direction * step
      ));
      const leftPercent = (newLeft / containerRect.width) * 100;
      const rightPercent = 100 - leftPercent - (resizerWidth / containerRect.width) * 100;

      editorPane.style.flex = 'none';
      editorPane.style.width = `${leftPercent}%`;
      previewPane.style.flex = 'none';
      previewPane.style.width = `${rightPercent}%`;
    });
  }

  function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  // HTML 내보내기
  function exportHtml() {
    const title = '마크다운 문서';
    const previewContent = preview.innerHTML;
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #24292e;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5rem;
      margin-bottom: 0.5rem;
      font-weight: 600;
    }
    h1 { font-size: 2rem; border-bottom: 1px solid #eaecef; padding-bottom: 0.3rem; }
    h2 { font-size: 1.5rem; border-bottom: 1px solid #eaecef; padding-bottom: 0.3rem; }
    code {
      background: #f6f8fa;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-size: 85%;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }
    pre {
      background: #f6f8fa;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code { background: none; padding: 0; }
    blockquote {
      border-left: 4px solid #dfe2e5;
      margin: 0;
      padding: 0 1rem;
      color: #6a737d;
    }
    img { max-width: 100%; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #dfe2e5; padding: 0.5rem 1rem; }
    a { color: #0366d6; }
    hr { border: none; border-top: 1px solid #eaecef; }
  </style>
</head>
<body>
${previewContent}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 키보드 단축키 처리
  function handleKeydown(e) {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrl = isMac ? e.metaKey : e.ctrlKey;

    if (!ctrl) return;

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

  // 탭 키 처리 (들여쓰기)
  function handleTab(e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;

    if (e.shiftKey) {
      // 역 들여쓰기
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      if (value.substring(lineStart, lineStart + 2) === '  ') {
        textarea.value = value.substring(0, lineStart) + value.substring(lineStart + 2);
        textarea.setSelectionRange(Math.max(lineStart, start - 2), Math.max(lineStart, end - 2));
      }
    } else {
      // 들여쓰기
      textarea.value = value.substring(0, start) + '  ' + value.substring(end);
      textarea.setSelectionRange(start + 2, start + 2);
    }
    updatePreview();
  }

  // 초기화
  function init() {
    textarea = document.getElementById('editor-textarea');
    preview = document.getElementById('preview-content');
    resizer = document.getElementById('resizer');
    editorPane = document.getElementById('editor-pane');
    previewPane = document.getElementById('preview-pane');

    if (!textarea || !preview || !resizer) {
      console.error('필수 DOM 요소를 찾을 수 없습니다.');
      return;
    }

    // 저장된 내용 복원
    textarea.value = loadFromStorage();

    // 실시간 미리보기 업데이트
    textarea.addEventListener('input', updatePreview);
    textarea.addEventListener('keydown', handleKeydown);
    textarea.addEventListener('keydown', handleTab);

    // 툴바 버튼 연결
    document.querySelectorAll('[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      if (TOOLBAR_ACTIONS[action]) {
        btn.addEventListener('click', () => TOOLBAR_ACTIONS[action]());
      }
    });

    // 내보내기 버튼
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportHtml);
    }

    // 드래그 크기 조절 초기화
    initResizer();

    // 초기 미리보기 렌더링
    updatePreview();
  }

  return { init };
})();

// DOM 로드 완료 후 초기화
document.addEventListener('DOMContentLoaded', () => Editor.init());
