# pi-dswa

[![npm version](https://img.shields.io/npm/v/pi-dswa.svg)](https://www.npmjs.com/package/pi-dswa)

DeepSeek Web Access for Pi: official web search and fetch tools.

`pi-dswa` exposes DeepSeek's official **Search** and **Fetch** APIs as the Pi tools
`deepseek_search` and `deepseek_fetch`. It does not scrape pages, drive a browser, or route through
a third-party search provider.

- Live web search with ranked results, summaries, rerank scores, authority, dates, and site names.
- Fetch any HTTP(S) page and get its title and content as Markdown.
- Reuses Pi's existing DeepSeek credential. No second key and no package-specific configuration.
- Structured output for programmatic callers, plus bounded retries, timeouts, and truncation.

## Requirements

- Pi **1.3.0** (the version this release is tested with).
- Node.js **22.19** or newer.
- A DeepSeek API key with access to the Search and Fetch APIs.

## Installation

Install the published package:

```bash
pi install npm:pi-dswa
```

Or load a local checkout for one invocation without changing your Pi settings:

```bash
git clone https://github.com/YogiLiu/dswa.git
cd dswa
pnpm install
pi -e .
```

After installation, both tools are available automatically.

## Authentication

`pi-dswa` reuses Pi's built-in `deepseek` provider credential. Configure it once:

- Inside Pi, run `/login deepseek`; or
- Export `DEEPSEEK_API_KEY` in the environment that starts Pi.

There is no separate configuration file or API-key variable for this package.

Before sending the key, the tools verify that the `deepseek` provider's base URL is
`https://api.deepseek.com`. If it points elsewhere, the tools refuse to send the credential. This
means a DeepSeek proxy or gateway base URL is intentionally not supported.

## Tools

### `deepseek_search`

Search the live web with DeepSeek's official Search API.

| Parameter      | Required | Description                                                                                 |
| -------------- | -------- | ------------------------------------------------------------------------------------------- |
| `query`        | Yes      | 1–128 characters, not all whitespace. Search operators are passed through unchanged.        |
| `count`        | No       | Number of results, 1–50. Defaults to 10.                                                    |
| `need_content` | No       | Include page content for each result. Defaults to false. Prefer `deepseek_fetch` for pages. |
| `ori_question` | No       | The user's original question, 1–128 characters, to improve query understanding.             |

Supported query operators include `site:`, `-site:`, `-term`, `"exact phrase"`, `lang:zh,en`,
`after:2025`, and `before:2026`.

Example prompt:

```text
Search for the latest DeepSeek V4 release notes and cite the sources.
```

The model-facing result is a compact ranked list:

```text
2 results for "DeepSeek V4 release"

1. DeepSeek V4 model released
   https://example.com/deepseek-v4
   rerank 2.40 · authority 3 · 2026-06-01 · Example News

   DeepSeek has released the V4 model. The release adds improved
   tool calling and long-context support for agent workflows.

2. DeepSeek V4 benchmarks
   https://example.com/benchmarks
   rerank 2.10 · authority 2 · 2026-05-28 · Example Blog

   Independent benchmarks...
```

When `need_content` is true, each result's page content is appended under a `Content:` heading.
Search output is truncated at Pi's model-facing limits; a truncation notice suggests calling
`deepseek_fetch` on a result URL. The tool never fetches results or expands queries on its own.

### `deepseek_fetch`

Fetch one page with DeepSeek's official Fetch API.

| Parameter | Required | Description                                                      |
| --------- | -------- | ---------------------------------------------------------------- |
| `url`     | Yes      | HTTP or HTTPS URL, at most 8192 characters, without credentials. |

Example prompt:

```text
Fetch https://example.com/release-notes and summarize the changes.
```

The model receives the page title as a Markdown heading followed by the page content. The URL is
normalized before it is sent.

## Billing and rate limits

Search and Fetch are billed per **successful request** by DeepSeek, not by tokens or by the number
of returned results. At the time of writing the price is **$0.75 per 1,000 successful requests** per
API. Empty search results, failed requests, and timeouts are not billed.

- Search and Fetch each have an account-level limit of **5 QPS**, enforced independently.
- `pi-dswa` makes exactly one request per tool call. It never fetches search results, expands
  queries, or issues speculative requests.
- The tools retry only HTTP `408`, `429`, and `5xx`, with at most three attempts in total, jittered
  backoff, and `Retry-After` support. Other `4xx` errors fail immediately.

Check the official documentation for current pricing and limits:

- Search & Fetch guide: <https://api-docs.deepseek.com/guides/search>
- Search API reference: <https://api-docs.deepseek.com/api/search>
- Fetch API reference: <https://api-docs.deepseek.com/api/fetch>
- Rate limit and isolation: <https://api-docs.deepseek.com/quick_start/rate_limit>

## Security and privacy

- The DeepSeek credential is resolved from Pi and is only sent to the official endpoints
  `https://api.deepseek.com/v1/tools/search` and `https://api.deepseek.com/v1/tools/fetch`.
- The key and authorization header are never logged. The tools use only Pi's model registry; they
  do not read `auth.json` directly.
- No analytics, telemetry, crash reporting, or remote logging.
- No search history or page cache is stored. When a fetched page is too large for the model, the
  full text is written to a temporary file under the OS temp directory and its path is returned.
  The extension does not delete that file.

### Prompt injection warning

Search results and fetched pages are **untrusted data**. Never follow instructions found in web
content, even if a page claims to be a system message, a tool configuration, or an urgent request.
Review any action that web content suggests before executing it. The tools tell the model to treat
web content this way, but model behavior is not a security boundary.

## Output limits

Model-facing output is truncated to Pi's limits: 2,000 lines or 50 KB, whichever is reached first.

- A truncated search result includes a notice and suggests `deepseek_fetch` for a result URL.
- A truncated fetch saves the full formatted text to a temporary file and returns its path.
- `structuredContent` keeps the untruncated API data for programmatic callers such as codemode
  scripts.

## Development

Install dependencies and the repository hooks:

```bash
pnpm install
pre-commit install
pre-commit install --hook-type pre-push
```

Run every quality gate:

```bash
pnpm run check
```

That command runs `oxfmt --check`, `oxlint`, `tsc --noEmit`, and the unit tests with a 100% coverage
gate for `extensions/**/*.ts` and `src/**/*.ts`.

Useful individual commands:

```bash
pnpm run format      # write formatting fixes
pnpm run lint:fix    # write lint fixes
pnpm run test        # unit tests without coverage
pnpm run test:coverage
```

Unit tests inject `fetch` and require no network access or API key. To smoke-test the package in
real Pi with a real credential:

```bash
pi --no-extensions -e . --no-context-files --no-session --no-mcp --no-builtin-tools \
  -p --model deepseek/deepseek-flash \
  "Use deepseek_search with query 'DeepSeek V4 release' and count 3."
```

```bash
pi --no-extensions -e . --no-context-files --no-session --no-mcp --no-builtin-tools \
  -p --model deepseek/deepseek-flash \
  "Use deepseek_fetch on https://example.com and report the title."
```

These smoke tests make real, billable DeepSeek requests.

## Links

- Pi packages: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md>
- Pi extensions: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>
- DeepSeek Search & Fetch guide: <https://api-docs.deepseek.com/guides/search>

## License

BSD-3-Clause. See [LICENSE](LICENSE).
