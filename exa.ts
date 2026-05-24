// Portions of this file were adapted from pi-web-access by Nico Bailon.
// See THIRD_PARTY_NOTICES.md for the preserved upstream MIT notice.

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface ExaSearchOptions {
	numResults?: number;
	signal?: AbortSignal;
}

export interface ExaFetchOptions {
	maxCharacters?: number;
	signal?: AbortSignal;
}

interface ExaMcpContentItem {
	type?: string;
	text?: string;
}

interface ExaMcpRpcResponse {
	id?: string | number | null;
	result?: {
		content?: ExaMcpContentItem[];
		isError?: boolean;
	};
	error?: {
		message?: string;
	};
}

function createExaMcpError(): Error {
	return new Error(
		"Request failed. Service may be unavailable.",
	);
}

function getTextItems(content: ExaMcpContentItem[] | undefined): string[] {
	return (content ?? [])
		.flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text.trim()] : []))
		.filter((text) => text.length > 0);
}

function isRpcResponse(value: unknown): value is ExaMcpRpcResponse {
	return typeof value === "object"
		&& value !== null
		&& ("result" in value || "error" in value);
}

function parseJsonRpcResponses(text: string): ExaMcpRpcResponse[] {
	if (!text.trim()) {
		return [];
	}

	try {
		const parsed = JSON.parse(text) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.filter(isRpcResponse);
		}
		return isRpcResponse(parsed) ? [parsed] : [];
	} catch {
		return [];
	}
}

function parseSseResponses(body: string): ExaMcpRpcResponse[] {
	const responses: ExaMcpRpcResponse[] = [];
	let dataLines: string[] = [];

	const flushEvent = () => {
		if (dataLines.length === 0) return;
		const eventData = dataLines.join("\n");
		dataLines = [];
		if (eventData !== "[DONE]") {
			responses.push(...parseJsonRpcResponses(eventData));
		}
	};

	for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
		if (line === "") {
			flushEvent();
			continue;
		}

		if (line.startsWith(":")) continue;

		const colonIndex = line.indexOf(":");
		const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
		if (field !== "data") continue;

		let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		dataLines.push(value);
	}

	flushEvent();
	return responses;
}

function parseResponseBody(
	body: string,
	contentType: string | undefined,
): ExaMcpRpcResponse | null {
	const responses = contentType === "text/event-stream"
		? parseSseResponses(body)
		: parseJsonRpcResponses(body);
	return responses[responses.length - 1] ?? null;
}

export async function callExaMcp(
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	const requestId = 1;
	const response = await fetch(EXA_MCP_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: requestId,
			method: "tools/call",
			params: {
				name: toolName,
				arguments: args,
			},
		}),
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)])
			: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw createExaMcpError();
	}

	const body = await response.text();
	const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	const parsed = parseResponseBody(body, contentType);

	if (parsed?.error || parsed?.result?.isError) {
		throw createExaMcpError();
	}

	const text = getTextItems(parsed?.result?.content).join("\n\n");
	if (!text) {
		throw createExaMcpError();
	}
	return text;
}

export async function searchWithExa(query: string, options: ExaSearchOptions = {}): Promise<string> {
	return callExaMcp(
		"web_search_exa",
		{
			query,
			...(options.numResults !== undefined ? { numResults: options.numResults } : {}),
		},
		options.signal,
	);
}

export async function fetchWithExa(urls: string[], options: ExaFetchOptions = {}): Promise<string> {
	return callExaMcp(
		"web_fetch_exa",
		{
			urls,
			...(options.maxCharacters !== undefined ? { maxCharacters: options.maxCharacters } : {}),
		},
		options.signal,
	);
}
