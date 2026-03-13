/**
 * 에디터 로직
 * - 실시간 미리보기 업데이트
 * - 툴바 버튼 동작 (선택 텍스트 감싸기 / 커서 위치 삽입)
 * - 드래그/키보드로 분할 창 크기 조정
 * - 키보드 단축키 (Ctrl+B, Ctrl+I, Ctrl+K)
 * - localStorage 자동 저장/복원
 * - HTML 내보내기
 */

(function () {
  'use strict';

  // ===== DOM 요소 =====
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const resizer = document.getElementById('resizer');
  const editorPane = document.getElementById('editor-pane');
  const previewPane = document.getElementById('preview-pane');
  const editorContainer = document.getElementById('editor-container');
  const exportBtn = document.getElementById('export-btn');
  const saveStatus = document.getElementById('save-status');
  const wordCount = document.getElementById('word-count');
  const toast = document.getElementById('toast');

  // ===== 상수 =====
  const STORAGE_KEY = 'markdown-editor-content';
  const SAVE_DEBOUNCE_MS = 800;
  const PREVIEW_DEBOUNCE_MS = 150;
  const MIN_PANE_PX = 80;
  const RESIZE_STEP_PX = 20;  // 키보드 리사이저 1회 이동 픽셀

  // ===== 초기 콘텐츠 =====
  const DEFAULT_CONTENT = `# 마크다운 에디터에 오신 것을 환영합니다

이것은 **라이브 미리보기**가 있는 마크다운 에디터입니다.

## 사용법

왼쪽 패널에서 마크다운을 작성하면 오른쪽에 실시간으로 렌더링됩니다.

### 지원하는 서식

- **굵게** \`**텍스트**\`
- *기울임* \`*텍스트*\`
- ***굵게+기울임*** \`***텍스트***\`
- ~~취소선~~ \`~~텍스트~~\`
- \`인라인 코드\`

### 코드 블록

\`\`\`javascript
function greet(name) {
  console.log(\`Hello, \${name}!\`);
}
greet('World');
\`\`\`

### 링크와 이미지

[GitHub](https://github.com) 링크 예시

### 목록

1. 첫 번째 항목
2. 두 번째 항목
   - 중첩 항목 A
   - 중첩 항목 B
3. 세 번째 항목

> 인용문 예시입니다.
> 여러 줄도 지원합니다.

---

**Export HTML** 버튼으로 결과물을 다운로드할 수 있습니다.
`;

  // ===== 상태 =====
  let saveTimer = null;
  let previewTimer = null;
  let isUnsaved = false;
  let toastTimer = null;

  // ===== 플랫폼 감지 (navigator.platform 비권장 → userAgentData 우선) =====
  const isMac = /Mac|iPhone|iPad|iPod/i.test(
    navigator.userAgentData?.platform ?? navigator.platform ?? ''
  );

  // ===== 초기화 =====
  function init() {
    loadContent();
    updatePreview();
    updateWordCount();
    setupToolbar();
    setupResizer();
    setupKeyboardShortcuts();
    setupAutoSave();
    setupExport();
    setupScrollSync();
  }

  // ===== 콘텐츠 로드/저장 =====
  function loadContent() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      editor.value = saved !== null ? saved : DEFAULT_CONTENT;
      setSaveStatus('saved');
    } catch (e) {
      editor.value = DEFAULT_CONTENT;
    }
  }

  function saveContent() {
    try {
      localStorage.setItem(STORAGE_KEY, editor.value);
      setSaveStatus('saved');
      isUnsaved = false;
    } catch (e) {
      setSaveStatus('unsaved');
      // QuotaExceededError와 일반 오류를 구분하여 사용자에게 안내
      const isQuota = e instanceof DOMException &&
        (e.name === 'QuotaExceededError' || e.code === 22);
      showToast(
        isQuota
          ? '저장 공간이 가득 찼습니다. 브라우저 저장소를 정리해 주세요.'
          : '저장에 실패했습니다',
        'error'
      );
      console.error('[에디터] 저장 실패:', e);
    }
  }

  function setSaveStatus(status) {
    if (!saveStatus) return;
    if (status === 'saved') {
      saveStatus.textContent = '저장됨';
      saveStatus.className = 'saved';
    } else if (status === 'unsaved') {
      saveStatus.textContent = '저장 안 됨';
      saveStatus.className = 'unsaved';
    } else {
      saveStatus.textContent = '저장 중...';
      saveStatus.className = '';
    }
  }

  // ===== 미리보기 업데이트 =====
  function updatePreview() {
    const markdown = editor.value;

    if (!markdown.trim()) {
      preview.innerHTML = `
        <div id="preview-empty">
          <div class="empty-icon">📝</div>
          <p>왼쪽에 마크다운을 입력하면<br>여기에 미리보기가 표시됩니다</p>
        </div>`;
      return;
    }

    try {
      preview.innerHTML = MarkdownParser.parse(markdown);
    } catch (e) {
      // e.message를 직접 innerHTML에 삽입하면 XSS 가능 → textContent로 안전 처리
      const errPara = document.createElement('p');
      errPara.style.color = 'var(--accent-red)';
      errPara.textContent = '파싱 오류: ' + e.message;
      preview.innerHTML = '';
      preview.appendChild(errPara);
    }
  }

  function schedulePreviewUpdate() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, PREVIEW_DEBOUNCE_MS);
  }

  // ===== 단어 수 계산 =====
  function updateWordCount() {
    if (!wordCount) return;
    const text = editor.value.trim();
    const chars = text.length;
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const lines = editor.value.split('\n').length;
    wordCount.textContent = `${lines}줄 · ${words}단어 · ${chars}자`;
  }

  // ===== 자동 저장 설정 =====
  function setupAutoSave() {
    editor.addEventListener('input', () => {
      isUnsaved = true;
      setSaveStatus('unsaved');
      schedulePreviewUpdate();
      updateWordCount();

      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveContent, SAVE_DEBOUNCE_MS);
    });
  }

  // ===== 커서/선택 영역 텍스트 삽입 유틸 =====
  function getSelection() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    return {
      start,
      end,
      selected: editor.value.slice(start, end),
      before: editor.value.slice(0, start),
      after: editor.value.slice(end),
    };
  }

  /**
   * 선택된 텍스트를 prefix/suffix로 감싸거나,
   * 선택이 없으면 cursor 위치에 placeholder를 삽입하고 선택
   */
  function wrapText(prefix, suffix, placeholder = '텍스트') {
    const { start, selected, before, after } = getSelection();
    const content = selected || placeholder;
    const newText = before + prefix + content + suffix + after;
    editor.value = newText;

    const selStart = start + prefix.length;
    const selEnd = selStart + content.length;
    editor.setSelectionRange(selStart, selEnd);
    editor.focus();
    triggerUpdate();
  }

  /**
   * 줄 앞에 prefix 삽입 (제목, 목록, 인용문 등)
   */
  function insertLinePrefix(prefix, placeholder = '') {
    const { start, end, selected, before, after } = getSelection();

    if (selected) {
      const lines = selected.split('\n');
      const prefixed = lines.map(line => prefix + line).join('\n');
      editor.value = before + prefixed + after;
      editor.setSelectionRange(start, start + prefixed.length);
    } else {
      const lineStart = before.lastIndexOf('\n') + 1;
      const lineContent = editor.value.slice(lineStart, end);
      const newLine = prefix + (lineContent || placeholder);
      editor.value = editor.value.slice(0, lineStart) + newLine + after;
      editor.setSelectionRange(lineStart + prefix.length, lineStart + newLine.length);
    }

    editor.focus();
    triggerUpdate();
  }

  /**
   * 커서 위치에 블록 삽입 (코드블록, 수평선 등)
   */
  function insertBlock(text, cursorOffset = null) {
    const { start, before, after } = getSelection();
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    const suffix = !after.startsWith('\n') ? '\n' : '';
    const inserted = prefix + text + suffix;
    editor.value = before + inserted + after;

    const newPos = cursorOffset !== null
      ? start + prefix.length + cursorOffset
      : start + inserted.length;
    editor.setSelectionRange(newPos, newPos);
    editor.focus();
    triggerUpdate();
  }

  function triggerUpdate() {
    editor.dispatchEvent(new Event('input'));
  }

  // ===== 툴바 동작 정의 =====
  const toolbarActions = {
    bold:       () => wrapText('**', '**', '굵은 텍스트'),
    italic:     () => wrapText('*', '*', '기울임 텍스트'),
    heading1:   () => insertLinePrefix('# ', '제목 1'),
    heading2:   () => insertLinePrefix('## ', '제목 2'),
    heading3:   () => insertLinePrefix('### ', '제목 3'),
    link:       () => {
      const { selected } = getSelection();
      if (selected) {
        wrapText('[', '](URL)', selected);
      } else {
        insertBlock('[링크 텍스트](URL)');
      }
    },
    image:      () => insertBlock('![대체 텍스트](이미지-URL)'),
    code:       () => {
      const { selected } = getSelection();
      if (selected && selected.includes('\n')) {
        insertBlock(`\`\`\`javascript\n${selected}\n\`\`\``);
      } else {
        wrapText('`', '`', '코드');
      }
    },
    codeblock:  () => insertBlock('```javascript\n코드를 입력하세요\n```', 14),
    unordered:  () => insertLinePrefix('- ', '목록 항목'),
    ordered:    () => insertLinePrefix('1. ', '목록 항목'),
    blockquote: () => insertLinePrefix('> ', '인용문'),
    hr:         () => insertBlock('\n---\n'),
  };

  // ===== 툴바 이벤트 연결 =====
  function setupToolbar() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;

    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (toolbarActions[action]) {
        toolbarActions[action]();
      }
    });
  }

  // ===== 키보드 단축키 (단일 리스너에 Tab + 단축키 통합) =====
  function setupKeyboardShortcuts() {
    editor.addEventListener('keydown', (e) => {
      // Tab 키 → 2 스페이스 들여쓰기
      if (e.key === 'Tab') {
        e.preventDefault();
        const { start, end, before, after, selected } = getSelection();
        if (selected && selected.includes('\n')) {
          const lines = selected.split('\n');
          const indented = e.shiftKey
            ? lines.map(l => l.startsWith('  ') ? l.slice(2) : l.startsWith('\t') ? l.slice(1) : l)
            : lines.map(l => '  ' + l);
          const result = indented.join('\n');
          editor.value = before + result + after;
          editor.setSelectionRange(start, start + result.length);
        } else {
          editor.value = before + '  ' + after;
          editor.setSelectionRange(start + 2, start + 2);
        }
        triggerUpdate();
        return;
      }

      const ctrl = isMac ? e.metaKey : e.ctrlKey;
      if (!ctrl) return;

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
        case 's':
          e.preventDefault();
          saveContent();
          showToast('저장되었습니다', 'success');
          break;
        // 기본 실행취소(z) 허용 — 별도 처리 없음
      }
    });
  }

  // ===== 드래그 리사이저 =====
  function setupResizer() {
    if (!resizer) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startEditorWidth = 0;
    let startEditorHeight = 0;
    let isVertical = false;

    resizer.addEventListener('mousedown', onDragStart);
    resizer.addEventListener('touchstart', onDragStart, { passive: false });

    function onDragStart(e) {
      isDragging = true;
      resizer.classList.add('dragging');
      document.body.style.userSelect = 'none';

      const containerRect = editorContainer.getBoundingClientRect();
      isVertical = containerRect.width < containerRect.height * 1.5 && window.innerWidth <= 768;
      document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';

      if (e.type === 'touchstart') {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      } else {
        startX = e.clientX;
        startY = e.clientY;
        e.preventDefault();
      }

      startEditorWidth  = editorPane.getBoundingClientRect().width;
      startEditorHeight = editorPane.getBoundingClientRect().height;

      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
      document.addEventListener('touchmove', onDragMove, { passive: false });
      document.addEventListener('touchend', onDragEnd);
    }

    function onDragMove(e) {
      if (!isDragging) return;
      if (e.type === 'touchmove') e.preventDefault();

      if (isVertical) {
        // 모바일 세로 레이아웃: Y축 드래그로 높이 조정
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
        const delta = clientY - startY;
        const containerHeight = editorContainer.getBoundingClientRect().height;
        const resizerHeight   = resizer.getBoundingClientRect().height;
        const available       = containerHeight - resizerHeight;

        let newH = Math.max(MIN_PANE_PX, Math.min(startEditorHeight + delta, available - MIN_PANE_PX));
        editorPane.style.flex   = 'none';
        editorPane.style.height = `${(newH / available) * 100}%`;
        previewPane.style.flex   = 'none';
        previewPane.style.height = `${((available - newH) / available) * 100}%`;
      } else {
        // 데스크톱 가로 레이아웃: X축 드래그로 너비 조정
        const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const delta = clientX - startX;
        const containerWidth = editorContainer.getBoundingClientRect().width;
        const resizerWidth   = resizer.getBoundingClientRect().width;
        const available      = containerWidth - resizerWidth;

        let newW = Math.max(MIN_PANE_PX, Math.min(startEditorWidth + delta, available - MIN_PANE_PX));
        editorPane.style.flex  = 'none';
        editorPane.style.width = `${(newW / available) * 100}%`;
        previewPane.style.flex  = 'none';
        previewPane.style.width = `${((available - newW) / available) * 100}%`;
      }
    }

    function onDragEnd() {
      isDragging = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      document.removeEventListener('touchmove', onDragMove);
      document.removeEventListener('touchend', onDragEnd);
    }

    // 더블클릭으로 50/50 초기화
    resizer.addEventListener('dblclick', () => {
      editorPane.style.flex   = '1';
      editorPane.style.width  = '';
      editorPane.style.height = '';
      previewPane.style.flex   = '1';
      previewPane.style.width  = '';
      previewPane.style.height = '';
      resizer.setAttribute('aria-valuenow', '50');
    });

    // 키보드 접근성: ArrowLeft/Right(가로) 또는 ArrowUp/Down(세로)로 조정
    resizer.addEventListener('keydown', (e) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();

      const containerWidth = editorContainer.getBoundingClientRect().width;
      const resizerWidth   = resizer.getBoundingClientRect().width;
      const available      = containerWidth - resizerWidth;
      const currentW       = editorPane.getBoundingClientRect().width;

      let newW = currentW;
      if (e.key === 'ArrowLeft')  newW -= RESIZE_STEP_PX;
      if (e.key === 'ArrowRight') newW += RESIZE_STEP_PX;
      if (e.key === 'Home')       newW = MIN_PANE_PX;
      if (e.key === 'End')        newW = available - MIN_PANE_PX;

      newW = Math.max(MIN_PANE_PX, Math.min(newW, available - MIN_PANE_PX));
      const editorPct  = (newW / available) * 100;
      const previewPct = 100 - editorPct;

      editorPane.style.flex  = 'none';
      editorPane.style.width = `${editorPct}%`;
      previewPane.style.flex  = 'none';
      previewPane.style.width = `${previewPct}%`;
      resizer.setAttribute('aria-valuenow', String(Math.round(editorPct)));
    });
  }

  // ===== 스크롤 동기화 =====
  function setupScrollSync() {
    let syncingEditor = false;
    let syncingPreview = false;

    editor.addEventListener('scroll', () => {
      if (syncingEditor) return;
      syncingPreview = true;

      const ratio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
      preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);

      requestAnimationFrame(() => { syncingPreview = false; });
    });

    preview.addEventListener('scroll', () => {
      if (syncingPreview) return;
      syncingEditor = true;

      const ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
      editor.scrollTop = ratio * (editor.scrollHeight - editor.clientHeight);

      requestAnimationFrame(() => { syncingEditor = false; });
    });
  }

  // ===== HTML 내보내기 =====
  function setupExport() {
    if (!exportBtn) return;
    exportBtn.addEventListener('click', exportHtml);
  }

  function exportHtml() {
    const markdown = editor.value;
    const renderedBody = MarkdownParser.parse(markdown);

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>내보낸 문서</title>
  <style>
    :root {
      --bg: #0d1117;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --border: #30363d;
      --accent: #58a6ff;
      --code-bg: #161b22;
      --pre-bg: #161b22;
      --blockquote-border: #388bfd;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      max-width: 800px;
      margin: 0 auto;
      padding: 48px 32px;
      line-height: 1.7;
      font-size: 16px;
    }
    h1, h2, h3, h4, h5, h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
    h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
    h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
    h3 { font-size: 1.25em; }
    p { margin: 0 0 16px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    strong { font-weight: 700; }
    code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.875em;
      background: var(--code-bg);
      color: #f08080;
      padding: 0.2em 0.4em;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    pre {
      background: var(--pre-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      margin: 16px 0;
    }
    pre .code-lang {
      display: block;
      padding: 6px 16px;
      background: #0d1117;
      border-bottom: 1px solid var(--border);
      font-family: monospace;
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    pre code {
      display: block;
      padding: 16px;
      background: transparent;
      color: var(--text);
      border: none;
      font-size: 13px;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre;
    }
    ul, ol { padding-left: 2em; margin-bottom: 16px; }
    li { margin-bottom: 4px; }
    blockquote {
      margin: 16px 0;
      padding: 12px 20px;
      border-left: 4px solid var(--blockquote-border);
      background: rgba(56,139,253,0.06);
      border-radius: 0 6px 6px 0;
      color: var(--text-muted);
    }
    hr { border: none; height: 2px; background: var(--border); margin: 24px 0; }
    img { max-width: 100%; border-radius: 6px; border: 1px solid var(--border); }
    del { color: var(--text-muted); text-decoration: line-through; }
  </style>
</head>
<body>
${renderedBody}
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.html';
    a.click();
    // 다운로드가 시작된 후 충분한 시간이 지나야 Blob URL을 해제해도 안전
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    showToast('HTML 파일이 다운로드되었습니다', 'success');
  }

  // ===== 토스트 알림 =====
  function showToast(message, type = 'info') {
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `show ${type}`;
    toastTimer = setTimeout(() => {
      toast.className = toast.className.replace('show', '').trim();
    }, 2500);
  }

  // ===== 페이지 이탈 경고 =====
  window.addEventListener('beforeunload', (e) => {
    if (isUnsaved) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ===== 실행 =====
  document.addEventListener('DOMContentLoaded', init);

})();
