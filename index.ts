// Portions of this file were adapted from pi-web-access by Nico Bailon.
// See THIRD_PARTY_NOTICES.md for the preserved upstream MIT notice.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	type ExtensionAPI,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	fetchWithExa,
	searchWithExa,
	type ExaFetchOptions,
	type ExaSearchOptions,
} from "./exa.js";

interface WebSearchParams {
	query: string;
	numResults?: number;
}

interface FetchContentParams {
	urls: string[];
	maxCharacters?: number;
}

const DEFAULT_NUM_RESULTS = 5;
const DEFAULT_MAX_CHARACTERS = 3_000;
const MAX_NUM_RESULTS = 20;

const TRUNCATION_NOTICE = `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file.`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const WebSearchParamsSchema = Type.Object({
	query: Type.String({
		minLength: 1,
		description: "Search query.",
	}),
	numResults: Type.Optional(Type.Integer({
		minimum: 1,
		maximum: MAX_NUM_RESULTS,
		description: `Results per query (default: ${DEFAULT_NUM_RESULTS}, max: ${MAX_NUM_RESULTS})`,
	})),
});

const FetchContentParamsSchema = Type.Object({
	urls: Type.Array(Type.String({ minLength: 1 }), {
		description: "One or more URLs to fetch as clean markdown.",
		minItems: 1,
	}),
	maxCharacters: Type.Optional(Type.Integer({
		minimum: 1,
		description: `Maximum characters per URL (default: ${DEFAULT_MAX_CHARACTERS}).`,
	})),
});

interface TruncatedToolOutput {
	text: string;
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

async function truncateToolOutput(
	filePrefix: string,
	output: string,
	tempDirs?: Set<string>,
): Promise<TruncatedToolOutput> {
	const truncation = truncateHead(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	if (!truncation.truncated) {
		return { text: truncation.content };
	}

	const tempDir = await mkdtemp(join(tmpdir(), "pi-exa-search-"));
	tempDirs?.add(tempDir);
	const tempFile = join(tempDir, `${filePrefix}.txt`);
	await writeFile(tempFile, output, "utf8");

	const truncatedLines = truncation.totalLines - truncation.outputLines;
	const truncatedBytes = truncation.totalBytes - truncation.outputBytes;

	let text = truncation.content;
	text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
	text += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
	text += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
	text += ` Full output saved to: ${tempFile}]`;

	return {
		text,
		truncation,
		fullOutputPath: tempFile,
	};
}

export default function (pi: ExtensionAPI): void {
	const tempDirs = new Set<string>();

	pi.on("session_shutdown", async () => {
		for (const tempDir of tempDirs) {
			try {
				await rm(tempDir, { recursive: true, force: true });
			} catch {
				// Ignore cleanup errors for temp directories.
			}
		}
		tempDirs.clear();
	});

	pi.registerTool<WebSearchParams>({
		name: "web_search",
		label: "Web Search (Exa)",
		description:
			`Search the web. Returns results with titles, URLs, and snippets. ${TRUNCATION_NOTICE}`,
		promptSnippet:
			"Search the web",
		parameters: WebSearchParamsSchema,
		prepareArguments(args) {
			if (!isRecord(args)) return args;
			return {
				query: typeof args.query === "string" ? args.query.trim() : args.query,
				numResults: args.numResults,
			};
		},

		async execute(_toolCallId, params: WebSearchParams, signal, onUpdate) {
			onUpdate?.({
				content: [{ type: "text", text: `Searching: "${params.query}"...` }],
				details: {
					phase: "search",
					progress: 0,
					currentQuery: params.query,
					provider: "exa",
				},
			});

			const options: ExaSearchOptions = {
				numResults: params.numResults ?? DEFAULT_NUM_RESULTS,
			};
			if (signal) options.signal = signal;

			const rawOutput = await searchWithExa(params.query, options);
			const truncatedOutput = await truncateToolOutput("web-search", rawOutput, tempDirs);

			return {
				content: [{ type: "text", text: truncatedOutput.text }],
				details: {
					provider: "exa",
					query: params.query,
					success: true,
					error: null,
					...(truncatedOutput.truncation
						? {
								truncation: truncatedOutput.truncation,
								fullOutputPath: truncatedOutput.fullOutputPath,
							}
						: {}),
				},
			};
		},
	});

	pi.registerTool<FetchContentParams>({
		name: "fetch_content",
		label: "Fetch Content (Exa)",
		description:
			`Fetch from web URLs. Returns their content as markdown. ${TRUNCATION_NOTICE}`,
		promptSnippet:
			"Fetch web content",
		parameters: FetchContentParamsSchema,
		prepareArguments(args) {
			if (!isRecord(args)) return args;
			return {
				urls: Array.isArray(args.urls)
					? args.urls.map((url) => (typeof url === "string" ? url.trim() : url))
					: args.urls,
				maxCharacters: args.maxCharacters,
			};
		},

		async execute(_toolCallId, params: FetchContentParams, signal, onUpdate) {
			onUpdate?.({
				content: [{ type: "text", text: `Fetching ${params.urls.length} URL(s)...` }],
				details: {
					phase: "fetch",
					progress: 0,
					urlCount: params.urls.length,
					provider: "exa",
				},
			});

			const options: ExaFetchOptions = {
				maxCharacters: params.maxCharacters ?? DEFAULT_MAX_CHARACTERS,
			};
			if (signal) options.signal = signal;

			const rawOutput = await fetchWithExa(params.urls, options);
			const truncatedOutput = await truncateToolOutput("fetch-content", rawOutput, tempDirs);

			return {
				content: [{ type: "text", text: truncatedOutput.text }],
				details: {
					provider: "exa",
					urls: params.urls,
					success: true,
					urlCount: params.urls.length,
					error: null,
					...(truncatedOutput.truncation
						? {
								truncation: truncatedOutput.truncation,
								fullOutputPath: truncatedOutput.fullOutputPath,
							}
						: {}),
				},
			};
		},
	});
}
