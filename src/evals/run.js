import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getConfig } from '../config.js';
import { loadIndex } from '../db/store.js';
import { retrieve } from '../retrieval/hybrid.js';
import { answerFromRetrieval } from '../generation/answer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOP_K = 3;

async function main() {
  const config = getConfig();
  const index = await loadIndex(config.indexPath);
  const cases = JSON.parse(await readFile(join(__dirname, 'cases.json'), 'utf8'));
  const failures = [];
  const skipped = [];

  for (const testCase of cases) {
    // Some cases only make sense against the full corpus: the fixture has no
    // bidirectional text sources, for example.
    if (index.chunks.length < (testCase.min_indexed_chunks || 0)) {
      skipped.push(`${testCase.question}: needs at least ${testCase.min_indexed_chunks} indexed chunks`);
      continue;
    }

    const retrieval = retrieve({
      query: testCase.question,
      language: testCase.language,
      statuses: testCase.statuses || ['published', 'review', 'draft'],
      includeObsolete: Boolean(testCase.includeObsolete),
      chunks: index.chunks,
      limit: 8
    });
    const answer = await answerFromRetrieval({
      question: testCase.question,
      language: testCase.language,
      retrieval,
      chunks: index.chunks,
      modelProvider: 'local'
    });
    const sourcePaths = new Set(answer.citations.map((citation) => citation.source_path));
    const warningTypes = new Set(answer.warnings.map((warning) => warning.type));
    const expectedStatuses = Array.isArray(testCase.expected_evidence_status)
      ? testCase.expected_evidence_status
      : [testCase.expected_evidence_status];

    if (!expectedStatuses.includes(answer.evidence_status)) {
      failures.push(`${testCase.question}: expected evidence ${expectedStatuses.join('|')}, got ${answer.evidence_status}`);
    }

    for (const sourcePath of testCase.required_source_paths || []) {
      if (!sourcePaths.has(sourcePath)) failures.push(`${testCase.question}: missing required source ${sourcePath}`);
    }

    if (testCase.required_any_source_paths?.length > 0 && !testCase.required_any_source_paths.some((sourcePath) => sourcePaths.has(sourcePath))) {
      failures.push(`${testCase.question}: missing one of required sources ${testCase.required_any_source_paths.join('|')}`);
    }

    for (const sourcePath of testCase.disallowed_source_paths || []) {
      if (sourcePaths.has(sourcePath)) failures.push(`${testCase.question}: used disallowed source ${sourcePath}`);
    }

    for (const warningType of testCase.expected_warning_types || []) {
      if (!warningTypes.has(warningType)) failures.push(`${testCase.question}: missing warning ${warningType}`);
    }

    checkRanking(testCase, retrieval.results, failures);

    const normalizedAnswer = String(answer.answer || '').toLowerCase();
    for (const expectedTerm of testCase.expected_answer_terms || []) {
      if (!normalizedAnswer.includes(String(expectedTerm).toLowerCase())) {
        failures.push(`${testCase.question}: answer missing expected term ${expectedTerm}`);
      }
    }
  }

  console.log(`Evaluated ${cases.length - skipped.length} cases against ${index.chunks.length} chunks.`);
  if (skipped.length > 0) {
    console.log(`${skipped.length} skipped:`);
    for (const entry of skipped) console.log(`- ${entry}`);
  }
  if (failures.length > 0) {
    console.error(`${failures.length} failures:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('All evaluation cases passed.');
}

// A local-mode citation can only show the chunk the extractive answerer used,
// so paraphrased and underspecified questions are checked against the ranking
// instead: which sources were surfaced at all, and which source must not come
// first.
function checkRanking(testCase, results, failures) {
  const topK = testCase.top_k || DEFAULT_TOP_K;
  const topSources = new Set(results.slice(0, topK).map((result) => result.source_path));
  const relevant = testCase.relevant_source_paths || [];
  const hits = relevant.filter((sourcePath) => topSources.has(sourcePath));

  if (relevant.length > 0 && hits.length < (testCase.min_relevant ?? 1)) {
    failures.push(`${testCase.question}: expected at least ${testCase.min_relevant ?? 1} of ${relevant.join('|')} in the top ${topK}, got ${[...topSources].join('|') || '(none)'}`);
  }

  const topSource = results[0]?.source_path;
  for (const sourcePath of testCase.disallowed_top_source_paths || []) {
    if (topSource === sourcePath) failures.push(`${testCase.question}: ranked disallowed source first ${sourcePath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
