/**
 * 마크다운 파서 - 외부 라이브러리 없이 구현
 * 지원: 제목, 굵게/기울임, 인라인 코드, 코드 블록, 링크, 이미지,
 *       순서/비순서 목록(중첩), 인용구(중첩), 수평선, 단락, 줄바꿈, 이스케이프
 */

const MarkdownParser = (() => {
  // 이스케이프 가능한 특수문자 목록
  const ESCAPABLE = /\\([\\`*_{}\[\]()#+\-.!|])/g;

  // HTML 특수문자를 엔티티로 변환 (XSS 방지)
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 위험한 URL 프로토콜 차단 (XSS 방지)
  // javascript:, data:, vbscript: 등 인라인 스크립트 실행 가능한 URI 스킴을 무해한 값으로 대체
  function sanitizeUrl(url) {
    const trimmed = url.trim().toLowerCase().replace(/[\s\r\n\t]/g, '');
    if (/^(javascript|data|vbscript):/.test(trimmed)) return '#';
    return url;
  }

  // 인라인 요소 파싱 (굵게, 기울임, 인라인 코드, 링크, 이미지)
  // 주의: parseInlineBasic은 이미 HTML 이스케이프된 텍스트를 인자로 받는다고 가정
  function parseInline(text) {
    // 인라인 코드 블록 (백틱)을 먼저 보호
    const codeMap = new Map();
    let codeIdx = 0;
    text = text.replace(/(`+)([\s\S]*?)\1/g, (_, ticks, content) => {
      const key = `\x00CODE${codeIdx++}\x00`;
      codeMap.set(key, `<code>${escapeHtml(content)}</code>`);
      return key;
    });

    // 원시 HTML 이스케이프 (XSS 방지) — 인라인 코드 보호 후, 마크다운 패턴 처리 전
    text = text.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
    text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 이미지 ![alt](url "title")
    text = text.replace(/!\[([^\]]*)\]\(([^)"]*?)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(sanitizeUrl(src))}" alt="${escapeHtml(alt)}"${titleAttr}>`;
    });

    // 링크 [text](url "title")
    text = text.replace(/\[([^\]]*)\]\(([^)"]*?)(?:\s+"([^"]*)")?\)/g, (_, linkText, href, title) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(sanitizeUrl(href))}"${titleAttr} target="_blank" rel="noopener noreferrer">${parseInlineBasic(linkText)}</a>`;
    });

    // 굵게+기울임 ***text*** 또는 ___text___
    text = text.replace(/(\*{3}|_{3})(?!\s)([\s\S]*?)(?<!\s)\1/g, (_, __, content) => {
      return `<strong><em>${parseInlineBasic(content)}</em></strong>`;
    });

    // 굵게 **text** 또는 __text__
    text = text.replace(/(\*{2}|_{2})(?!\s)([\s\S]*?)(?<!\s)\1/g, (_, __, content) => {
      return `<strong>${parseInlineBasic(content)}</strong>`;
    });

    // 기울임 *text* 또는 _text_
    text = text.replace(/(\*|_)(?!\s)([\s\S]*?)(?<!\s)\1/g, (_, __, content) => {
      return `<em>${parseInlineBasic(content)}</em>`;
    });

    // 취소선 ~~text~~ (이 시점 content는 이미 이스케이프됨)
    text = text.replace(/~~([\s\S]*?)~~/g, (_, content) => {
      return `<del>${content}</del>`;
    });

    // 줄바꿈: 줄 끝 공백 2개 또는 \
    text = text.replace(/  \n/g, '<br>\n');
    text = text.replace(/\\\n/g, '<br>\n');
    // 나머지 줄바꿈은 공백으로 (단락 내 연속 줄)
    text = text.replace(/\n/g, ' ');

    // 인라인 코드 복원
    for (const [key, val] of codeMap) {
      text = text.split(key).join(val);
    }

    return text;
  }

  // 재귀 없는 간단한 인라인 파싱 (링크/강조 내부 텍스트 등에 사용)
  // 호출 시점에 이미 HTML 이스케이프가 완료된 텍스트를 받는다
  function parseInlineBasic(text) {
    text = text.replace(/(\*{3}|_{3})(?!\s)([\s\S]*?)(?<!\s)\1/g, (_, __, c) => `<strong><em>${c}</em></strong>`);
    text = text.replace(/(\*{2}|_{2})(?!\s)([\s\S]*?)(?<!\s)\1/g, (_, __, c) => `<strong>${c}</strong>`);
    text = text.replace(/(\*|_)(?!\s)([\s\S]*?)(?<!\s)\1/g, (_, __, c) => `<em>${c}</em>`);
    return text;
  }

  // 목록 파싱 (순서/비순서, 중첩 지원)
  function parseLists(lines) {
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 비순서 목록 항목 감지
      const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
      // 순서 목록 항목 감지
      const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);

      if (ulMatch || olMatch) {
        const isOrdered = !!olMatch;
        const match = ulMatch || olMatch;
        const baseIndent = match[1].length;

        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const ulM = l.match(/^(\s*)[-*+]\s+(.*)/);
          const olM = l.match(/^(\s*)\d+\.\s+(.*)/);
          const m = ulM || olM;

          if (!m) break;

          const indent = m[1].length;
          if (indent < baseIndent) break;

          if (indent === baseIndent) {
            items.push({ indent, content: m[2], children: [] });
            i++;
          } else {
            // 중첩 항목: 이전 아이템의 children에 추가
            if (items.length > 0) {
              items[items.length - 1].children.push(l);
            }
            i++;
          }
        }

        const tag = isOrdered ? 'ol' : 'ul';
        const html = renderList(items, tag);
        result.push(html);
      } else {
        result.push(line);
        i++;
      }
    }

    return result;
  }

  function renderList(items, tag) {
    const listItems = items.map(item => {
      let content = parseInline(item.content);
      if (item.children.length > 0) {
        const childLines = item.children;
        const childResult = parseLists(childLines);
        content += '\n' + childResult.join('\n');
      }
      return `<li>${content}</li>`;
    });
    return `<${tag}>\n${listItems.join('\n')}\n</${tag}>`;
  }

  // 인용구 파싱 (중첩 지원)
  function parseBlockquotes(text) {
    // 재귀로 중첩 인용구 처리: > 접두사를 한 겹씩 제거하면서 안쪽을 재파싱
    return text.replace(/^((?:[ \t]*>[ \t]?.*\n?)+)/gm, (match) => {
      // > 를 하나씩 벗기기
      const inner = match.replace(/^[ \t]*>[ \t]?/gm, '');
      // 재귀 처리 후 인라인 서식 적용 (이미 HTML 태그로 시작하는 줄은 건너뜀)
      const processed = parseBlockquotes(inner);
      const withInline = processed.replace(/^(?!<\w)(.+)$/gm, (line) => parseInline(line));
      return `<blockquote>\n${withInline}</blockquote>\n`;
    });
  }

  // 수평선 파싱
  function parseHorizontalRules(text) {
    return text.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '<hr>');
  }

  // 제목 파싱 (ATX 스타일)
  function parseHeadings(text) {
    return text.replace(/^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/gm, (_, hashes, content) => {
      const level = hashes.length;
      // id: 소문자 변환, ASCII 비문자 제거, 공백을 하이픈으로 치환 후 HTML 이스케이프
      const rawId = content.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      const id = escapeHtml(rawId);
      return `<h${level} id="${id}">${parseInline(content)}</h${level}>`;
    });
  }

  // 단락 파싱 (빈 줄로 구분)
  function parseParagraphs(blocks) {
    return blocks.map(block => {
      // 이미 블록 레벨 HTML 태그로 시작하면 그대로 반환
      if (/^<(h[1-6]|ul|ol|li|blockquote|pre|hr|div)[\s>]/.test(block.trim())) {
        return block;
      }
      if (block.trim() === '') return '';
      return `<p>${parseInline(block.trim())}</p>`;
    }).filter(b => b !== '');
  }

  // 메인 파싱 함수
  function parse(markdown) {
    if (!markdown) return '';

    // 이스케이프 상태: parse 호출마다 새로 생성하여 재진입 오염 방지
    const escapeMap = new Map();
    let escapeCounter = 0;

    // 줄 끝 정규화
    let text = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 이스케이프 문자 보호 (백슬래시 이스케이프)
    text = text.replace(ESCAPABLE, (_, ch) => {
      const key = `\x00ESC${escapeCounter++}\x00`;
      escapeMap.set(key, escapeHtml(ch));
      return key;
    });

    // 1단계: 코드 블록 추출 및 보호 (파싱 중 내용 변환 방지)
    const codeBlockMap = new Map();
    let cbIdx = 0;
    text = text.replace(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm, (match, fence, lang, code) => {
      const key = `\x00CB${cbIdx++}\x00`;
      const langClass = lang.trim() ? ` class="language-${escapeHtml(lang.trim())}"` : '';
      const langLabel = lang.trim() ? `<span class="code-lang">${escapeHtml(lang.trim())}</span>` : '';
      codeBlockMap.set(key, `<div class="code-block-wrapper">${langLabel}<pre><code${langClass}>${escapeHtml(code)}</code></pre></div>`);
      return key;
    });

    // 2단계: 수평선 파싱
    text = parseHorizontalRules(text);

    // 3단계: 제목 파싱
    text = parseHeadings(text);

    // 4단계: 인용구 파싱
    text = parseBlockquotes(text);

    // 5단계: 목록 파싱 (줄 단위)
    const lines = text.split('\n');
    const processedLines = parseLists(lines);
    text = processedLines.join('\n');

    // 6단계: 코드 블록 복원
    for (const [key, val] of codeBlockMap) {
      text = text.split(key).join(val);
    }

    // 7단계: 빈 줄 기준으로 블록 분리 후 단락 처리
    const blocks = text.split(/\n{2,}/);
    const parsed = parseParagraphs(blocks);
    text = parsed.join('\n\n');

    // 8단계: 이스케이프 복원
    for (const [key, val] of escapeMap) {
      text = text.split(key).join(val);
    }

    return text;
  }

  return { parse };
})();
