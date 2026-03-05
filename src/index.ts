import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env extends Cloudflare.Env {
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_API_TOKEN: string;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  OAUTH_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  AUTHORIZED_EMAILS?: string;
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
      "confluence_get_page",
      {
        description: "Get a Confluence page by ID. Returns full page data including title, version, and body content.",
        inputSchema: {
          pageId: z.string().describe("Confluence page ID"),
          bodyFormat: z
            .enum(["storage", "atlas_doc_format", "view"])
            .optional()
            .describe("Body representation: storage (XHTML), atlas_doc_format, or view"),
        },
      },
      async ({ pageId, bodyFormat }) => {
        const params = new URLSearchParams({ "include-version": "true" });
        if (bodyFormat) params.set("body-format", bodyFormat);
        const res = await fetch(`${base}/${pageId}?${params}`, { headers: headers() });
        const data: Record<string, unknown> = await res.json();
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      },
    );

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

    this.server.registerTool(
      "confluence_update_page_title",
      {
        description: "Update only the title of a Confluence page. Use when renaming without changing content.",
        inputSchema: {
          pageId: z.string().describe("Confluence page ID"),
          title: z.string().describe("New page title"),
        },
      },
      async ({ pageId, title }) => {
        const res = await fetch(`${base}/${pageId}/title`, {
          method: "PUT",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ status: "current", title }),
        });
        const data: Record<string, unknown> = await res.json();
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: `Title updated to: ${data.title}` }] };
      },
    );

    this.server.registerTool(
      "confluence_create_page",
      {
        description: "Create a new Confluence page in a space.",
        inputSchema: {
          spaceId: z.string().describe("Space ID where the page will be created"),
          title: z.string().describe("Page title"),
          content: z.string().optional().describe("Page body in Confluence storage format (XHTML)"),
          parentId: z.string().optional().describe("Parent page ID for nested pages"),
          status: z.enum(["current", "draft"]).optional().describe("Page status (default: current)"),
        },
      },
      async ({ spaceId, title, content, parentId, status }) => {
        const body: Record<string, unknown> = {
          spaceId,
          status: status ?? "current",
          title,
        };
        if (parentId) body.parentId = parentId;
        if (content) body.body = { representation: "storage", value: content };
        const res = await fetch(base, {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data: Record<string, unknown> = await res.json();
        if (!res.ok) {
          return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
        }
        const newId = data.id as string | undefined;
        return { content: [{ type: "text" as const, text: `Page created. ID: ${newId}, Title: ${data.title}` }] };
      },
    );

    this.server.registerTool(
      "confluence_delete_page",
      {
        description:
          "Delete a Confluence page by ID. Moves page to trash. Use purge=true to permanently delete a trashed page, draft=true for drafts.",
        inputSchema: {
          pageId: z.string().describe("Confluence page ID"),
          purge: z.boolean().optional().describe("Permanently delete a trashed page (requires space admin)"),
          draft: z.boolean().optional().describe("Delete a draft page (discarded drafts are permanently deleted)"),
        },
      },
      async ({ pageId, purge, draft }) => {
        const params = new URLSearchParams();
        if (purge) params.set("purge", "true");
        if (draft) params.set("draft", "true");
        const qs = params.toString();
        const res = await fetch(`${base}/${pageId}${qs ? `?${qs}` : ""}`, { method: "DELETE", headers: headers() });
        if (res.status === 204) {
          return { content: [{ type: "text" as const, text: "Page deleted successfully." }] };
        }
        const data: Record<string, unknown> = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
      },
    );
  }
}

const defaultHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if (!oauthReqInfo.clientId) return new Response("Invalid request", { status: 400 });

      // Save the OAuth request info in KV keyed by a random state value (10 min TTL).
      // We retrieve it in /callback after GitHub redirects back.
      const state = crypto.randomUUID();
      await env.OAUTH_KV.put(`gh_state:${state}`, JSON.stringify(oauthReqInfo), { expirationTtl: 600 });

      const githubUrl = new URL("https://github.com/login/oauth/authorize");
      githubUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      githubUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
      githubUrl.searchParams.set("scope", "user:email");
      githubUrl.searchParams.set("state", state);
      return Response.redirect(githubUrl.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return new Response("Invalid callback", { status: 400 });

      const oauthReqInfoRaw = await env.OAUTH_KV.get(`gh_state:${state}`);
      if (!oauthReqInfoRaw) return new Response("State expired or invalid", { status: 400 });
      await env.OAUTH_KV.delete(`gh_state:${state}`);
      const oauthReqInfo = JSON.parse(oauthReqInfoRaw) as Awaited<
        ReturnType<typeof env.OAUTH_PROVIDER.parseAuthRequest>
      >;

      // Exchange the GitHub code for an access token
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${url.origin}/callback`,
        }),
      });
      const tokenData = (await tokenRes.json()) as Record<string, unknown>;
      const githubToken = tokenData.access_token as string | undefined;
      if (!githubToken) return new Response("GitHub authentication failed", { status: 401 });

      // Fetch the user's verified primary email from GitHub
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${githubToken}`, "User-Agent": "mcp-server" },
      });
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const email = emails.find((e) => e.primary && e.verified)?.email;
      if (!email) return new Response("No verified primary email on GitHub account", { status: 401 });

      const allowedEmails = (env.AUTHORIZED_EMAILS ?? "matanper@gmail.com,michaper@gmail.com")
        .split(",")
        .map((e) => e.trim().toLowerCase());
      if (!allowedEmails.includes(email.toLowerCase())) {
        return new Response("Forbidden", { status: 403 });
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: email,
        metadata: { label: email },
        scope: oauthReqInfo.scope,
        props: { email },
      });
      return Response.redirect(redirectTo, 302);
    }

    if (url.pathname === "/sse") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }
    return new Response("ShiriOS MCP Server", { status: 200 });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: MyMCP.serve("/mcp"),
  defaultHandler: { fetch: defaultHandler.fetch },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
