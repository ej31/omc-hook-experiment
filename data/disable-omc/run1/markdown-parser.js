'use strict';

class MarkdownParser {
  parse(markdown) {
    const text = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return this.parseBlocks(text);
  }

  parseBlocks(text) {
    const lines = text.split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 빈 줄 건너뜀
      if (line.trim() === '') {
        i++;
        continue;
      }

      // 펜스드 코드 블록 (```)
      if (line.match(/^```/)) {
        const lang = line.slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].match(/^```\s*$/)) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // 닫는 ``` 건너뜀
        const langAttr = lang ? ` data-language="${this.escapeAttr(lang)}"` : '';
        const langClass = lang ? ` class="language-${this.escapeAttr(lang)}"` : '';
        html += `<div class="code-block"${langAttr}><pre><code${langClass}>${this.escapeHtml(codeLines.join('\n'))}</code></pre></div>\n`;
        continue;
      }

      // 제목 (# ~ ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = this.parseInline(headingMatch[2].trim());
        const id = headingMatch[2].trim()
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '-');
        html += `<h${level} id="${id}">${content}</h${level}>\n`;
        i++;
        continue;
      }

      // 수평선 (---, ***, ___)
      if (line.match(/^(\*{3,}|-{3,}|_{3,})\s*$/)) {
        html += '<hr>\n';
        i++;
        continue;
      }

      // 인용구 (>)
      if (line.startsWith('>')) {
        const quoteLines = [];
        while (i < lines.length && lines[i].startsWith('>')) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        const quoteContent = this.parseBlocks(quoteLines.join('\n'));
        html += `<blockquote>${quoteContent}</blockquote>\n`;
        continue;
      }

      // 비순서 목록 (-, *, +)
      if (line.match(/^([-*+])\s/)) {
        const result = this.parseListBlock(lines, i, 0, false);
        html += result.html;
        i = result.nextIndex;
        continue;
      }

      // 순서 목록 (1. 2. ...)
      if (line.match(/^\d+\.\s/)) {
        const result = this.parseListBlock(lines, i, 0, true);
        html += result.html;
        i = result.nextIndex;
        continue;
      }

      // 문단 — 다른 블록 요소가 아닐 때 수집
      const paraLines = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') break;
        if (l.match(/^(#{1,6}\s|>|[-*+]\s|\d+\.\s|```|(\*{3,}|-{3,}|_{3,})\s*$)/)) break;
        paraLines.push(l);
        i++;
      }
      if (paraLines.length > 0) {
        const paraHtml = paraLines
          .map((l, idx) => {
            const isLast = idx === paraLines.length - 1;
            const hasBreak = l.endsWith('  ');
            const content = this.parseInline(hasBreak ? l.slice(0, -2) : l);
            return content + (hasBreak && !isLast ? '<br>' : '');
          })
          .join('\n');
        html += `<p>${paraHtml}</p>\n`;
      } else {
        // 어떤 핸들러도 처리하지 못한 줄 건너뜀 (무한 루프 방지)
        i++;
      }
    }

    return html;
  }

  parseListBlock(lines, startIndex, baseIndent, baseOrdered) {
    const tag = baseOrdered ? 'ol' : 'ul';
    let html = `<${tag}>\n`;
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];

      // 빈 줄은 느슨한 목록 허용을 위해 건너뜀
      if (line.trim() === '') {
        i++;
        continue;
      }

      const uMatch = line.match(/^(\s*)([-*+])\s+(.*)/);
      const oMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
      const match = uMatch || oMatch;

      if (!match) break;

      const indent = match[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) break; // 상위 중첩 처리에서 담당

      // 목록 타입이 다르면 다른 블록으로 처리
      const isItemOrdered = !!oMatch && !uMatch;
      if (isItemOrdered !== baseOrdered) break;

      const itemContent = match[3];
      let itemHtml = this.parseInline(itemContent);

      i++;

      // 중첩 목록 확인
      while (i < lines.length) {
        const nextLine = lines[i];

        if (nextLine.trim() === '') {
          // 느슨한 목록: 빈 줄 후 목록 아이템이 계속되면 포함
          if (i + 1 < lines.length) {
            const peekLine = lines[i + 1];
            const pU = peekLine.match(/^(\s+)([-*+])\s+(.*)/);
            const pO = peekLine.match(/^(\s+)(\d+)\.\s+(.*)/);
            const peekMatch = pU || pO;
            if (peekMatch && peekMatch[1].length > baseIndent) {
              i++;
              continue;
            }
          }
          break;
        }

        const nU = nextLine.match(/^(\s+)([-*+])\s+(.*)/);
        const nO = nextLine.match(/^(\s+)(\d+)\.\s+(.*)/);
        const nextMatch = nU || nO;

        if (nextMatch && nextMatch[1].length > baseIndent) {
          const isNextOrdered = !!nO && !nU;
          const nestedResult = this.parseListBlock(lines, i, nextMatch[1].length, isNextOrdered);
          itemHtml += nestedResult.html;
          i = nestedResult.nextIndex;
        } else {
          break;
        }
      }

      html += `<li>${itemHtml}</li>\n`;
    }

    html += `</${tag}>\n`;
    return { html, nextIndex: i };
  }

  parseInline(text) {
    const placeholders = [];
    const addPH = (html) => {
      const id = placeholders.length;
      placeholders.push(html);
      return `\x00${id}\x00`;
    };

    // 1. 인라인 코드 추출 (내부 처리 방지)
    text = text.replace(/`([^`]+)`/g, (_, code) => addPH(`<code>${this.escapeHtml(code)}</code>`));

    // 2. 이스케이프 문자를 플레이스홀더로 변환 (bold/italic 패턴 간섭 방지)
    text = text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, (_, ch) => addPH(`&#${ch.charCodeAt(0)};`));

    // 3. 자동 링크 추출 (< > 포함하므로 HTML 이스케이프 전에)
    text = text.replace(/<(https?:\/\/[^>]+)>/g, (_, url) =>
      addPH(`<a href="${this.escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(url)}</a>`)
    );

    // 4. 이미지 추출 (링크보다 먼저)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const parts = src.match(/^(.+?)\s+"([^"]+)"$/);
      if (parts) {
        return addPH(`<img src="${this.escapeAttr(parts[1])}" alt="${this.escapeAttr(alt)}" title="${this.escapeAttr(parts[2])}">`);
      }
      return addPH(`<img src="${this.escapeAttr(src)}" alt="${this.escapeAttr(alt)}">`);
    });

    // 5. 링크 추출
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, href) => {
      const parts = href.match(/^(.+?)\s+"([^"]+)"$/);
      if (parts) {
        return addPH(`<a href="${this.escapeAttr(parts[1])}" title="${this.escapeAttr(parts[2])}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(linkText)}</a>`);
      }
      return addPH(`<a href="${this.escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(linkText)}</a>`);
    });

    // 6. 남은 원시 텍스트의 HTML 특수문자 이스케이프 (XSS 방지)
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 7. 굵게 + 기울임 (***text*** 또는 ___text___)
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

    // 8. 굵게 (**text** 또는 __text__)
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // 9. 기울임 (*text* 또는 _text_)
    text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');

    // 10. 취소선 (~~text~~)
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // 11. 플레이스홀더 복원 (인라인 코드, 이스케이프 문자, 자동링크, 이미지, 링크)
    text = text.replace(/\x00(\d+)\x00/g, (_, id) => placeholders[parseInt(id, 10)]);

    return text;
  }

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeAttr(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
