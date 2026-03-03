import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_API_TOKEN: string;
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "shirios-confluence",
    version: "1.0.0",
  });

  async init() {
    const base = "https://shirios.atlassian.net/wiki/rest/api/content";
    const auth = () => btoa(`${this.env.CONFLUENCE_EMAIL}:${this.env.CONFLUENCE_API_TOKEN}`);

    this.server.tool(
      "confluence_get_version",
      "Get the current version number and title of a Confluence page",
      { pageId: z.string().describe("Confluence page ID") },
      async ({ pageId }) => {
        const res = await fetch(`${base}/${pageId}?expand=version`, {
          headers: { Authorization: `Basic ${auth()}`, Accept: "application/json" },
        });
        const data = await res.json() as any;
        return {
          content: [{ type: "text", text: `Title: ${data.title}, Version: ${data.version?.number}` }],
        };
      }
    );

    this.server.tool(
      "confluence_update_page",
      "Update a Confluence page with new content",
      {
        pageId:  z.string().describe("Confluence page ID"),
        title:   z.string().describe("Page title"),
        version: z.number().describe("Next version number (current + 1)"),
        content: z.string().describe("Full page content in markdown"),
      },
      async ({ pageId, title, version, content }) => {
        const res = await fetch(`${base}/${pageId}`, {
          method: "PUT",
          headers: {
            Authorization: `Basic ${auth()}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            version: { number: version },
            title,
            type: "page",
            body: { storage: { value: content, representation: "wiki" } },
          }),
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return {
            content: [{ type: "text", text: `Error ${res.status}: ${JSON.stringify(data)}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: `Updated successfully. New version: ${data.version?.number}` }],
        };
      }
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