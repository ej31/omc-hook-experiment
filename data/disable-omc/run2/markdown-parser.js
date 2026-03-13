'use strict';

const MarkdownParser = (() => {
  // 이스케이프 처리를 위한 플레이스홀더 센티넬 문자 (일반 텍스트에 거의 등장하지 않음)
  const PH_START = '\x02';
  const PH_END = '\x03';

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // [CRITICAL] javascript:, vbscript:, data: URI를 차단해 XSS 방지
  function isSafeUrl(url) {
    const stripped = url.trim().replace(/[\r\n\t\u00ad\u200b-\u200d\ufeff]/g, '');
    return !/^(javascript|vbscript|data\s*:)/i.test(stripped);
  }

  function storePlaceholder(arr, value) {
    arr.push(value);
    return `${PH_START}${arr.length - 1}${PH_END}`;
  }

  function restorePlaceholders(text, arr) {
    return text.replace(
      new RegExp(`${PH_START}(\\d+)${PH_END}`, 'g'),
      (_, i) => arr[+i]
    );
  }

  // 인라인 요소 파싱: 이스케이프, 코드, 이미지, 링크, 강조, 줄바꿈
  function parseInline(text) {
    const ph = [];

    // 1. 이스케이프 문자를 먼저 처리해야 \` 가 코드 구분자로 인식되지 않음
    text = text.replace(/\\([\\`*_{}\[\]()#+\-.!|~])/g, (_, ch) =>
      storePlaceholder(ph, escapeHtml(ch))
    );

    // 2. 인라인 코드 추출 (이스케이프 처리 후 → 보호된 백틱은 코드 구분자로 사용 안 됨)
    text = text.replace(/`([^`]+)`/g, (_, code) =>
      storePlaceholder(ph, `<code>${escapeHtml(code)}</code>`)
    );

    // 3. 남은 원시 텍스트의 HTML 특수문자 이스케이프 (XSS 방지)
    //    코드·이스케이프는 이미 플레이스홀더로 보호되어 영향 없음
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 이미지 (링크보다 먼저 처리)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, raw) => {
      const m = raw.match(/^(.+?)(?:\s+"([^"]+)")?$/);
      const src = m[1].trim();
      // [CRITICAL] 안전하지 않은 src(javascript: 등)는 이미지를 src 없이 렌더링
      if (!isSafeUrl(src)) {
        return storePlaceholder(ph, `<img alt="${escapeHtml(alt)}">`);
      }
      const title = m[2] ? ` title="${escapeHtml(m[2])}"` : '';
      return storePlaceholder(ph,
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title}>`
      );
    });

    // 링크
    // label은 3단계 HTML 이스케이프 후 이 위치에 도달하므로 <> 는 이미 &lt;&gt; 로 안전함
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, raw) => {
      const m = raw.match(/^(.+?)(?:\s+"([^"]+)")?$/);
      const href = m[1].trim();
      // [CRITICAL] javascript: 등 위험한 프로토콜 차단
      if (!isSafeUrl(href)) {
        return storePlaceholder(ph, `<a href="#">${label}</a>`);
      }
      const title = m[2] ? ` title="${escapeHtml(m[2])}"` : '';
      return storePlaceholder(ph,
        `<a href="${escapeHtml(href)}"${title}>${label}</a>`
      );
    });

    // 굵은 이탤릭 (*** 또는 ___)
    text = text.replace(/\*{3}(.+?)\*{3}/g, '<strong><em>$1</em></strong>');
    text = text.replace(/_{3}(.+?)_{3}/g, '<strong><em>$1</em></strong>');

    // 굵게 (** 또는 __)
    text = text.replace(/\*{2}(.+?)\*{2}/g, '<strong>$1</strong>');
    text = text.replace(/_{2}(.+?)_{2}/g, '<strong>$1</strong>');

    // 이탤릭 (* 또는 _)
    text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');

    // 플레이스홀더 복원
    text = restorePlaceholders(text, ph);

    // 하드 줄바꿈 (행 끝 공백 2개 이상)
    text = text.replace(/  $/gm, '<br>');

    return text;
  }

  function getIndent(line) {
    const m = line.match(/^(\s*)/);
    return m ? m[1].length : 0;
  }

  function isListItem(line) {
    return /^\s*([-*+]|\d+\.)\s/.test(line);
  }

  // 리스트 블록 재귀 파싱 (중첩 지원)
  function parseList(lines, startIdx, baseIndent, ordered) {
    const tag = ordered ? 'ol' : 'ul';
    let html = `<${tag}>\n`;
    let i = startIdx;

    while (i < lines.length) {
      const line = lines[i];

      // 빈 줄: 다음 줄이 리스트를 이어가면 계속, 아니면 종료
      if (line.trim() === '') {
        if (i + 1 < lines.length && isListItem(lines[i + 1]) &&
            getIndent(lines[i + 1]) >= baseIndent) {
          i++;
          continue;
        }
        break;
      }

      if (!isListItem(line)) break;

      const indent = getIndent(line);
      if (indent < baseIndent) break;
      if (indent > baseIndent) { i++; continue; } // 예상치 못한 깊은 들여쓰기 건너뜀

      const itemMatch = ordered
        ? line.match(/^\s*\d+\.\s+(.*)/)
        : line.match(/^\s*[-*+]\s+(.*)/);

      if (!itemMatch) { i++; continue; }

      const itemText = itemMatch[1];
      i++;

      // 중첩 리스트 확인
      let nestedHtml = '';
      if (i < lines.length && isListItem(lines[i])) {
        const nestedIndent = getIndent(lines[i]);
        if (nestedIndent > indent) {
          const nestedOrdered = /^\s*\d+\./.test(lines[i]);
          const result = parseList(lines, i, nestedIndent, nestedOrdered);
          nestedHtml = '\n' + result.html;
          i = result.nextIdx;
        }
      }

      html += `  <li>${parseInline(itemText)}${nestedHtml}</li>\n`;
    }

    html += `</${tag}>\n`;
    return { html, nextIdx: i };
  }

  // 블록 요소 파싱 (재귀 지원: blockquote 내부 처리)
  function parseBlocks(markdown) {
    const lines = markdown.split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 펜스드 코드 블록 (``` 또는 ~~~)
      const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)/);
      if (fenceMatch) {
        const fenceChar = fenceMatch[1][0];
        const fenceLen = fenceMatch[1].length;
        const lang = fenceMatch[2].trim();
        const codeLines = [];
        i++;
        while (i < lines.length) {
          const closingMatch = lines[i].match(/^(`{3,}|~{3,})\s*$/);
          if (closingMatch && closingMatch[1][0] === fenceChar &&
              closingMatch[1].length >= fenceLen) break;
          codeLines.push(lines[i]);
          i++;
        }
        i++; // 닫는 펜스 건너뜀
        const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        const langLabel = lang
          ? `<div class="code-lang-label">${escapeHtml(lang)}</div>`
          : '';
        html += `<pre class="code-block">${langLabel}<code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>\n`;
        continue;
      }

      // ATX 제목 (# ~ ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        html += `<h${level}>${parseInline(headingMatch[2].trim())}</h${level}>\n`;
        i++;
        continue;
      }

      // 수평선 (---, ***, ___)
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
        html += '<hr>\n';
        i++;
        continue;
      }

      // 인용 블록
      if (line.startsWith('>')) {
        const quoteLines = [];
        while (i < lines.length) {
          const l = lines[i];
          if (l.startsWith('>')) {
            quoteLines.push(l.replace(/^>\s?/, ''));
            i++;
          } else if (l.trim() === '') {
            // 빈 줄은 다음 줄이 인용을 이어가는 경우만 포함
            if (i + 1 < lines.length && lines[i + 1].startsWith('>')) {
              quoteLines.push('');
              i++;
            } else {
              break;
            }
          } else {
            break;
          }
        }
        html += `<blockquote>\n${parseBlocks(quoteLines.join('\n'))}</blockquote>\n`;
        continue;
      }

      // 비순서 / 순서 리스트
      if (/^\s*([-*+])\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
        const indent = getIndent(line);
        const ordered = /^\s*\d+\./.test(line);
        const result = parseList(lines, i, indent, ordered);
        html += result.html;
        i = result.nextIdx;
        continue;
      }

      // 빈 줄 건너뜀
      if (line.trim() === '') {
        i++;
        continue;
      }

      // 단락: 블록 요소가 아닌 연속 줄을 묶음
      const paraLines = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') break;
        if (/^#{1,6}\s/.test(l)) break;
        if (/^(`{3,}|~{3,})/.test(l)) break;
        if (/^>/.test(l)) break;
        if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(l.trim())) break;
        if (/^\s*([-*+])\s/.test(l) || /^\s*\d+\.\s/.test(l)) break;
        paraLines.push(l);
        i++;
      }

      if (paraLines.length > 0) {
        // 행 내부 하드 줄바꿈(공백 2개) 처리
        const parts = paraLines.map((l, idx) => {
          if (idx < paraLines.length - 1 && /  $/.test(l)) {
            return parseInline(l.replace(/\s+$/, '')) + '<br>';
          }
          return parseInline(l);
        });
        html += `<p>${parts.join('\n')}</p>\n`;
      }
    }

    return html;
  }

  return { parse: parseBlocks };
})();

// Node.js 환경에서 모듈로 내보내기
if (typeof module !== 'undefined') module.exports = MarkdownParser;
