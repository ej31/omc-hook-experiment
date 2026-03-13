/**
 * editor.js
 * 마크다운 에디터 로직
 *
 * 기능:
 * - 실시간 미리보기 업데이트
 * - 툴바 버튼 액션 (선택 영역 래핑 포함)
 * - 드래그로 패널 크기 조절
 * - 키보드 단축키 (Ctrl+B, Ctrl+I, Ctrl+K)
 * - localStorage 자동 저장/복원
 * - HTML 내보내기
 */

(() => {
  // ============================
  // 상수
  // ============================
  const STORAGE_KEY = 'markdown-editor-content';
  const AUTO_SAVE_DELAY_MS = 1000;
  const SAVE_INDICATOR_DURATION_MS = 2000;

  const DEFAULT_CONTENT = `# 마크다운 에디터에 오신 것을 환영합니다

이 에디터는 **실시간 미리보기**를 지원하는 마크다운 편집기입니다.

## 기능 소개

### 텍스트 스타일

- **굵게** 텍스트
- *기울임* 텍스트
- ***굵은 기울임*** 텍스트
- \`인라인 코드\`
- ~~취소선~~ 텍스트

### 코드 블록

\`\`\`javascript
function greet(name) {
  console.log(\`안녕하세요, \${name}!\`);
}

greet('세상');
\`\`\`

### 목록

순서 없는 목록:
- 항목 1
- 항목 2
  - 중첩 항목 2.1
  - 중첩 항목 2.2
- 항목 3

순서 있는 목록:
1. 첫 번째
2. 두 번째
3. 세 번째

### 인용구

> 마크다운은 텍스트를 HTML로 변환하는 간단한 마크업 언어입니다.
>
> — John Gruber

### 링크와 이미지

[GitHub](https://github.com) - 코드 저장소

### 수평선

---

### 단축키

| 단축키 | 기능 |
| --- | --- |
| Ctrl+B | 굵게 |
| Ctrl+I | 기울임 |
| Ctrl+K | 링크 |
`;

  // ============================
  // DOM 요소
  // ============================
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const resizer = document.getElementById('resizer');
  const editorPane = document.getElementById('editor-pane');
  const previewPane = document.getElementById('preview-pane');
  const exportBtn = document.getElementById('export-btn');
  const autoSaveIndicator = document.getElementById('auto-save-indicator');
  const editorContainer = document.querySelector('.editor-container');

  // ============================
  // 미리보기 업데이트
  // ============================
  function updatePreview() {
    const markdown = editor.value;

    if (!markdown.trim()) {
      preview.innerHTML = `
        <div class="preview-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <p>왼쪽에 마크다운을 입력하면 미리보기가 표시됩니다.</p>
        </div>
      `;
      return;
    }

    preview.innerHTML = MarkdownParser.parse(markdown);
  }

  // ============================
  // 자동 저장
  // ============================
  let autoSaveTimer = null;
  let saveIndicatorTimer = null;

  function scheduleAutoSave() {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
    }
    autoSaveTimer = setTimeout(() => {
      saveToLocalStorage();
    }, AUTO_SAVE_DELAY_MS);
  }

  function saveToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, editor.value);
      showSaveIndicator();
    } catch (err) {
      console.warn('자동 저장 실패:', err);
    }
  }

  function showSaveIndicator() {
    if (saveIndicatorTimer) {
      clearTimeout(saveIndicatorTimer);
    }
    autoSaveIndicator.classList.add('visible');
    saveIndicatorTimer = setTimeout(() => {
      autoSaveIndicator.classList.remove('visible');
    }, SAVE_INDICATOR_DURATION_MS);
  }

  function restoreFromLocalStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        editor.value = saved;
      } else {
        editor.value = DEFAULT_CONTENT;
      }
    } catch (err) {
      console.warn('저장된 내용 복원 실패:', err);
      editor.value = DEFAULT_CONTENT;
    }
  }

  // ============================
  // 커서 위치에 마크다운 삽입
  // ============================

  /**
   * 선택 영역을 래핑하거나 플레이스홀더를 삽입한다.
   * @param {string} prefix - 시작 문자열
   * @param {string} suffix - 끝 문자열
   * @param {string} placeholder - 선택 없을 때 삽입할 기본 텍스트
   */
  function wrapSelection(prefix, suffix, placeholder = '') {
    editor.focus();

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selectedText = editor.value.substring(start, end);
    const insertText = selectedText || placeholder;

    const before = editor.value.substring(0, start);
    const after = editor.value.substring(end);

    editor.value = before + prefix + insertText + suffix + after;

    // 커서 위치 조정
    const newStart = start + prefix.length;
    const newEnd = newStart + insertText.length;
    editor.setSelectionRange(newStart, newEnd);

    updatePreview();
    scheduleAutoSave();
  }

  /**
   * 현재 줄의 시작에 접두사를 삽입한다.
   * @param {string} prefix - 삽입할 접두사
   * @param {string} placeholder - 선택 없을 때 삽입할 기본 텍스트
   */
  function insertLinePrefix(prefix, placeholder = '텍스트') {
    editor.focus();

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;

    // 현재 선택 영역의 줄 시작 위치 찾기
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;

    const selectedText = value.substring(start, end) || placeholder;
    const before = value.substring(0, lineStart);
    const after = value.substring(end);
    const lineContent = value.substring(lineStart, start);

    editor.value = before + prefix + lineContent + selectedText + after;

    const newStart = lineStart + prefix.length + lineContent.length;
    const newEnd = newStart + selectedText.length;
    editor.setSelectionRange(newStart, newEnd);

    updatePreview();
    scheduleAutoSave();
  }

  /**
   * 현재 줄 앞에 블록 요소를 삽입한다.
   * @param {string} blockPrefix - 줄 앞에 삽입할 텍스트
   * @param {string} placeholder - 기본 내용
   */
  function insertBlock(blockPrefix, placeholder) {
    editor.focus();

    const start = editor.selectionStart;
    const value = editor.value;

    // 현재 줄의 시작과 끝 찾기
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', start);
    const actualEnd = lineEnd === -1 ? value.length : lineEnd;

    const currentLineContent = value.substring(lineStart, actualEnd).trim();
    const insertContent = currentLineContent || placeholder;

    // 줄 앞이나 뒤에 개행 추가
    const needsBefore = lineStart > 0 && value[lineStart - 1] !== '\n';
    const needsAfter = actualEnd < value.length;

    const before = value.substring(0, lineStart);
    const after = value.substring(actualEnd);

    const newContent =
      (needsBefore ? '\n' : '') +
      blockPrefix + insertContent +
      (needsAfter ? '\n' : '');

    editor.value = before + newContent + after;

    const prefixOffset = needsBefore ? 1 : 0;
    const newStart = lineStart + prefixOffset + blockPrefix.length;
    const newEnd = newStart + insertContent.length;
    editor.setSelectionRange(newStart, newEnd);

    updatePreview();
    scheduleAutoSave();
  }

  // ============================
  // 툴바 액션 정의
  // ============================
  const toolbarActions = {
    bold() {
      wrapSelection('**', '**', '굵은 텍스트');
    },

    italic() {
      wrapSelection('*', '*', '기울임 텍스트');
    },

    'bold-italic'() {
      wrapSelection('***', '***', '굵은 기울임 텍스트');
    },

    h1() {
      insertBlock('# ', '제목 1');
    },

    h2() {
      insertBlock('## ', '제목 2');
    },

    h3() {
      insertBlock('### ', '제목 3');
    },

    link() {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selectedText = editor.value.substring(start, end);

      if (selectedText) {
        wrapSelection('[', '](https://)', '');
        // 커서를 URL 위치로 이동
        const newPos = start + 1 + selectedText.length + 2;
        editor.setSelectionRange(newPos, newPos + 8);
      } else {
        wrapSelection('[링크 텍스트](', ')', 'https://');
        // "링크 텍스트"는 6자 — off-by-one 수정
        const newStart = start + 1;
        editor.setSelectionRange(newStart, newStart + 6);
      }
    },

    image() {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selectedText = editor.value.substring(start, end);

      if (selectedText) {
        wrapSelection('![', '](https://)', '');
        const newPos = start + 2 + selectedText.length + 2;
        editor.setSelectionRange(newPos, newPos + 8);
      } else {
        insertAtCursor('![이미지 설명](이미지 URL)');
        // "이미지 설명"은 6자 — off-by-one 수정
        const newStart = start + 2;
        editor.setSelectionRange(newStart, newStart + 6);
      }
    },

    code() {
      wrapSelection('`', '`', '코드');
    },

    codeblock() {
      editor.focus();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selectedText = editor.value.substring(start, end);
      const placeholder = selectedText || '// 코드를 입력하세요';

      const before = editor.value.substring(0, start);
      const after = editor.value.substring(end);

      const needsBefore = before.length > 0 && !before.endsWith('\n\n');
      const prefix = needsBefore ? '\n\n' : '';
      const suffix = '\n\n';

      const block = `${prefix}\`\`\`\n${placeholder}\n\`\`\`${suffix}`;
      editor.value = before + block + after;

      const codeStart = start + prefix.length + 4;
      const codeEnd = codeStart + placeholder.length;
      editor.setSelectionRange(codeStart, codeEnd);

      updatePreview();
      scheduleAutoSave();
    },

    ul() {
      editor.focus();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;

      if (start === end) {
        // 선택 없음: 현재 줄에 목록 접두사 추가
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', start);
        const actualEnd = lineEnd === -1 ? value.length : lineEnd;
        const currentLine = value.substring(lineStart, actualEnd);
        const content = currentLine.trim() || '목록 항목';

        editor.value =
          value.substring(0, lineStart) +
          '- ' + content +
          value.substring(actualEnd);

        const newStart = lineStart + 2;
        const newEnd = newStart + content.length;
        editor.setSelectionRange(newStart, newEnd);
      } else {
        // 선택 영역의 각 줄에 목록 접두사 추가
        const selectedText = value.substring(start, end);
        const lines = selectedText.split('\n');
        const newText = lines.map(line => '- ' + line).join('\n');

        editor.value = value.substring(0, start) + newText + value.substring(end);
        editor.setSelectionRange(start, start + newText.length);
      }

      updatePreview();
      scheduleAutoSave();
    },

    ol() {
      editor.focus();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;

      if (start === end) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', start);
        const actualEnd = lineEnd === -1 ? value.length : lineEnd;
        const currentLine = value.substring(lineStart, actualEnd);
        const content = currentLine.trim() || '목록 항목';

        editor.value =
          value.substring(0, lineStart) +
          '1. ' + content +
          value.substring(actualEnd);

        const newStart = lineStart + 3;
        const newEnd = newStart + content.length;
        editor.setSelectionRange(newStart, newEnd);
      } else {
        const selectedText = value.substring(start, end);
        const lines = selectedText.split('\n');
        const newText = lines.map((line, idx) => `${idx + 1}. ${line}`).join('\n');

        editor.value = value.substring(0, start) + newText + value.substring(end);
        editor.setSelectionRange(start, start + newText.length);
      }

      updatePreview();
      scheduleAutoSave();
    },

    blockquote() {
      editor.focus();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;

      if (start === end) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', start);
        const actualEnd = lineEnd === -1 ? value.length : lineEnd;
        const currentLine = value.substring(lineStart, actualEnd);
        const content = currentLine.trim() || '인용 텍스트';

        editor.value =
          value.substring(0, lineStart) +
          '> ' + content +
          value.substring(actualEnd);

        const newStart = lineStart + 2;
        const newEnd = newStart + content.length;
        editor.setSelectionRange(newStart, newEnd);
      } else {
        const selectedText = value.substring(start, end);
        const lines = selectedText.split('\n');
        const newText = lines.map(line => '> ' + line).join('\n');

        editor.value = value.substring(0, start) + newText + value.substring(end);
        editor.setSelectionRange(start, start + newText.length);
      }

      updatePreview();
      scheduleAutoSave();
    },

    hr() {
      editor.focus();
      const start = editor.selectionStart;
      const value = editor.value;

      // 현재 줄의 끝 위치를 찾아 --- 를 줄 뒤에 삽입한다.
      // 버그 수정: substring(start) 대신 줄 끝을 기준으로 해야 커서 앞 텍스트가 사라지지 않는다.
      const lineEnd = value.indexOf('\n', start);
      const insertAt = lineEnd === -1 ? value.length : lineEnd;

      const textBefore = value.substring(0, insertAt);
      const textAfter = value.substring(insertAt);

      const needsBefore = textBefore.length > 0 && !textBefore.endsWith('\n');
      const prefix = needsBefore ? '\n\n' : '';

      const hrText = `${prefix}---\n\n`;
      editor.value = textBefore + hrText + textAfter;

      const newPos = textBefore.length + hrText.length;
      editor.setSelectionRange(newPos, newPos);

      updatePreview();
      scheduleAutoSave();
    },
  };

  // 커서 위치에 텍스트 삽입
  function insertAtCursor(text) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;

    editor.value = value.substring(0, start) + text + value.substring(end);
    const newPos = start + text.length;
    editor.setSelectionRange(newPos, newPos);

    updatePreview();
    scheduleAutoSave();
  }

  // ============================
  // 툴바 버튼 이벤트 바인딩
  // ============================
  function bindToolbarButtons() {
    const buttons = document.querySelectorAll('.toolbar-btn[data-action]');
    buttons.forEach(btn => {
      const action = btn.dataset.action;
      if (toolbarActions[action]) {
        btn.addEventListener('click', () => {
          toolbarActions[action]();
        });
      }
    });
  }

  // ============================
  // 키보드 단축키
  // ============================
  function bindKeyboardShortcuts() {
    editor.addEventListener('keydown', (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlOrMeta = isMac ? e.metaKey : e.ctrlKey;

      if (!ctrlOrMeta) return;

      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          toolbarActions.bold();
          break;

        case 'i':
          e.preventDefault();
          toolbarActions.italic();
          break;

        case 'k':
          e.preventDefault();
          toolbarActions.link();
          break;
      }
    });
  }

  // ============================
  // Tab 키 처리 (들여쓰기)
  // ============================
  function bindTabKey() {
    editor.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();

      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;

      if (start === end) {
        // 단일 커서: 공백 2개 삽입
        editor.value = value.substring(0, start) + '  ' + value.substring(end);
        editor.setSelectionRange(start + 2, start + 2);
      } else {
        // 선택 영역: 각 줄에 들여쓰기 추가/제거
        const selectedText = value.substring(start, end);
        const lines = selectedText.split('\n');

        let newText;
        if (e.shiftKey) {
          // 내어쓰기
          newText = lines.map(line => line.startsWith('  ') ? line.substring(2) : line).join('\n');
        } else {
          // 들여쓰기
          newText = lines.map(line => '  ' + line).join('\n');
        }

        editor.value = value.substring(0, start) + newText + value.substring(end);
        editor.setSelectionRange(start, start + newText.length);
      }

      updatePreview();
      scheduleAutoSave();
    });
  }

  // ============================
  // 드래그 리사이저
  // ============================
  function bindResizer() {
    let isDragging = false;
    let startX = 0;
    let startEditorWidth = 0;
    let isVertical = false;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;

      const containerRect = editorContainer.getBoundingClientRect();
      isVertical = window.innerWidth <= 768;

      if (isVertical) {
        startX = e.clientY;
        startEditorWidth = editorPane.getBoundingClientRect().height;
      } else {
        startX = e.clientX;
        startEditorWidth = editorPane.getBoundingClientRect().width;
      }

      resizer.classList.add('dragging');
      document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const containerRect = editorContainer.getBoundingClientRect();

      if (isVertical) {
        const delta = e.clientY - startX;
        const containerHeight = containerRect.height;
        const newEditorHeight = startEditorWidth + delta;

        // 최소/최대 크기 제한 (20% ~ 80%)
        const minHeight = containerHeight * 0.2;
        const maxHeight = containerHeight * 0.8;
        const clampedHeight = Math.min(Math.max(newEditorHeight, minHeight), maxHeight);
        const percentage = (clampedHeight / containerHeight) * 100;

        editorPane.style.flex = 'none';
        editorPane.style.height = `${percentage}%`;
        previewPane.style.flex = '1';
        previewPane.style.height = '';
      } else {
        const delta = e.clientX - startX;
        const containerWidth = containerRect.width;
        const newEditorWidth = startEditorWidth + delta;

        // 최소/최대 크기 제한 (20% ~ 80%)
        const minWidth = containerWidth * 0.2;
        const maxWidth = containerWidth * 0.8;
        const clampedWidth = Math.min(Math.max(newEditorWidth, minWidth), maxWidth);
        const percentage = (clampedWidth / containerWidth) * 100;

        editorPane.style.flex = 'none';
        editorPane.style.width = `${percentage}%`;
        previewPane.style.flex = '1';
        previewPane.style.width = '';
      }
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });

    // 터치 지원
    resizer.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      isDragging = true;
      isVertical = window.innerWidth <= 768;

      if (isVertical) {
        startX = touch.clientY;
        startEditorWidth = editorPane.getBoundingClientRect().height;
      } else {
        startX = touch.clientX;
        startEditorWidth = editorPane.getBoundingClientRect().width;
      }

      resizer.classList.add('dragging');
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      const containerRect = editorContainer.getBoundingClientRect();

      if (isVertical) {
        const delta = touch.clientY - startX;
        const containerHeight = containerRect.height;
        const newEditorHeight = startEditorWidth + delta;
        const minHeight = containerHeight * 0.2;
        const maxHeight = containerHeight * 0.8;
        const clampedHeight = Math.min(Math.max(newEditorHeight, minHeight), maxHeight);
        const percentage = (clampedHeight / containerHeight) * 100;

        editorPane.style.flex = 'none';
        editorPane.style.height = `${percentage}%`;
        previewPane.style.flex = '1';
      } else {
        const delta = touch.clientX - startX;
        const containerWidth = containerRect.width;
        const newEditorWidth = startEditorWidth + delta;
        const minWidth = containerWidth * 0.2;
        const maxWidth = containerWidth * 0.8;
        const clampedWidth = Math.min(Math.max(newEditorWidth, minWidth), maxWidth);
        const percentage = (clampedWidth / containerWidth) * 100;

        editorPane.style.flex = 'none';
        editorPane.style.width = `${percentage}%`;
        previewPane.style.flex = '1';
      }
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      resizer.classList.remove('dragging');
    });
  }

  // ============================
  // HTML 내보내기
  // ============================
  function exportHtml() {
    const markdownContent = editor.value;
    const renderedHtml = MarkdownParser.parse(markdownContent);

    const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>마크다운 내보내기</title>
  <style>
    :root {
      --text-primary: #24292f;
      --text-secondary: #57606a;
      --text-link: #0969da;
      --bg-code: #f6f8fa;
      --border: #d0d7de;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --text-primary: #e6edf3;
        --text-secondary: #8b949e;
        --text-link: #58a6ff;
        --bg-code: #161b22;
        --border: #30363d;
      }
      body { background: #0d1117; }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      color: var(--text-primary);
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 24px;
      margin-bottom: 12px;
      font-weight: 600;
      line-height: 1.25;
    }

    h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
    h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
    h3 { font-size: 1.25em; }

    p { margin-bottom: 16px; }

    a { color: var(--text-link); text-decoration: none; }
    a:hover { text-decoration: underline; }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.875em;
      padding: 0.2em 0.4em;
      background: var(--bg-code);
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    pre {
      padding: 16px;
      overflow: auto;
      background: var(--bg-code);
      border-radius: 6px;
      border: 1px solid var(--border);
      margin-bottom: 16px;
    }

    pre code {
      padding: 0;
      background: transparent;
      border: none;
      font-size: 0.875em;
    }

    blockquote {
      margin: 0 0 16px;
      padding: 0 16px;
      color: var(--text-secondary);
      border-left: 4px solid var(--border);
    }

    ul, ol { margin-bottom: 16px; padding-left: 2em; }
    li { margin-bottom: 4px; }

    hr { height: 1px; margin: 24px 0; background: var(--border); border: 0; }

    img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border); }

    .code-block-wrapper { position: relative; margin-bottom: 16px; }
    .code-block-wrapper pre { margin-bottom: 0; }
    .code-lang-label {
      position: absolute;
      top: 8px;
      right: 12px;
      font-size: 11px;
      color: var(--text-secondary);
      background: var(--bg-code);
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <article class="markdown-body">
${renderedHtml}
  </article>
</body>
</html>`;

    // 파일 다운로드
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `markdown-export-${timestamp}.html`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // 정리
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 100);
  }

  // ============================
  // 초기화
  // ============================
  function init() {
    // 저장된 내용 복원
    restoreFromLocalStorage();

    // 초기 미리보기 렌더링
    updatePreview();

    // 에디터 입력 이벤트
    editor.addEventListener('input', () => {
      updatePreview();
      scheduleAutoSave();
    });

    // 툴바 버튼 바인딩
    bindToolbarButtons();

    // 키보드 단축키
    bindKeyboardShortcuts();

    // Tab 키 처리
    bindTabKey();

    // 리사이저
    bindResizer();

    // HTML 내보내기
    exportBtn.addEventListener('click', exportHtml);

    // 창 크기 변경 시 반응형 처리
    window.addEventListener('resize', () => {
      // 가로/세로 전환 시 패널 크기 초기화
      if (window.innerWidth <= 768) {
        editorPane.style.flex = '';
        editorPane.style.width = '';
        editorPane.style.height = '';
        previewPane.style.flex = '';
        previewPane.style.width = '';
        previewPane.style.height = '';
      }
    });
  }

  // DOM 로드 완료 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
