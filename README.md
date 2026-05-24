# Pi Exa Web Access

Minimal Pi extension that adds two Exa MCP backed tools:

- `web_search` for search results
- `fetch_content` for fetching page content as text/markdown-like output

The extension sends requests to Exa's hosted MCP endpoint at `https://mcp.exa.ai/mcp` and returns the text content from the response.

## Tools

### `web_search`

Search the web with a query.

```typescript
web_search({
  query: "latest TypeScript release notes",
  numResults: 5
})
```

Arguments:

- `query` (required): search query string
- `numResults` (optional): number of results to request, default 5, maximum 20.

### `fetch_content`

Fetch the content of one or more URLs.

```typescript
fetch_content({
  urls: ["https://example.com/article"],
  maxCharacters: 3000
})
```

Arguments:

- `urls` (required): one or more URLs
- `maxCharacters` (optional): maximum characters to return per URL, default 3000 

## Error handling

- Requests use a 60 second timeout.
- If Exa returns an HTTP error, RPC error, or empty response, the tool throws: `Request failed. Service may be unavailable.`

## Attribution

This project includes code adapted from [`pi-web-access`](https://github.com/nicobailon/pi-web-access) by Nico Bailon.
