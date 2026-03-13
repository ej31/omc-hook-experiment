/**
 * 마크다운 파서 - 외부 라이브러리 없이 직접 구현
 * 지원: 제목, 굵게, 기울임, 인라인 코드, 코드블록, 링크, 이미지,
 *       순서/비순서 목록(중첩), 인용문(중첩), 수평선, 문단, 줄바꿈, 이스케이프
 */

const MarkdownParser = (() => {
  // 재귀 깊이 상한 (blockquote/list 무한 재귀 방지)
  const MAX_DEPTH = 10;

  // 이스케이프 처리가 필요한 HTML 특수문자
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 위험한 URL 프로토콜 차단 (XSS 예방)
  // javascript:, vbscript:, data: 프로토콜을 '#'으로 대체
  function sanitizeUrl(url) {
    // 공백·제어문자를 제거한 뒤 프로토콜 확인
    const stripped = url.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
    if (/^(javascript|vbscript|data):/.test(stripped)) {
      return '#';
    }
    return url;
  }

  // 백슬래시 이스케이프 처리
  function processEscapes(text) {
    return text.replace(/\\([\\`*_{}\[\]()#+\-.!~|])/g, (_, char) => {
      return `&#x${char.charCodeAt(0).toString(16)};`;
    });
  }

  // 제목 id 생성 — 유니코드 문자(한글 포함) 보존, 구분자만 하이픈으로 치환
  function makeHeadingId(text) {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '');
  }

  // 인라인 요소 파싱 (굵게, 기울임, 인라인 코드, 링크, 이미지)
  function parseInline(text) {
    // 백슬래시 이스케이프 먼저 처리
    text = processEscapes(text);

    // 인라인 코드를 플레이스홀더로 먼저 교체
    // → 이후 bold/italic 패턴이 코드 내부에 적용되지 않도록 보호
    const inlineCodes = [];
    text = text.replace(/``(.+?)``/g, (_, code) => {
      inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
      return `\x00IC${inlineCodes.length - 1}\x00`;
    });
    text = text.replace(/`([^`]+)`/g, (_, code) => {
      inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
      return `\x00IC${inlineCodes.length - 1}\x00`;
    });

    // 일반 텍스트의 HTML 특수문자 이스케이프
    // (&(?!entity;) 패턴으로 기존 HTML 엔티티는 이중 이스케이프하지 않음)
    text = text.replace(/&(?!#?\w+;)/g, '&amp;');
    text = text.replace(/</g, '&lt;');
    text = text.replace(/>/g, '&gt;');

    // 이미지 (링크보다 먼저 처리, 위험 URL 차단)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+?)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(sanitizeUrl(src))}" alt="${escapeHtml(alt)}"${titleAttr}>`;
    });

    // 링크 (위험 URL 차단)
    text = text.replace(/\[([^\]]+)\]\(([^)]+?)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(sanitizeUrl(href))}"${titleAttr}>${label}</a>`;
    });

    // 굵게 + 기울임 (***text*** 또는 ___text___)
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

    // 굵게 (**text** 또는 __text__)
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 기울임 (*text* 또는 _text_)
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 취소선 (~~text~~)
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // 자동 URL 링크 — href/src 속성 안의 URL은 제외 (lookbehind로 " = ' 뒤 URL 건너뜀)
    text = text.replace(/(?<![="'(])(https?:\/\/[^\s&<>"]+)/g, '<a href="$1">$1</a>');

    // 인라인 코드 플레이스홀더 복원
    text = text.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[parseInt(i)]);

    return text;
  }

  // 코드블록 추출 (파싱 전 플레이스홀더로 대체)
  function extractCodeBlocks(lines) {
    const codeBlocks = [];
    const result = [];
    let inCodeBlock = false;
    let codeLines = [];
    let codeLang = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fenceMatch = line.match(/^(`{3,}|~{3,})\s*(\w*)/);

      if (!inCodeBlock && fenceMatch) {
        inCodeBlock = true;
        codeLang = fenceMatch[2] || '';
        codeLines = [];
      } else if (inCodeBlock && line.match(/^(`{3,}|~{3,})\s*$/)) {
        inCodeBlock = false;
        const placeholder = `\x00CODE_BLOCK_${codeBlocks.length}\x00`;
        const langLabel = codeLang ? `<span class="code-lang">${escapeHtml(codeLang)}</span>` : '';
        const codeContent = escapeHtml(codeLines.join('\n'));
        codeBlocks.push(`<pre>${langLabel}<code class="language-${escapeHtml(codeLang)}">${codeContent}</code></pre>`);
        result.push(placeholder);
        codeLines = [];
        codeLang = '';
      } else if (inCodeBlock) {
        codeLines.push(line);
      } else {
        result.push(line);
      }
    }

    // 닫히지 않은 코드블록 처리
    if (inCodeBlock && codeLines.length > 0) {
      const placeholder = `\x00CODE_BLOCK_${codeBlocks.length}\x00`;
      const langLabel = codeLang ? `<span class="code-lang">${escapeHtml(codeLang)}</span>` : '';
      const codeContent = escapeHtml(codeLines.join('\n'));
      codeBlocks.push(`<pre>${langLabel}<code class="language-${escapeHtml(codeLang)}">${codeContent}</code></pre>`);
      result.push(placeholder);
    }

    return { lines: result, codeBlocks };
  }

  // 목록 파싱 (중첩 지원, 최대 깊이 제한)
  function parseList(lines, startIndex, _depth = 0) {
    // 깊이 초과 시 빈 결과 반환
    if (_depth > MAX_DEPTH) return { html: '', nextIndex: startIndex + 1 };

    const items = [];
    let i = startIndex;
    const firstLine = lines[i];
    const isOrdered = /^\d+\.\s/.test(firstLine);
    const baseIndent = firstLine.match(/^(\s*)/)[1].length;

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        i++;
        break;
      }

      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1].length : 0;

      if (indent < baseIndent) break;

      const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
      const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
      const match = ulMatch || olMatch;

      if (!match || match[1].length !== baseIndent) {
        if (indent > baseIndent && items.length > 0) {
          const lastItem = items[items.length - 1];
          const subResult = parseList(lines, i, _depth + 1);
          lastItem.children = subResult.html;
          i = subResult.nextIndex;
        } else {
          break;
        }
        continue;
      }

      items.push({ text: match[2], children: null });
      i++;

      // 중첩 목록 확인
      if (i < lines.length) {
        const nextLine = lines[i];
        const nextIndent = nextLine.match(/^(\s*)/)[1].length;
        if (nextIndent > baseIndent && (nextLine.match(/^\s*[-*+]\s/) || nextLine.match(/^\s*\d+\.\s/))) {
          const subResult = parseList(lines, i, _depth + 1);
          items[items.length - 1].children = subResult.html;
          i = subResult.nextIndex;
        }
      }
    }

    const tag = isOrdered ? 'ol' : 'ul';
    const html = `<${tag}>\n${items.map(item => {
      const childContent = item.children ? `\n${item.children}` : '';
      return `<li>${parseInline(item.text)}${childContent}</li>`;
    }).join('\n')}\n</${tag}>`;

    return { html, nextIndex: i };
  }

  // 인용문 파싱 (중첩 지원, 깊이를 parse()에 전달)
  function parseBlockquote(lines, startIndex, _depth) {
    const quoteLines = [];
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];
      if (/^>/.test(line)) {
        quoteLines.push(line.replace(/^>\s?/, ''));
        i++;
      } else if (line.trim() === '' && i + 1 < lines.length && /^>/.test(lines[i + 1])) {
        quoteLines.push('');
        i++;
      } else {
        break;
      }
    }

    // 재귀적으로 인용문 내부 파싱 (깊이 증가)
    const innerHtml = parse(quoteLines.join('\n'), _depth + 1);
    return { html: `<blockquote>\n${innerHtml}\n</blockquote>`, nextIndex: i };
  }

  // 메인 파싱 함수
  function parse(markdown, _depth = 0) {
    if (!markdown) return '';

    // 깊이 초과 시 원본 텍스트를 안전하게 이스케이프하여 반환
    if (_depth > MAX_DEPTH) return `<p>${escapeHtml(String(markdown))}</p>`;

    // \x00 널 바이트 제거 (플레이스홀더 충돌 방지)
    const sanitized = String(markdown).replace(/\x00/g, '');

    // 줄 단위로 분리
    const rawLines = sanitized.split('\n');

    // 코드블록 먼저 추출
    const { lines, codeBlocks } = extractCodeBlocks(rawLines);

    const outputParts = [];
    let i = 0;
    let paragraphLines = [];

    function flushParagraph() {
      if (paragraphLines.length === 0) return;
      const content = paragraphLines.join('\n');
      // 줄바꿈(두 스페이스+줄바꿈, 백슬래시+줄바꿈)을 플레이스홀더로 치환
      // → parseInline 내부의 < 이스케이프가 <br> 을 건드리지 않도록 보호
      const processed = content
        .replace(/  \n/g, '\x00BR\x00\n')
        .replace(/\\\n/g, '\x00BR\x00\n');
      const parsed = parseInline(processed).replace(/\x00BR\x00/g, '<br>');
      outputParts.push(`<p>${parsed}</p>`);
      paragraphLines = [];
    }

    while (i < lines.length) {
      const line = lines[i];

      // 코드블록 플레이스홀더
      if (/^\x00CODE_BLOCK_\d+\x00$/.test(line)) {
        flushParagraph();
        const idx = parseInt(line.match(/\d+/)[0]);
        outputParts.push(codeBlocks[idx]);
        i++;
        continue;
      }

      // 빈 줄
      if (line.trim() === '') {
        flushParagraph();
        i++;
        continue;
      }

      // ATX 제목 (# ~ ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
      if (headingMatch) {
        flushParagraph();
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const id = makeHeadingId(text);
        outputParts.push(`<h${level} id="${id}">${parseInline(text)}</h${level}>`);
        i++;
        continue;
      }

      // Setext 제목 (다음 줄이 === 또는 ---)
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (/^=+\s*$/.test(nextLine) && line.trim()) {
          flushParagraph();
          const id = makeHeadingId(line.trim());
          outputParts.push(`<h1 id="${id}">${parseInline(line.trim())}</h1>`);
          i += 2;
          continue;
        }
        // Setext H2: 최소 3개 이상의 대시가 있어야 인식
        // (2개 이하는 단순 텍스트로 처리하여 오탐 방지)
        if (/^-{3,}\s*$/.test(nextLine) && line.trim() && !(/^[-*+]\s/.test(line))) {
          flushParagraph();
          const id = makeHeadingId(line.trim());
          outputParts.push(`<h2 id="${id}">${parseInline(line.trim())}</h2>`);
          i += 2;
          continue;
        }
      }

      // 수평선 (---, ***, ___)
      if (/^(\s*[-*_]){3,}\s*$/.test(line) && !(/^[-*+]\s/.test(line))) {
        flushParagraph();
        outputParts.push('<hr>');
        i++;
        continue;
      }

      // 인용문
      if (/^>/.test(line)) {
        flushParagraph();
        const result = parseBlockquote(lines, i, _depth);
        outputParts.push(result.html);
        i = result.nextIndex;
        continue;
      }

      // 목록
      if (/^(\s*)[-*+]\s/.test(line) || /^(\s*)\d+\.\s/.test(line)) {
        flushParagraph();
        const result = parseList(lines, i, _depth);
        outputParts.push(result.html);
        i = result.nextIndex;
        continue;
      }

      // 일반 텍스트 → 문단으로 수집
      paragraphLines.push(line);
      i++;
    }

    flushParagraph();

    return outputParts.join('\n');
  }

  return { parse, parseInline, escapeHtml };
})();
