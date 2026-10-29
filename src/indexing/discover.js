import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isLikelyContentPage } from './parse-html.js';

export const CONTENT_ROOTS = new Set([
  'articles',
  'questions',
  'tutorials',
  'getting-started',
  'nav',
  'quicktips',
  'pages',
  'techniques',
  'glossaries'
]);

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', '.cache', '.data', 'dist', 'build']);

export async function discoverContentFiles(sourceRoot, options) {
  const detailed = await discoverContentFilesDetailed(sourceRoot, options);
  return detailed.files;
}

export async function discoverContentFilesDetailed(sourceRoot, options = {}) {
  const contentRoots = options.contentRoots != null
    ? new Set(options.contentRoots)
    : CONTENT_ROOTS;
  const contentFiles = Array.isArray(options.contentFiles)
    ? options.contentFiles.filter(Boolean)
    : [];
  const requireMetadata = options.requireMetadata !== false;

  if (contentFiles.length > 0) {
    return discoverListedContentFiles(sourceRoot, { contentFiles, requireMetadata });
  }

  const files = [];
  let skipped = 0;

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = normalizePath(relative(sourceRoot, absolutePath));
      const segments = relativePath.split('/');

      if (entry.isDirectory()) {
        if (IGNORED_SEGMENTS.has(entry.name)) continue;
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      if (!matchesContentRoots(segments, contentRoots)) continue;
      if (segments.some((segment) => /-data$/i.test(segment))) {
        skipped += 1;
        continue;
      }

      const isContent = await isContentPageFile(absolutePath, requireMetadata);
      if (isContent) {
        files.push(relativePath);
      } else {
        skipped += 1;
      }
    }
  }

  await walk(sourceRoot);
  files.sort((a, b) => a.localeCompare(b));
  return { files, skipped };
}

function matchesContentRoots(segments, contentRoots) {
  if (contentRoots.has('')) return true;
  return contentRoots.has(segments[0]);
}

// contentFiles names exact pages for sources whose useful content is a single
// root-level document, such as string-meta's index.html.
async function discoverListedContentFiles(sourceRoot, { contentFiles, requireMetadata }) {
  const files = new Set();
  let skipped = 0;

  for (const rawPath of contentFiles) {
    const relativePath = normalizeContentFilePath(rawPath);
    let isContent;

    try {
      isContent = await isContentPageFile(join(sourceRoot, relativePath), requireMetadata);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Content file not found in source: ${relativePath}`);
      }
      throw error;
    }

    if (isContent) {
      files.add(relativePath);
    } else {
      skipped += 1;
    }
  }

  return { files: [...files].sort((a, b) => a.localeCompare(b)), skipped };
}

async function isContentPageFile(absolutePath, requireMetadata) {
  const html = await readFile(absolutePath, 'utf8');
  return isLikelyContentPage(html, { requireMetadata });
}

function normalizeContentFilePath(file) {
  const normalized = normalizePath(file).replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Invalid content file path: ${file}`);
  }
  return normalized;
}

export function normalizePath(path) {
  return String(path).replaceAll('\\', '/');
}
