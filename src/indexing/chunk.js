import { canonicalUrlForSourcePath, withSectionId } from './canonical-url.js';
import { cleanText, firstMatch, htmlToCleanText, sha256 } from './parse-html.js';

export function chunkHtmlPage(page, options = {}) {
  const publicBaseUrl = options.publicBaseUrl || page.public_base_url || 'https://www.w3.org/International';
  // The document URL already accounts for provisional sources that only exist
  // on GitHub Pages, so section citations build on it instead of recomputing
  // the published layout from the source path.
  const documentUrl = page.canonical_url || canonicalUrlForSourcePath(page.source_path, publicBaseUrl);
  const html = removeNonContent(page.html || '');
  const sections = extractSectionChunks(html);
  const indexedAt = new Date().toISOString();
  const rawChunks = sections.length > 0 ? sections : fallbackChunks(html);

  return rawChunks
    .map((raw, index) => {
      const sectionId = raw.section_id || `chunk-${index + 1}`;
      const text = raw.text;
      if (!text) return null;

      return {
        id: `${page.source_path}#${sectionId}`,
        document_id: page.id || page.source_path,
        chunk_id: `${page.source_path}#${sectionId}`,
        source_path: page.source_path,
        canonical_url: page.canonical_url,
        section_id: sectionId,
        section_url: withSectionId(documentUrl, sectionId),
        language: page.language,
        status: page.status,
        translation_state: page.translation_state,
        translation_group_id: page.translation_group_id,
        title: page.title || page.h1 || page.source_path,
        heading_path: raw.heading_path.length > 0 ? raw.heading_path : [page.h1 || page.title].filter(Boolean),
        text,
        text_hash: sha256(text),
        token_estimate: estimateTokens(text),
        indexed_at: indexedAt
      };
    })
    .filter(Boolean);
}

function extractSectionChunks(html) {
  const chunks = [];
  const openPattern = /<section\b([^>]*)>/gi;
  const closePattern = /<\/section\s*>/gi;
  let openMatch;

  while ((openMatch = openPattern.exec(html))) {
    const attrs = openMatch[1] || '';
    const contentStart = openMatch.index + openMatch[0].length;
    let depth = 1;
    let searchFrom = contentStart;
    let contentEnd = -1;

    while (depth > 0) {
      openPattern.lastIndex = searchFrom;
      closePattern.lastIndex = searchFrom;
      const nextOpen = openPattern.exec(html);
      const nextClose = closePattern.exec(html);

      if (!nextClose) {
        contentEnd = html.length;
        break;
      }

      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        searchFrom = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        if (depth === 0) {
          contentEnd = nextClose.index;
        } else {
          searchFrom = nextClose.index + nextClose[0].length;
        }
      }
    }

    if (contentEnd === -1) continue;

    const sectionHtml = html.slice(contentStart, contentEnd);
    const sectionId = firstMatch(attrs, /\bid=["']?([^"'\s>]+)/i);
    const heading = cleanText(firstMatch(sectionHtml, /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/i));
    const text = htmlToCleanText(sectionHtml);

    if (text) {
      chunks.push({
        section_id: sectionId || '',
        heading_path: heading ? [heading] : [],
        text
      });
    }

    openPattern.lastIndex = contentStart;
  }

  return chunks;
}

function fallbackChunks(html) {
  const text = htmlToCleanText(html);
  return text ? [{ section_id: 'chunk-1', heading_path: [], text }] : [];
}

function removeNonContent(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ');
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}
