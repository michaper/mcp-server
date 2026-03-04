import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env extends Cloudflare.Env {
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_API_TOKEN: string;
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "shirios-confluence",
    version: "1.0.0",
  });

  async init() {
    const base = "https://shirios.atlassian.net/wiki/api/v2/pages";
    const headers = () => ({
      Authorization: `Basic ${btoa(`${this.env.CONFLUENCE_EMAIL}:${this.env.CONFLUENCE_API_TOKEN}`)}`,
      Accept: "application/json",
    });

    this.server.registerTool(
      "confluence_get_version",
      {
        description: "Get the current version number and title of a Confluence page",
        inputSchema: { pageId: z.string().describe("Confluence page ID") },
      },
      async ({ pageId }) => {
        const res = await fetch(`${base}/${pageId}?include-version=true`, { headers: headers() });
        const data: Record<string, unknown> = await res.json();
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
        }
        const version = data.version as Record<string, unknown> | undefined;
        return { content: [{ type: "text" as const, text: `Title: ${data.title}, Version: ${version?.number}` }] };
      },
    );

    this.server.registerTool(
      "confluence_update_page",
      {
        description: "Update a Confluence page with new content",
        inputSchema: {
          pageId: z.string().describe("Confluence page ID"),
          title: z.string().describe("Page title"),
          content: z.string().describe("Full page content in Confluence storage format (XHTML)"),
        },
      },
      async ({ pageId, title, content }) => {
        const versionRes = await fetch(`${base}/${pageId}?include-version=true`, { headers: headers() });
        const versionData: Record<string, unknown> = await versionRes.json();
        if (!versionRes.ok) {
          return { content: [{ type: "text" as const, text: `Error ${versionRes.status}: ${JSON.stringify(versionData)}` }], isError: true };
        }
        const currentVersion = versionData.version as Record<string, unknown> | undefined;
        const nextVersion = (typeof currentVersion?.number === "number" ? currentVersion.number : 0) + 1;

        const res = await fetch(`${base}/${pageId}`, {
          method: "PUT",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({
            id: pageId,
            status: "current",
            version: { number: nextVersion },
            title,
            body: { representation: "storage", value: content },
          }),
        });
        const data: Record<string, unknown> = await res.json();
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
        }
        const newVersion = data.version as Record<string, unknown> | undefined;
        return { content: [{ type: "text" as const, text: `Updated successfully. New version: ${newVersion?.number}` }] };
      },
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }
    if (url.pathname === "/sse") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    return new Response("ShiriOS MCP Server", { status: 200 });
  },
};
