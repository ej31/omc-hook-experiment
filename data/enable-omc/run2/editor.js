/**
 * 에디터 로직
 * - 실시간 미리보기 업데이트
 * - 툴바 버튼 액션 (커서 위치에 마크다운 삽입, 선택 텍스트 감싸기)
 * - 드래그로 패널 크기 조절
 * - 키보드 단축키 (Ctrl+B, Ctrl+I, Ctrl+K)
 * - localStorage 자동 저장/복원
 * - HTML 내보내기
 */

(function () {
  'use strict';

  // ── DOM 참조 ───────────────────────────────────────────────
  const editor     = document.getElementById('editor');
  const preview    = document.getElementById('preview');
  const resizer    = document.getElementById('resizer');
  const editorPane = document.querySelector('.editor-pane');
  const editorArea = document.querySelector('.editor-area');
  const wordCount  = document.getElementById('word-count');
  const lineCount  = document.getElementById('line-count');
  const saveStatus = document.getElementById('save-status');
  const saveDot    = document.getElementById('save-dot');

  // ── 상수 ───────────────────────────────────────────────────
  const STORAGE_KEY   = 'md-editor-content';
  const SAVE_DELAY_MS = 800;   // 자동 저장 딜레이
  const RESIZE_STEP   = 20;    // 키보드 리사이저 이동 단위 (px)
  const RESIZE_MIN    = 160;   // 에디터 패널 최소 너비 (px)
  const RESIZE_GAP    = 164;   // 미리보기 패널 최소 너비 보장용 여유 (px)

  const DEFAULT_CONTENT = `# 마크다운 에디터에 오신 것을 환영합니다

## 기본 텍스트 서식

**굵게**, *기울임*, ***굵게+기울임***, ~~취소선~~

## 코드

인라인 \`코드\` 예시

\`\`\`javascript
// 코드 블록 예시
function greet(name) {
  return \`안녕하세요, \${name}!\`;
}
console.log(greet('세계'));
\`\`\`

## 링크 & 이미지

[GitHub](https://github.com "GitHub")

## 목록

- 항목 1
  - 중첩 항목 1-1
  - 중첩 항목 1-2
- 항목 2
- 항목 3

1. 첫 번째
2. 두 번째
3. 세 번째

## 인용구

> 인용구 예시입니다.
>
> > 중첩 인용구도 지원합니다.

## 수평선

---

## 단축키

| 단축키 | 기능 |
| --- | --- |
| Ctrl+B | 굵게 |
| Ctrl+I | 기울임 |
| Ctrl+K | 링크 삽입 |
`;

  // ── 초기화 ─────────────────────────────────────────────────
  function init() {
    loadContent();
    updatePreview();
    updateStatus();
    bindToolbar();
    bindKeyboardShortcuts();
    bindResizer();
    bindEditorEvents();
  }

  // ── 콘텐츠 로드/저장 ───────────────────────────────────────
  function loadContent() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      editor.value = saved !== null ? saved : DEFAULT_CONTENT;
    } catch {
      editor.value = DEFAULT_CONTENT;
    }
  }

  let saveTimer = null;

  function scheduleAutosave() {
    clearTimeout(saveTimer);
    setSaveStatus('저장 중...', false);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, editor.value);
        setSaveStatus('저장됨', true);
      } catch {
        setSaveStatus('저장 실패', false);
      }
    }, SAVE_DELAY_MS);
  }

  function setSaveStatus(text, saved) {
    if (saveStatus) saveStatus.textContent = text;
    if (saveDot) saveDot.className = 'statusbar-dot' + (saved ? ' saved' : '');
  }

  // ── 미리보기 업데이트 ──────────────────────────────────────
  function updatePreview() {
    const html = MarkdownParser.parse(editor.value);
    preview.innerHTML = html;
  }

  // ── 상태바 업데이트 ────────────────────────────────────────
  function updateStatus() {
    const text  = editor.value;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const lines = text === '' ? 1 : text.split('\n').length;
    if (wordCount) wordCount.textContent = `${words} 단어`;
    if (lineCount) lineCount.textContent = `${lines} 줄`;
  }

  // ── 에디터 이벤트 바인딩 ───────────────────────────────────
  function bindEditorEvents() {
    editor.addEventListener('input', () => {
      updatePreview();
      updateStatus();
      scheduleAutosave();
    });

    // Tab 키 들여쓰기 처리
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        insertAtCursor('  ');
      }
    });
  }

  // ── 커서 위치에 텍스트 삽입 ────────────────────────────────
  function insertAtCursor(text) {
    const start = editor.selectionStart;
    const end   = editor.selectionEnd;
    const val   = editor.value;
    editor.value = val.slice(0, start) + text + val.slice(end);
    editor.selectionStart = editor.selectionEnd = start + text.length;
    editor.focus();
    editor.dispatchEvent(new Event('input'));
  }

  // ── 선택 영역 감싸기 또는 앞에 삽입 ──────────────────────
  /**
   * @param {string} prefix      - 선택 영역 앞에 삽입할 텍스트
   * @param {string} suffix      - 선택 영역 뒤에 삽입할 텍스트 (없으면 prefix와 동일)
   * @param {string} placeholder - 선택 없을 때 사용할 기본 텍스트
   */
  function wrapSelection(prefix, suffix, placeholder) {
    if (suffix === undefined) suffix = prefix;
    const start    = editor.selectionStart;
    const end      = editor.selectionEnd;
    const val      = editor.value;
    const selected = val.slice(start, end) || placeholder || '';
    const wrapped  = prefix + selected + suffix;
    editor.value   = val.slice(0, start) + wrapped + val.slice(end);

    // 커서를 삽입된 내용 안으로 이동
    const newStart = start + prefix.length;
    const newEnd   = newStart + selected.length;
    editor.focus();
    editor.setSelectionRange(newStart, newEnd);
    editor.dispatchEvent(new Event('input'));
  }

  // ── 줄 앞에 접두사 삽입 ────────────────────────────────────
  function insertLinePrefix(prefix) {
    const start     = editor.selectionStart;
    const val       = editor.value;
    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
    editor.value    = val.slice(0, lineStart) + prefix + val.slice(lineStart);
    editor.focus();
    editor.setSelectionRange(start + prefix.length, start + prefix.length);
    editor.dispatchEvent(new Event('input'));
  }

  // ── 툴바 액션 정의 ─────────────────────────────────────────
  const ACTIONS = {
    bold:       () => wrapSelection('**', '**', '굵게'),
    italic:     () => wrapSelection('*', '*', '기울임'),
    h1:         () => insertLinePrefix('# '),
    h2:         () => insertLinePrefix('## '),
    h3:         () => insertLinePrefix('### '),
    link:       () => insertLink(),
    image:      () => insertImage(),
    code:       () => insertCodeBlock(),
    ul:         () => insertLinePrefix('- '),
    ol:         () => insertOrderedList(),
    blockquote: () => insertLinePrefix('> '),
    hr:         () => insertAtCursor('\n---\n'),
    export:     () => exportHtml(),
  };

  function insertLink() {
    const start    = editor.selectionStart;
    const end      = editor.selectionEnd;
    const selected = editor.value.slice(start, end);

    if (selected) {
      wrapSelection('[', '](https://)', selected);
      // wrapSelection 후 URL 부분("https://")을 선택 상태로 만든다
      // 구조: [selected](https://)
      //       ^        ^  ^
      //       start    |  urlStart = start + 1 + selected.length + 2
      const urlStart = start + 1 + selected.length + 2;
      editor.focus();
      editor.setSelectionRange(urlStart, urlStart + 8); // "https://" 8자
    } else {
      wrapSelection('[링크 텍스트](https://)');
    }
  }

  function insertImage() {
    const start    = editor.selectionStart;
    const end      = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    const alt      = selected || '이미지 설명';
    wrapSelection(`![${alt}](`, ')', '이미지 URL');
    editor.focus();
  }

  function insertCodeBlock() {
    const start    = editor.selectionStart;
    const end      = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    const val      = editor.value;

    if (selected.includes('\n')) {
      // 여러 줄 선택 → 코드 블록
      const block = '```\n' + selected + '\n```';
      editor.value = val.slice(0, start) + block + val.slice(end);
      editor.focus();
      editor.setSelectionRange(start + 4, start + 4 + selected.length);
    } else if (selected) {
      // 단일 줄 선택 → 인라인 코드
      wrapSelection('`', '`', selected);
      return;
    } else {
      // 선택 없음 → 코드 블록 삽입 후 내용 부분 선택
      const placeholder = '코드를 입력하세요';
      const block = '```\n' + placeholder + '\n```';
      editor.value = val.slice(0, start) + block + val.slice(end);
      editor.focus();
      editor.setSelectionRange(start + 4, start + 4 + placeholder.length);
    }
    editor.dispatchEvent(new Event('input'));
  }

  function insertOrderedList() {
    const start    = editor.selectionStart;
    const end      = editor.selectionEnd;
    const val      = editor.value;
    const selected = val.slice(start, end);

    if (selected) {
      const lines    = selected.split('\n');
      const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
      editor.value   = val.slice(0, start) + numbered + val.slice(end);
      editor.focus();
      editor.setSelectionRange(start, start + numbered.length);
    } else {
      insertLinePrefix('1. ');
      return;
    }
    editor.dispatchEvent(new Event('input'));
  }

  // ── 툴바 버튼 바인딩 ───────────────────────────────────────
  function bindToolbar() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        if (ACTIONS[action]) ACTIONS[action]();
      });
    });
  }

  // ── 키보드 단축키 ──────────────────────────────────────────
  function bindKeyboardShortcuts() {
    editor.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          ACTIONS.bold();
          break;
        case 'i':
          e.preventDefault();
          ACTIONS.italic();
          break;
        case 'k':
          e.preventDefault();
          ACTIONS.link();
          break;
      }
    });
  }

  // ── 드래그로 패널 크기 조절 ────────────────────────────────
  // 메모리 누수 방지: document 리스너를 mousedown 시 동적으로 추가하고
  // mouseup 시 즉시 제거하는 방식으로 구현
  function bindResizer() {
    let startX     = 0;
    let startWidth = 0;

    // ── 마우스 드래그 ──
    function onMouseMove(e) {
      const delta    = e.clientX - startX;
      const total    = editorArea.offsetWidth;
      const newWidth = Math.max(RESIZE_MIN, Math.min(total - RESIZE_GAP, startWidth + delta));
      editorPane.style.width = newWidth + 'px';
    }

    function onMouseUp() {
      resizer.classList.remove('dragging');
      editorArea.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    resizer.addEventListener('mousedown', (e) => {
      startX     = e.clientX;
      startWidth = editorPane.offsetWidth;
      resizer.classList.add('dragging');
      editorArea.classList.add('resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });

    // ── 터치 드래그 ──
    function onTouchMove(e) {
      // passive: false 로 등록했으므로 스크롤 차단 가능
      e.preventDefault();
      const delta    = e.touches[0].clientX - startX;
      const total    = editorArea.offsetWidth;
      const newWidth = Math.max(RESIZE_MIN, Math.min(total - RESIZE_GAP, startWidth + delta));
      editorPane.style.width = newWidth + 'px';
    }

    function onTouchEnd() {
      resizer.classList.remove('dragging');
      editorArea.classList.remove('resizing');
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    }

    resizer.addEventListener('touchstart', (e) => {
      startX     = e.touches[0].clientX;
      startWidth = editorPane.offsetWidth;
      resizer.classList.add('dragging');
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      e.preventDefault();
    }, { passive: false });

    // ── 키보드 접근성 (←→ 화살표로 크기 조절) ──
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const total    = editorArea.offsetWidth;
      const current  = editorPane.offsetWidth;
      const delta    = e.key === 'ArrowLeft' ? -RESIZE_STEP : RESIZE_STEP;
      const newWidth = Math.max(RESIZE_MIN, Math.min(total - RESIZE_GAP, current + delta));
      editorPane.style.width = newWidth + 'px';
    });
  }

  // ── HTML 내보내기 ──────────────────────────────────────────
  function exportHtml() {
    const bodyHtml = preview.innerHTML;
    const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>내보낸 마크다운</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #24292f;
      --border: #d0d7de;
      --code-bg: #f6f8fa;
      --blockquote-border: #0969da;
      --blockquote-text: #57606a;
      --link: #0969da;
      --h1-border: #d0d7de;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --text: #e6edf3;
        --border: #30363d;
        --code-bg: #161b22;
        --blockquote-border: #388bfd;
        --blockquote-text: #8b949e;
        --link: #58a6ff;
        --h1-border: #21262d;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg);
      padding: 48px 24px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1, h2, h3, h4, h5, h6 { font-weight: 700; margin: 1.5em 0 0.5em; line-height: 1.3; }
    h1 { font-size: 2em; border-bottom: 2px solid var(--h1-border); padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
    h3 { font-size: 1.25em; }
    h4 { font-size: 1.1em; }
    p { margin: 0.75em 0; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
      font-size: 0.875em;
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .code-block-wrapper { margin: 1.25em 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    .code-lang { display: block; padding: 4px 14px; background: var(--code-bg); font-size: 11px; font-weight: 600; color: var(--blockquote-text); text-transform: uppercase; border-bottom: 1px solid var(--border); font-family: inherit; }
    pre { background: var(--code-bg); padding: 16px 20px; overflow-x: auto; }
    pre code { background: transparent; border: none; padding: 0; font-size: 13px; }
    blockquote { border-left: 4px solid var(--blockquote-border); padding: 8px 16px; margin: 1em 0; color: var(--blockquote-text); }
    ul, ol { margin: 0.75em 0; padding-left: 1.75em; }
    li { margin: 0.3em 0; }
    hr { border: none; border-top: 2px solid var(--border); margin: 2em 0; }
    img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border); }
    strong { font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
${bodyHtml}
  </div>
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'markdown-export.html';
    a.click();
    URL.revokeObjectURL(url);
    showToast('HTML로 내보냈습니다');
  }

  // ── 토스트 알림 ────────────────────────────────────────────
  // 연속 호출 시 이전 타이머를 취소하여 중첩 방지
  let toastTimer = null;

  function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id        = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    clearTimeout(toastTimer);
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // ── 실행 ──────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
