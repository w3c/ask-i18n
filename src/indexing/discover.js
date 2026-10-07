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
  const requireMetadata = options.requireMetadata !== false;
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

      const html = await readFile(absolutePath, 'utf8');
      if (isLikelyContentPage(html, { requireMetadata })) {
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

export function normalizePath(path) {
  return String(path).replaceAll('\\', '/');
}
