/**
 * markdown-parser.js
 * 외부 라이브러리 없이 구현한 마크다운 파서
 *
 * 지원 기능:
 * - 제목 (h1~h6)
 * - 굵게, 기울임, 굵은 기울임
 * - 인라인 코드
 * - 코드 블록 (언어 레이블 포함)
 * - 링크, 이미지
 * - 순서 없는/있는 목록 (중첩 포함)
 * - 인용구 (중첩 포함)
 * - 수평선
 * - 문단, 줄바꿈
 * - 이스케이프 문자
 */

const MarkdownParser = (() => {
  // HTML 특수문자 이스케이프 (XSS 방지)
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 위험한 URI 스킴 차단 (javascript:, vbscript:, data:)
  // HTML 엔티티 디코딩 후 실제 스킴을 확인한다
  function isSafeUrl(url) {
    const decoded = url
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
      .replace(/&#x([\da-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)));
    const trimmed = decoded.trim().toLowerCase();
    return !/^(javascript|vbscript|data):/i.test(trimmed);
  }

  // 이스케이프된 마크다운 문자를 플레이스홀더로 변환
  function protectEscapes(text) {
    return text.replace(/\\([\\`*_{}[\]()#+\-.!~|])/g, (match, char) => {
      return `\x00ESC${char.charCodeAt(0)}\x00`;
    });
  }

  // 플레이스홀더를 실제 문자로 복원
  function restoreEscapes(text) {
    return text.replace(/\x00ESC(\d+)\x00/g, (match, code) => {
      return escapeHtml(String.fromCharCode(Number(code)));
    });
  }

  // 인라인 요소 파싱 (굵게, 기울임, 코드, 링크, 이미지 등)
  function parseInline(text) {
    text = protectEscapes(text);

    // SECURITY: 모든 원시 텍스트의 HTML 특수문자를 먼저 이스케이프한다.
    // protectEscapes 플레이스홀더(\x00ESC...\x00)는 HTML 특수문자를 포함하지 않으므로
    // 이스케이프 이후에도 안전하게 남는다. 이후 regex 변환은 직접 HTML 태그를
    // 생성하므로 캡처 그룹($1)을 재이스케이프하지 않는다.
    text = escapeHtml(text);

    // 인라인 코드 — 내용은 이미 이스케이프됨
    text = text.replace(/`([^`\n]+?)`/g, '<code>$1</code>');

    // 이미지: ![alt](url "title") — escapeHtml 이후이므로 " → &quot; 로 변환됨, 위험 스킴 차단
    text = text.replace(/!\[([^\]]*)\]\(([^)]+?)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, alt, src, title) => {
      if (!isSafeUrl(src)) return match;
      const titleAttr = title ? ` title="${title}"` : '';
      return `<img src="${src}" alt="${alt}"${titleAttr}>`;
    });

    // 링크: [text](url "title") — escapeHtml 이후이므로 " → &quot; 로 변환됨, 위험 스킴 차단
    text = text.replace(/\[([^\]]+)\]\(([^)]+?)(?:\s+&quot;([^&]*)&quot;)?\)/g, (match, linkText, href, title) => {
      if (!isSafeUrl(href)) return match;
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}" rel="noopener noreferrer"${titleAttr}>${linkText}</a>`;
    });

    // 굵은 기울임: ***text*** 또는 ___text___
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

    // 굵게: **text** 또는 __text__
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 기울임: *text* 또는 _text_
    text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_\n]+?)_/g, '<em>$1</em>');

    // ~~취소선~~
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // 줄바꿈: 두 개 이상의 공백 + 줄바꿈 또는 백슬래시 + 줄바꿈
    text = text.replace(/  +\n/g, '<br>\n');
    text = text.replace(/\\\n/g, '<br>\n');

    text = restoreEscapes(text);
    return text;
  }

  // 목록 파싱 (중첩 지원)
  function parseList(lines, startIndex, baseIndent) {
    let html = '';
    let i = startIndex;
    let listType = null;

    while (i < lines.length) {
      const line = lines[i];

      // 빈 줄: 목록 종료 가능성 체크
      if (line.trim() === '') {
        // 다음 줄이 같은 들여쓰기의 목록 항목이면 계속
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextIndent = nextLine.match(/^(\s*)/)[1].length;
          const isNextListItem = /^(\s*)([-*+]|\d+[.)]) /.test(nextLine);
          if (isNextListItem && nextIndent >= baseIndent) {
            i++;
            continue;
          }
        }
        break;
      }

      // 현재 줄의 들여쓰기 계산
      const currentIndent = line.match(/^(\s*)/)[1].length;

      // 기본 들여쓰기보다 적으면 종료
      if (currentIndent < baseIndent) {
        break;
      }

      // 중첩 목록 처리
      if (currentIndent > baseIndent) {
        const nestedResult = parseList(lines, i, currentIndent);
        html += nestedResult.html;
        i = nestedResult.nextIndex;
        continue;
      }

      // 순서 없는 목록 항목
      const ulMatch = line.match(/^(\s*)([-*+]) (.*)$/);
      if (ulMatch) {
        if (listType !== 'ul') {
          if (listType !== null) {
            html += listType === 'ol' ? '</ol>' : '</ul>';
          }
          listType = 'ul';
          html += '<ul>';
        }
        html += `<li>${parseInline(ulMatch[3])}`;

        // 다음 줄이 더 깊은 들여쓰기인지 확인
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextIndent = nextLine.match(/^(\s*)/)[1].length;
          if (nextIndent > currentIndent && /^(\s*)([-*+]|\d+[.)]) /.test(nextLine)) {
            const nestedResult = parseList(lines, i + 1, nextIndent);
            html += nestedResult.html;
            i = nestedResult.nextIndex;
          } else {
            i++;
          }
        } else {
          i++;
        }
        html += '</li>';
        continue;
      }

      // 순서 있는 목록 항목
      const olMatch = line.match(/^(\s*)(\d+)[.)]\s(.*)$/);
      if (olMatch) {
        if (listType !== 'ol') {
          if (listType !== null) {
            html += listType === 'ul' ? '</ul>' : '</ol>';
          }
          listType = 'ol';
          html += '<ol>';
        }
        html += `<li>${parseInline(olMatch[3])}`;

        // 다음 줄이 더 깊은 들여쓰기인지 확인
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextIndent = nextLine.match(/^(\s*)/)[1].length;
          if (nextIndent > currentIndent && /^(\s*)([-*+]|\d+[.)]) /.test(nextLine)) {
            const nestedResult = parseList(lines, i + 1, nextIndent);
            html += nestedResult.html;
            i = nestedResult.nextIndex;
          } else {
            i++;
          }
        } else {
          i++;
        }
        html += '</li>';
        continue;
      }

      // 목록 항목이 아닌 줄
      break;
    }

    if (listType === 'ul') html += '</ul>';
    if (listType === 'ol') html += '</ol>';

    return { html, nextIndex: i };
  }

  // 인용구 파싱 (중첩 지원)
  function parseBlockquote(lines, startIndex) {
    let innerLines = [];
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];
      if (/^> ?/.test(line)) {
        innerLines.push(line.replace(/^> ?/, ''));
        i++;
      } else if (line.trim() === '' && i + 1 < lines.length && /^> ?/.test(lines[i + 1])) {
        innerLines.push('');
        i++;
      } else {
        break;
      }
    }

    const innerHtml = parse(innerLines.join('\n'));
    return { html: `<blockquote>${innerHtml}</blockquote>`, nextIndex: i };
  }

  // 코드 블록 파싱 (fenceChar: '`' 또는 '~')
  function parseCodeBlock(lines, startIndex, lang, fenceChar) {
    const fencePrefix = fenceChar === '~' ? '~~~' : '```';
    let codeLines = [];
    let i = startIndex + 1;

    while (i < lines.length && !lines[i].startsWith(fencePrefix)) {
      codeLines.push(lines[i]);
      i++;
    }

    // 닫는 펜스를 찾지 못한 경우: 여는 줄을 일반 텍스트로 처리
    if (i >= lines.length) {
      return {
        html: `<p>${escapeHtml(lines[startIndex])}</p>\n`,
        nextIndex: startIndex + 1,
      };
    }

    const code = escapeHtml(codeLines.join('\n'));
    const langLabel = lang
      ? `<span class="code-lang-label">${escapeHtml(lang)}</span>`
      : '';
    const html = `<div class="code-block-wrapper">${langLabel}<pre><code>${code}</code></pre></div>`;

    return { html, nextIndex: i + 1 };
  }

  // 들여쓰기 코드 블록 파싱 (공백 4개 또는 탭)
  function parseIndentedCodeBlock(lines, startIndex) {
    let codeLines = [];
    let i = startIndex;

    while (i < lines.length && /^(    |\t)/.test(lines[i])) {
      codeLines.push(lines[i].replace(/^(    |\t)/, ''));
      i++;
    }

    const code = escapeHtml(codeLines.join('\n'));
    return { html: `<pre><code>${code}</code></pre>`, nextIndex: i };
  }

  // 메인 파서
  function parse(markdown) {
    if (!markdown || markdown.trim() === '') {
      return '';
    }

    const lines = markdown.split('\n');
    let html = '';
    let i = 0;
    let paragraphLines = [];

    // 누적된 문단 줄을 HTML로 변환
    function flushParagraph() {
      if (paragraphLines.length === 0) return;
      const content = paragraphLines.join('\n').trim();
      if (content) {
        html += `<p>${parseInline(content)}</p>\n`;
      }
      paragraphLines = [];
    }

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // 빈 줄: 문단 구분
      if (trimmed === '') {
        flushParagraph();
        i++;
        continue;
      }

      // 코드 블록 (``` 또는 ~~~)
      const fencedCodeMatch = line.match(/^(`{3,}|~{3,})(\w+)?/);
      if (fencedCodeMatch) {
        flushParagraph();
        const fenceChar = fencedCodeMatch[1][0]; // '`' 또는 '~'
        const lang = fencedCodeMatch[2] || '';
        const result = parseCodeBlock(lines, i, lang, fenceChar);
        html += result.html + '\n';
        i = result.nextIndex;
        continue;
      }

      // 들여쓰기 코드 블록
      if (/^(    |\t)/.test(line)) {
        flushParagraph();
        const result = parseIndentedCodeBlock(lines, i);
        html += result.html + '\n';
        i = result.nextIndex;
        continue;
      }

      // 제목 (ATX 스타일: # ~ ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
      if (headingMatch) {
        flushParagraph();
        const level = headingMatch[1].length;
        const content = parseInline(headingMatch[2].trim());
        html += `<h${level}>${content}</h${level}>\n`;
        i++;
        continue;
      }

      // 수평선 (---, ***, ___)
      if (/^(?:[-*_]){3,}\s*$/.test(trimmed)) {
        flushParagraph();
        html += '<hr>\n';
        i++;
        continue;
      }

      // Setext 스타일 제목 (=== 또는 ---)
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (/^=+\s*$/.test(nextLine) && trimmed) {
          flushParagraph();
          html += `<h1>${parseInline(trimmed)}</h1>\n`;
          i += 2;
          continue;
        }
        if (/^-+\s*$/.test(nextLine) && trimmed && nextLine.length >= 2) {
          flushParagraph();
          html += `<h2>${parseInline(trimmed)}</h2>\n`;
          i += 2;
          continue;
        }
      }

      // 인용구
      if (/^> ?/.test(line)) {
        flushParagraph();
        const result = parseBlockquote(lines, i);
        html += result.html + '\n';
        i = result.nextIndex;
        continue;
      }

      // 목록 (순서 없는/있는)
      if (/^(\s*)([-*+]|\d+[.)]) /.test(line)) {
        flushParagraph();
        const baseIndent = line.match(/^(\s*)/)[1].length;
        const result = parseList(lines, i, baseIndent);
        html += result.html + '\n';
        i = result.nextIndex;
        continue;
      }

      // 일반 텍스트: 문단에 추가
      paragraphLines.push(line);
      i++;
    }

    // 남은 문단 처리
    flushParagraph();

    return html;
  }

  return { parse };
})();
