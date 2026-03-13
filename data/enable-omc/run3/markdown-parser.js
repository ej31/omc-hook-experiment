/**
 * 마크다운 파서 - 외부 라이브러리 없이 구현한 완전한 마크다운 파서
 * 지원: 제목, 굵게, 기울임, 인라인 코드, 코드 블록, 링크, 이미지,
 *       순서 있는/없는 목록(중첩), 인용문(중첩), 수평선, 단락, 줄바꿈, 이스케이프
 */

const MarkdownParser = (() => {
  // 이스케이프 처리: 특수 문자를 HTML 엔티티로 변환
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 이스케이프 문자 처리 (\* \_ \` 등)
  const ESCAPE_PLACEHOLDER = '\x00ESC\x00';
  const escapeMap = {};
  let escapeIndex = 0;

  function storeEscape(char) {
    const key = `${ESCAPE_PLACEHOLDER}${escapeIndex++}${ESCAPE_PLACEHOLDER}`;
    escapeMap[key] = escapeHtml(char);
    return key;
  }

  function restoreEscapes(text) {
    return text.replace(new RegExp(`${ESCAPE_PLACEHOLDER}\\d+${ESCAPE_PLACEHOLDER}`, 'g'), (key) => escapeMap[key] || key);
  }

  function processEscapes(text) {
    return text.replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, (_, char) => storeEscape(char));
  }

  // 코드 블록 임시 저장소 (인라인 파싱 방지)
  const codeBlocks = [];
  const CODE_BLOCK_PLACEHOLDER = '\x00CODE\x00';

  function storeCodeBlock(html) {
    const idx = codeBlocks.length;
    codeBlocks.push(html);
    return `${CODE_BLOCK_PLACEHOLDER}${idx}${CODE_BLOCK_PLACEHOLDER}`;
  }

  function restoreCodeBlocks(text) {
    return text.replace(new RegExp(`${CODE_BLOCK_PLACEHOLDER}(\\d+)${CODE_BLOCK_PLACEHOLDER}`, 'g'), (_, i) => codeBlocks[parseInt(i, 10)] || '');
  }

  // 인라인 코드 임시 저장소
  const inlineCodes = [];
  const INLINE_CODE_PLACEHOLDER = '\x00ICODE\x00';

  function storeInlineCode(html) {
    const idx = inlineCodes.length;
    inlineCodes.push(html);
    return `${INLINE_CODE_PLACEHOLDER}${idx}${INLINE_CODE_PLACEHOLDER}`;
  }

  function restoreInlineCodes(text) {
    return text.replace(new RegExp(`${INLINE_CODE_PLACEHOLDER}(\\d+)${INLINE_CODE_PLACEHOLDER}`, 'g'), (_, i) => inlineCodes[parseInt(i, 10)] || '');
  }

  // 인라인 요소 파싱 (굵게, 기울임, 코드, 링크, 이미지)
  function parseInline(text) {
    // 인라인 코드 먼저 추출 (다른 파싱에서 건드리지 않도록)
    text = text.replace(/`([^`]+)`/g, (_, code) => storeInlineCode(`<code>${escapeHtml(code)}</code>`));

    // 일반 텍스트의 HTML 특수문자 이스케이프 (코드 플레이스홀더는 null바이트로 보호됨)
    text = escapeHtml(text);

    // 이미지 (링크보다 먼저) - text가 이미 이스케이프됐으므로 추가 escapeHtml 불필요
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}">`);

    // 링크
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);

    // 굵게 + 기울임 (***text***)
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

    // 굵게 (**text** or __text__)
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // 기울임 (*text* or _text_)
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 인라인 코드 복원
    text = restoreInlineCodes(text);

    return text;
  }

  // 줄 끝 줄바꿈 (두 칸 공백 + 줄바꿈)
  function processLineBreaks(text) {
    return text.replace(/  \n/g, '<br>\n').replace(/  $/g, '<br>');
  }

  // 목록 파싱 (중첩 포함)
  function parseList(lines, startIndex, baseIndent) {
    const items = [];
    let i = startIndex;
    let listType = null;

    while (i < lines.length) {
      const line = lines[i];
      const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.+)/);
      const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
      const match = unorderedMatch || orderedMatch;

      if (!match) break;

      const indent = match[1].length;
      if (indent < baseIndent) break;

      const currentType = unorderedMatch ? 'ul' : 'ol';
      if (listType === null) listType = currentType;
      // 목록 타입이 바뀌면 새 목록으로 처리하기 위해 중단
      if (currentType !== listType && indent === baseIndent) break;

      if (indent === baseIndent) {
        const content = match[3];
        const item = { content, children: null };

        // 다음 줄에 중첩 목록이 있는지 확인
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextUnordered = nextLine.match(/^(\s*)([-*+])\s+(.+)/);
          const nextOrdered = nextLine.match(/^(\s*)(\d+)\.\s+(.+)/);
          const nextMatch = nextUnordered || nextOrdered;

          if (nextMatch && nextMatch[1].length > baseIndent) {
            const [childHtml, consumed] = parseList(lines, i + 1, nextMatch[1].length);
            item.children = childHtml;
            i += consumed;
          }
        }

        items.push(item);
        i++;
      } else {
        // 더 깊은 들여쓰기는 상위에서 처리
        break;
      }
    }

    const tag = listType || 'ul';
    const html = `<${tag}>\n${items.map(item => {
      const childPart = item.children ? `\n${item.children}` : '';
      return `<li>${parseInline(item.content)}${childPart}</li>`;
    }).join('\n')}\n</${tag}>`;

    return [html, i - startIndex];
  }

  // 인용문 파싱 (중첩 포함)
  function parseBlockquote(lines) {
    const innerLines = lines.map(line => line.replace(/^>\s?/, ''));

    // 재귀 parse() 호출 전 공유 상태 저장
    // parse()는 escapeMap/codeBlocks/inlineCodes를 초기화하므로
    // 외부 parse()가 이미 처리한 이스케이프 플레이스홀더가 손실되는 것을 방지
    const savedEscapeIndex = escapeIndex;
    const savedEscapeMap = Object.assign({}, escapeMap);
    const savedCodeBlocks = codeBlocks.slice();
    const savedInlineCodes = inlineCodes.slice();

    const inner = parse(innerLines.join('\n'));

    // 외부 공유 상태 복원
    escapeIndex = savedEscapeIndex;
    Object.keys(escapeMap).forEach(k => delete escapeMap[k]);
    Object.assign(escapeMap, savedEscapeMap);
    codeBlocks.length = 0;
    savedCodeBlocks.forEach(b => codeBlocks.push(b));
    inlineCodes.length = 0;
    savedInlineCodes.forEach(c => inlineCodes.push(c));

    return `<blockquote>\n${inner}\n</blockquote>`;
  }

  // 헤딩 레벨 파싱
  function parseHeading(line) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (!match) return null;
    const level = match[1].length;
    const text = parseInline(match[2]);
    const id = match[2].toLowerCase().replace(/[^\w\s\u00C0-\uFFFF-]/g, '').replace(/\s+/g, '-');
    return `<h${level} id="${id}">${text}</h${level}>`;
  }

  // 메인 파싱 함수
  function parse(markdown) {
    // 초기화
    escapeIndex = 0;
    codeBlocks.length = 0;
    inlineCodes.length = 0;
    Object.keys(escapeMap).forEach(k => delete escapeMap[k]);

    // 이스케이프 문자 처리
    markdown = processEscapes(markdown);

    // 코드 블록 추출 (```lang ... ```)
    markdown = markdown.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
      const escapedCode = escapeHtml(code.replace(/\n$/, ''));
      return storeCodeBlock(`<pre>${langLabel}<code class="language-${lang || 'text'}">${escapedCode}</code></pre>`);
    });

    const lines = markdown.split('\n');
    const output = [];
    let i = 0;
    let paragraphBuffer = [];

    function flushParagraph() {
      if (paragraphBuffer.length === 0) return;
      const text = paragraphBuffer.join('\n');
      const processed = processLineBreaks(parseInline(text));
      output.push(`<p>${processed}</p>`);
      paragraphBuffer = [];
    }

    while (i < lines.length) {
      const line = lines[i];

      // 코드 블록 플레이스홀더 (이미 처리됨)
      if (line.includes(CODE_BLOCK_PLACEHOLDER)) {
        flushParagraph();
        output.push(line);
        i++;
        continue;
      }

      // 빈 줄 - 단락 구분
      if (line.trim() === '') {
        flushParagraph();
        i++;
        continue;
      }

      // 수평선 (---, ***, ___)
      if (/^([-*_])\1{2,}\s*$/.test(line.trim())) {
        flushParagraph();
        output.push('<hr>');
        i++;
        continue;
      }

      // 헤딩
      if (/^#{1,6}\s/.test(line)) {
        flushParagraph();
        const headingHtml = parseHeading(line);
        if (headingHtml) output.push(headingHtml);
        i++;
        continue;
      }

      // 인용문
      if (/^>\s?/.test(line)) {
        flushParagraph();
        const blockquoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          blockquoteLines.push(lines[i]);
          i++;
        }
        output.push(parseBlockquote(blockquoteLines));
        continue;
      }

      // 순서 없는 목록 (내용이 있는 경우만 - 빈 항목 `- ` 는 무한루프 방지)
      if (/^(\s*)([-*+])\s+\S/.test(line)) {
        flushParagraph();
        const baseIndent = line.match(/^(\s*)/)[1].length;
        const [listHtml, consumed] = parseList(lines, i, baseIndent);
        output.push(listHtml);
        i += consumed;
        continue;
      }

      // 순서 있는 목록 (내용이 있는 경우만)
      if (/^(\s*)\d+\.\s+\S/.test(line)) {
        flushParagraph();
        const baseIndent = line.match(/^(\s*)/)[1].length;
        const [listHtml, consumed] = parseList(lines, i, baseIndent);
        output.push(listHtml);
        i += consumed;
        continue;
      }

      // 일반 텍스트 - 단락 버퍼에 추가
      paragraphBuffer.push(line);
      i++;
    }

    flushParagraph();

    let result = output.join('\n');

    // 코드 블록 복원
    result = restoreCodeBlocks(result);

    // 이스케이프 문자 복원
    result = restoreEscapes(result);

    return result;
  }

  return { parse };
})();
