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
      const citationAnchor = raw.citation_anchor || '';
      const text = raw.text;
      if (!text) return null;

      return {
        id: `${page.source_path}#${sectionId}`,
        document_id: page.id || page.source_path,
        chunk_id: `${page.source_path}#${sectionId}`,
        source_path: page.source_path,
        canonical_url: page.canonical_url,
        section_id: sectionId,
        section_url: withSectionId(documentUrl, citationAnchor),
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
  return [
    ...extractAbstractChunk(html),
    ...collectSections(html).map((section) => {
      const text = htmlToCleanText(section.html);
      if (!text) return null;

      return {
        section_id: section.sectionId || '',
        citation_anchor: section.citationAnchor,
        heading_path: section.heading ? [section.heading] : [],
        text
      };
    }).filter(Boolean)
  ];
}

// ReSpec pages put their summary in <div id="abstract"> outside any <section>,
// so section parsing alone would drop it from the index.
function extractAbstractChunk(html) {
  const match = html.match(/<div\b[^>]*\bid=["']abstract["'][^>]*>([\s\S]*?)<\/div>/i);
  const text = match ? htmlToCleanText(match[1]) : '';
  return text ? [{ section_id: 'abstract', citation_anchor: 'abstract', heading_path: [], text }] : [];
}

function collectSections(html) {
  const sections = [];
  const stack = [];
  const sectionPattern = /<section\b([^>]*)>|<\/section\s*>/gi;
  let match;

  while ((match = sectionPattern.exec(html))) {
    if (match[1] !== undefined) {
      const section = {
        attrs: match[1] || '',
        contentStart: match.index + match[0].length,
        contentEnd: html.length,
        parent: stack.at(-1) || null
      };
      stack.push(section);
      sections.push(section);
    } else if (stack.length > 0) {
      stack.pop().contentEnd = match.index;
    }
  }

  for (const section of sections) {
    section.html = html.slice(section.contentStart, section.contentEnd);
    const headingMatch = section.html.match(/<h[2-4]\b([^>]*)>([\s\S]*?)<\/h[2-4]>/i);
    const headingAttrs = headingMatch ? headingMatch[1] : '';
    section.heading = cleanText(headingMatch ? headingMatch[2] : '');
    // ReSpec pages commonly leave <section> unanchored and put the id on the
    // heading. Either anchor is a valid citation target in the rendered page.
    section.sectionId = firstMatch(section.attrs, /\bid=["']?([^"'\s>]+)/i) ||
      firstMatch(headingAttrs, /\bid=["']?([^"'\s>]+)/i);
    // A nested section with no anchor of its own still lives under an
    // anchored ancestor, so cite that ancestor rather than inventing a fragment.
    section.citationAnchor = section.sectionId || (section.parent ? section.parent.citationAnchor : '');
  }

  return sections;
}

function fallbackChunks(html) {
  const text = htmlToCleanText(html);
  return text ? [{ section_id: 'chunk-1', citation_anchor: '', heading_path: [], text }] : [];
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
