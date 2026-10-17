import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import type { FetchPage, SearchResult } from "./client.ts";

/** Truncated model-facing text plus the details of the truncation. */
export type TruncatedText = {
  text: string;
  truncation: TruncationResult;
};

/** Truncated fetch output, including where the full text was saved. */
export type TruncatedFetchOutput = TruncatedText & {
  fullContentPath?: string;
};

/** Render search results as a compact ranked list for the model. */
export function formatSearchResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `No results for "${query}". Try a broader query or fewer operators.`;
  }

  const header = `${results.length} ${results.length === 1 ? "result" : "results"} for "${query}"`;
  const blocks = results.map((result, index) => formatSearchResult(result, index + 1));
  return `${header}\n\n${blocks.join("\n\n")}`;
}

function formatSearchResult(result: SearchResult, position: number): string {
  const lines = [`${position}. ${result.title || "(untitled)"}`];
  if (result.url) lines.push(`   ${result.url}`);

  const metadata = [`rerank ${result.rerank_score.toFixed(2)}`];
  if (result.authority >= 0) metadata.push(`authority ${result.authority}`);
  if (result.date) metadata.push(result.date.slice(0, 10));
  if (result.site_name) metadata.push(result.site_name);
  lines.push(`   ${metadata.join(" · ")}`);

  const summary = result.summary.trim();
  if (summary) lines.push("", indent(summary));

  const content = result.content.trim();
  if (content) lines.push("", "   Content:", indent(content));

  return lines.join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `   ${line}`)
    .join("\n");
}

/** Render a fetched page with its title as a Markdown heading when available. */
export function formatFetchPage(page: FetchPage): string {
  return page.title ? `# ${page.title}\n\n${page.content}` : page.content;
}

/** Truncate search output to Pi's model-facing limits. Search never writes a temp file. */
export function truncateSearchOutput(text: string): TruncatedText {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) return { text: truncation.content, truncation };

  const notice = `${truncationNotice(truncation)} Use deepseek_fetch on a result URL to read the full page.]`;
  return { text: `${truncation.content}\n\n${notice}`, truncation };
}

/**
 * Truncate fetched page text to Pi's model-facing limits. When truncated, the complete text is
 * written to a temporary file so the model can read it.
 */
export async function truncateFetchOutput(text: string): Promise<TruncatedFetchOutput> {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) return { text: truncation.content, truncation };

  const fullContentPath = await writeFullContent(text);
  const notice = `${truncationNotice(truncation)} Full content saved to: ${fullContentPath}]`;
  return { text: `${truncation.content}\n\n${notice}`, truncation, fullContentPath };
}

function truncationNotice(truncation: TruncationResult): string {
  const omittedLines = truncation.totalLines - truncation.outputLines;
  const omittedBytes = truncation.totalBytes - truncation.outputBytes;
  return (
    `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `${omittedLines} lines (${formatSize(omittedBytes)}) omitted.`
  );
}

async function writeFullContent(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-dswa-fetch-"));
  const path = join(directory, "fetch.md");
  await writeFile(path, content, "utf8");
  return path;
}
