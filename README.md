[简体中文](README.zh-Hans.md)

# Ask W3C i18n

Ask W3C i18n answers questions about W3C Internationalization guidance with source-grounded citations and source status.

<p align="center">
  <a href="https://ask-i18n.onrender.com/"><strong>Try it online</strong></a>
</p>

> **Experimental tool:** This is an experimental tool from the [W3C Internationalization Activity](https://www.w3.org/International/). Its answers are not W3C standards or official W3C positions.

## Example Questions

- How should I declare UTF-8 character encoding in HTML?
- How should I set the language of the content in my HTML page?
- What are character sets?
- What is the byte-order mark?
- What is ruby?
- What does the i18n WG do?
- When HTTP Content-Type, BOM, and `<meta charset>` disagree, which encoding wins?
- Why does my Arabic text render in the wrong order next to punctuation?

## Run Locally

Use the local source:

```sh
cp .env.example .env
# edit .env and set SOURCE_MODE=local plus SOURCE_REPO_PATH

npm run index
npm run start
```

Use the default remote source:

```sh
SOURCE_MODE=git npm run index
npm run start
```

Open http://127.0.0.1:3000 .

## Configuration

The app loads `.env` automatically from the project root. Copy `.env.example` to `.env` for local development, then edit values there.

Do not commit real `.env` files or secrets.

Important defaults:

- `SOURCE_MODE=git`
- `SOURCE_REPO_URL=https://github.com/w3c/i18n-drafts.git`
- `SOURCE_REF=gh-pages`
- `SOURCE_CACHE_DIR=.cache/source/i18n-drafts`
- `PUBLIC_BASE_URL=https://www.w3.org/International`
- `MODEL_PROVIDER=local`
- `TRUSTED_PROXIES=` (empty by default; forwarded client IP headers are ignored)
- `BASE_PATH=` (empty by default; set a subpath such as `/ask-i18n` to serve the app below the site root)

The example `SOURCES` configuration enables multi-source indexing for `i18n-drafts`, `bp-i18n-specdev`, and `i18n-activity`. The `i18n-activity` source is limited to the `i18n-wg` and `i18n-ig` folders.

`SOURCES` overrides the single-source `SOURCE_*` settings. To use only a local `i18n-drafts` checkout, remove or comment out `SOURCES` before setting `SOURCE_MODE=local` and `SOURCE_REPO_PATH`.

`MODEL_PROVIDER=local` uses a deterministic extractive answerer over retrieved chunks. To use an external server-side model, set:

```sh
MODEL_PROVIDER=openai-compatible
MODEL_API_KEY=...
MODEL_BASE_URL=https://api.openai.com/v1
GENERATION_MODEL=...
MODEL_TIMEOUT_MS=30000
```

API keys are read only by the Node server and are never sent to the browser.

For deployments behind a reverse proxy or CDN, set `TRUSTED_PROXIES` to the proxy IPs or CIDR ranges that are allowed to set `Forwarded` or `X-Forwarded-For` headers:

```sh
TRUSTED_PROXIES=127.0.0.1/32,::1
```

When this is unset, rate limiting deliberately uses the direct socket address only so public clients cannot spoof forwarded IP headers to bypass limits.

## Serving under a subpath

Set `BASE_PATH` when the app is mounted below the site root, for example behind the labs proxy at `https://labs.w3.org/ask-i18n/`:

```sh
BASE_PATH=/ask-i18n
```

The UI and API then answer under that prefix (`/ask-i18n/`, `/ask-i18n/api/v1/search`), and a request for the bare prefix redirects to `/ask-i18n/` so the page's relative asset URLs resolve. A path that only shares a prefix, such as `/ask-i18n-drafts/`, is not affected.

Both proxy styles work. If the proxy strips the prefix before forwarding, leave `BASE_PATH` empty and the app keeps serving at the root. If the proxy forwards the full path, set `BASE_PATH` to the mounted prefix. Unprefixed paths keep working in either case, so the same build runs on a local port and behind a subpath.

## Commands

```sh
npm test
npm run test:e2e
npm run index
npm run rag:index
npm run eval
npm run start
```

For fixture development:

```sh
npm run index -- --source-mode=local --source-repo-path=tests/fixtures/i18n-mini
npm run eval
```

Playwright E2E tests use the same fixture corpus and start the real server. Install browsers once with `npx playwright install chromium firefox webkit`, then run `npm run test:e2e`.

## Community API

The stable community API is versioned under `/api/v1`. It uses the latest loaded index.

OpenAPI documentation is available at:

```sh
curl https://ask-i18n.onrender.com/api/openapi.json
```

Search indexed source sections:

```sh
curl "https://ask-i18n.onrender.com/api/v1/search?q=declare%20UTF-8&language=en&status=published&limit=5"
```

Search returns ranked snippets, not full debug chunks:

```json
{
  "query": "declare UTF-8",
  "results": [
    {
      "id": "articles/http-charset/index.en.html#charset",
      "rank": 1,
      "score": 1.23,
      "title": "Declaring character encodings in HTML",
      "url": "https://www.w3.org/International/articles/http-charset/#charset",
      "language": "en",
      "status": "published",
      "translation_state": "current",
      "snippet": "For HTML pages, use UTF-8..."
    }
  ],
  "index": {
    "source_ref": "gh-pages",
    "source_commit": "..."
  }
}
```

Answer a question with citations:

```sh
curl -X POST https://ask-i18n.onrender.com/api/v1/answer \
  -H "content-type: application/json" \
  -d '{"question":"How should I declare UTF-8 character encoding?","language":"en","statuses":["published"]}'
```

Answer responses have this shape:

```json
{
  "question": "How should I declare UTF-8 character encoding?",
  "language": "en",
  "evidence_status": "supported",
  "answer": "... [1]",
  "citations": [
    {
      "id": "articles/http-charset/index.en.html#charset",
      "label": "Declaring character encodings in HTML: The charset parameter",
      "url": "https://www.w3.org/International/articles/http-charset/#charset",
      "language": "en",
      "status": "published",
      "translation_state": "current",
      "source_path": "articles/http-charset/index.en.html",
      "rank": 1
    }
  ],
  "warnings": [],
  "index": {
    "source_ref": "gh-pages",
    "source_commit": "..."
  }
}
```

Supported filters:

- `language`: preferred BCP 47 language tag, default `en`.
- `status` or `statuses`: one or more of `published`, `review`, `draft`, `notreviewed`, `obsolete`.
- `include_obsolete`: set to `true` to allow obsolete sources.
- `limit`: maximum retrieval results, capped at `20`.

Errors use a stable object:

```json
{
  "error": {
    "code": "index_unavailable",
    "message": "No search index is available. Run npm run index first.",
    "language": "en",
    "direction": "ltr"
  },
  "index": {
    "source_ref": "gh-pages",
    "source_commit": "..."
  }
}
```

`error.language` is the BCP 47 language tag for `error.message`; `error.direction` is the message text direction (`ltr` or `rtl`), so messages such as Arabic can be rendered correctly.

CORS is enabled for the community API. The same in-memory rate limiter applies to all `/api/` routes.

## Internal API

- `GET /api/health` returns source mode, ref, commit, and index counts.
- `POST /api/retrieve` returns ranked source chunks for debug and development.
- `POST /api/ask` returns `{ answer, citations, warnings, evidence_status, debug }`.
- `POST /api/admin/reindex` is hidden unless `ADMIN_TOKEN` is set and must be called with `x-admin-token`.

## Logs

Query logs are JSONL at `.data/query-log.jsonl` and store question text, selected language, filters, retrieved source ids, evidence status, latency, and error type. They do not store API keys or account identifiers. The log rotates by size: once the file exceeds `QUERY_LOG_MAX_BYTES` (default 10 MiB), it is renamed to `query-log.jsonl.1` and older backups shift down, with `QUERY_LOG_BACKUPS` (default 3) bounding how many rotated files are kept.

## License

This project is licensed under the W3C Software and Document License - 2023 version. See `LICENSE`.
