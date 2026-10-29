import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../config.js';
import { saveIndex } from '../db/store.js';
import { discoverContentFilesDetailed } from './discover.js';
import { parseHtmlPage } from './parse-html.js';
import { parseTranslationsFile, EMPTY_TRANSLATIONS } from './parse-translations.js';
import { translationDataPathForSourcePath } from './canonical-url.js';
import { chunkHtmlPage } from './chunk.js';
import { resolveSource, resolveSources } from './source-sync.js';

export async function buildIndex({
  sourceRoot,
  publicBaseUrl = 'https://www.w3.org/International',
  sourceMode = 'local',
  sourceRef = '',
  sourceCommit = '',
  sourceId = '',
  contentRoots = null,
  contentFiles = null,
  requireMetadata = true,
  defaultStatus = '',
  statusOverride = '',
  githubPagesBaseUrl = '',
  write = true,
  indexPath = '.data/index.json'
}) {
  const root = resolve(sourceRoot);
  const discovered = await discoverContentFilesDetailed(root, { contentRoots, contentFiles, requireMetadata });
  const documents = [];
  const chunks = [];
  const warnings = [];
  const errors = [];
  const startedAt = new Date().toISOString();

  for (const sourcePath of discovered.files) {
    try {
      const html = await readFile(join(root, sourcePath), 'utf8');
      const translations = await readTranslations(root, sourcePath);
      const document = parseHtmlPage({
        html,
        sourcePath,
        publicBaseUrl,
        translations,
        sourceMode,
        sourceRef,
        sourceCommit,
        defaultStatus,
        statusOverride,
        githubPagesBaseUrl
      });
      if (sourceId) document.source_id = sourceId;
      const documentChunks = chunkHtmlPage(document, { publicBaseUrl });
      if (sourceId) {
        for (const chunk of documentChunks) {
          chunk.source_id = sourceId;
        }
      }
      documents.push(document);
      chunks.push(...documentChunks);
    } catch (error) {
      errors.push({ source_path: sourcePath, message: error.message });
    }
  }

  const finishedAt = new Date().toISOString();
  const index = {
    version: 1,
    source: {
      mode: sourceMode,
      ref: sourceRef,
      commit: sourceCommit,
      root
    },
    summary: {
      started_at: startedAt,
      finished_at: finishedAt,
      document_count: documents.length,
      chunk_count: chunks.length,
      skipped: discovered.skipped,
      warning_count: warnings.length,
      error_count: errors.length
    },
    index_runs: [
      {
        id: startedAt,
        started_at: startedAt,
        finished_at: finishedAt,
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        source_mode: sourceMode,
        source_ref: sourceRef,
        source_commit: sourceCommit,
        document_count: documents.length,
        chunk_count: chunks.length,
        skipped_count: discovered.skipped,
        warning_count: warnings.length,
        error_count: errors.length,
        error_message: errors.map((error) => error.message).join('; ')
      }
    ],
    documents,
    chunks,
    warnings,
    errors
  };

  if (write) await saveIndex(index, indexPath);
  return index;
}

async function readTranslations(sourceRoot, sourcePath) {
  const translationPath = translationDataPathForSourcePath(sourcePath);
  try {
    const content = await readFile(join(sourceRoot, translationPath), 'utf8');
    return parseTranslationsFile(content);
  } catch {
    return { ...EMPTY_TRANSLATIONS };
  }
}

export async function buildMultiSourceIndex(config) {
  const resolvedSources = await resolveSources(config);
  const allDocuments = [];
  const allChunks = [];
  const allWarnings = [];
  const allErrors = [];
  const sourceSummaries = [];
  const startedAt = new Date().toISOString();
  let totalSkipped = 0;

  for (const source of resolvedSources) {
    console.log(`Indexing source: ${source.id} (${source.sourceRoot})`);
    const sourceIndex = await buildIndex({
      sourceRoot: source.sourceRoot,
      publicBaseUrl: source.publicBaseUrl,
      sourceMode: source.mode,
      sourceRef: source.ref,
      sourceCommit: source.sourceCommit,
      sourceId: source.id,
      contentRoots: source.contentRoots,
      contentFiles: source.contentFiles,
      requireMetadata: source.requireMetadata,
      defaultStatus: source.defaultStatus,
      statusOverride: source.statusOverride,
      githubPagesBaseUrl: source.githubPagesBaseUrl,
      write: false
    });

    allDocuments.push(...sourceIndex.documents);
    allChunks.push(...sourceIndex.chunks);
    allWarnings.push(...sourceIndex.warnings);
    allErrors.push(...sourceIndex.errors);
    totalSkipped += sourceIndex.summary.skipped;

    sourceSummaries.push({
      id: source.id,
      mode: source.mode,
      ref: source.ref,
      commit: source.sourceCommit,
      root: source.sourceRoot,
      publicBaseUrl: source.publicBaseUrl,
      document_count: sourceIndex.summary.document_count,
      chunk_count: sourceIndex.summary.chunk_count,
      skipped: sourceIndex.summary.skipped,
      error_count: sourceIndex.summary.error_count
    });
  }

  const finishedAt = new Date().toISOString();
  const index = {
    version: 1,
    sources: sourceSummaries,
    source: sourceSummaries.length === 1
      ? { mode: sourceSummaries[0].mode, ref: sourceSummaries[0].ref, commit: sourceSummaries[0].commit, root: sourceSummaries[0].root }
      : { mode: 'multi', ref: '', commit: '', root: '' },
    summary: {
      started_at: startedAt,
      finished_at: finishedAt,
      document_count: allDocuments.length,
      chunk_count: allChunks.length,
      skipped: totalSkipped,
      warning_count: allWarnings.length,
      error_count: allErrors.length
    },
    index_runs: [
      {
        id: startedAt,
        started_at: startedAt,
        finished_at: finishedAt,
        status: allErrors.length > 0 ? 'completed_with_errors' : 'completed',
        document_count: allDocuments.length,
        chunk_count: allChunks.length,
        skipped_count: totalSkipped,
        warning_count: allWarnings.length,
        error_count: allErrors.length,
        error_message: allErrors.map((error) => error.message).join('; '),
        sources: sourceSummaries
      }
    ],
    documents: allDocuments,
    chunks: allChunks,
    warnings: allWarnings,
    errors: allErrors
  };

  return index;
}

export async function runIndexer(config = getConfig()) {
  if (config.sources && config.sources.length > 1) {
    const index = await buildMultiSourceIndex(config);
    await saveIndex(index, config.indexPath);
    printMultiSourceSummary(index);
    return index;
  }

  // single-source path (backward compatible)
  const sources = config.sources || [];
  if (sources.length === 1) {
    const source = sources[0];
    const { sourceRoot, sourceCommit } = await resolveSingleSourceCompat(source, config);
    const index = await buildIndex({
      sourceRoot,
      publicBaseUrl: source.publicBaseUrl || config.publicBaseUrl,
      sourceMode: source.mode || config.sourceMode,
      sourceRef: source.ref || config.sourceRef,
      sourceCommit: sourceCommit || config.sourceCommit,
      sourceId: source.id,
      contentRoots: source.contentRoots,
      contentFiles: source.contentFiles,
      requireMetadata: source.requireMetadata,
      defaultStatus: source.defaultStatus,
      statusOverride: source.statusOverride,
      githubPagesBaseUrl: source.githubPagesBaseUrl,
      write: true,
      indexPath: config.indexPath
    });
    printSummary(index);
    return index;
  }

  // legacy fallback (no sources array)
  const { sourceRoot, sourceCommit } = await resolveSource(config);
  const index = await buildIndex({
    sourceRoot,
    publicBaseUrl: config.publicBaseUrl,
    sourceMode: config.sourceMode,
    sourceRef: config.sourceRef,
    sourceCommit: sourceCommit || config.sourceCommit,
    githubPagesBaseUrl: config.sources?.[0]?.githubPagesBaseUrl,
    write: true,
    indexPath: config.indexPath
  });

  printSummary(index);
  return index;
}

async function resolveSingleSourceCompat(source, config) {
  const { resolveSources: rs } = await import('./source-sync.js');
  const resolved = await rs({ sources: [source] });
  return resolved[0] || { sourceRoot: '', sourceCommit: '' };
}

function printMultiSourceSummary(index) {
  console.log(`Multi-source index: ${index.sources.length} sources`);
  for (const source of index.sources) {
    console.log(`  ${source.id}: ${source.document_count} docs, ${source.chunk_count} chunks`);
  }
  console.log(`Total: ${index.summary.document_count} documents, ${index.summary.chunk_count} chunks`);
  console.log(`Skipped ${index.summary.skipped} support/example files`);
  console.log(`Errors: ${index.summary.error_count}`);
}

function printSummary(index) {
  console.log(`Source mode: ${index.source.mode}`);
  console.log(`Source ref: ${index.source.ref}`);
  console.log(`Source commit: ${index.source.commit}`);
  console.log(`Indexed ${index.documents.length} documents`);
  console.log(`Indexed ${index.chunks.length} chunks`);
  console.log(`Skipped ${index.summary.skipped} support/example files`);
  console.log(`Warnings: ${index.summary.warning_count}`);
  console.log(`Errors: ${index.summary.error_count}`);
}

export function parseArgs(argv) {
  const updates = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    if (arg.includes('=')) {
      const [rawKey, ...valueParts] = arg.slice(2).split('=');
      const value = valueParts.join('=');
      const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      updates[key] = value;
    } else {
      const rawKey = arg.slice(2);
      const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const nextArg = argv[index + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        updates[key] = nextArg;
        index += 1;
      } else {
        updates[key] = 'true';
      }
    }
  }
  return updates;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  const config = getConfig(parseArgs(process.argv.slice(2)));
  runIndexer(config).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
