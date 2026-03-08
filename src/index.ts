import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerConfluenceTools } from "./confluence.js";
import { registerGoogleScriptTools } from "./google_script.js";

export interface Env extends Cloudflare.Env {
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_API_TOKEN: string;
  GOOGLE_APPS_SCRIPT_URL: string;
  GOOGLE_APPS_SCRIPT_SECRET: string;
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "shirios-confluence",
    version: "1.0.0",
  });

  async init() {
    registerConfluenceTools(this.server, this.env);
    registerGoogleScriptTools(this.server, this.env);
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
