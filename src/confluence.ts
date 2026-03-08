import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface ConfluenceEnv {
  CONFLUENCE_EMAIL: string;
  CONFLUENCE_API_TOKEN: string;
}

export function registerConfluenceTools(server: McpServer, env: ConfluenceEnv) {
  const apiBase = "https://shirios.atlassian.net/wiki/api/v2";
  const pagesBase = `${apiBase}/pages`;
  const headers = () => ({
    Authorization: `Basic ${btoa(`${env.CONFLUENCE_EMAIL}:${env.CONFLUENCE_API_TOKEN}`)}`,
    Accept: "application/json",
  });

  server.registerTool(
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
      const res = await fetch(`${pagesBase}/${pageId}?${params}`, { headers: headers() });
      const data: Record<string, unknown> = await res.json();
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    "confluence_get_version",
    {
      description: "Get the current version number and title of a Confluence page",
      inputSchema: { pageId: z.string().describe("Confluence page ID") },
    },
    async ({ pageId }) => {
      const res = await fetch(`${pagesBase}/${pageId}?include-version=true`, { headers: headers() });
      const data: Record<string, unknown> = await res.json();
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
      }
      const version = data.version as Record<string, unknown> | undefined;
      return { content: [{ type: "text" as const, text: `Title: ${data.title}, Version: ${version?.number}` }] };
    },
  );

  server.registerTool(
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
      const versionRes = await fetch(`${pagesBase}/${pageId}?include-version=true`, { headers: headers() });
      const versionData: Record<string, unknown> = await versionRes.json();
      if (!versionRes.ok) {
        return { content: [{ type: "text" as const, text: `Error ${versionRes.status}: ${JSON.stringify(versionData)}` }], isError: true };
      }
      const currentVersion = versionData.version as Record<string, unknown> | undefined;
      const nextVersion = (typeof currentVersion?.number === "number" ? currentVersion.number : 0) + 1;

      const res = await fetch(`${pagesBase}/${pageId}`, {
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

  server.registerTool(
    "confluence_update_page_title",
    {
      description: "Update only the title of a Confluence page. Use when renaming without changing content.",
      inputSchema: {
        pageId: z.string().describe("Confluence page ID"),
        title: z.string().describe("New page title"),
      },
    },
    async ({ pageId, title }) => {
      const res = await fetch(`${pagesBase}/${pageId}/title`, {
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

  server.registerTool(
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
      const res = await fetch(pagesBase, {
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

  server.registerTool(
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
      const res = await fetch(`${pagesBase}/${pageId}${qs ? `?${qs}` : ""}`, { method: "DELETE", headers: headers() });
      if (res.status === 204) {
        return { content: [{ type: "text" as const, text: "Page deleted successfully." }] };
      }
      const data: Record<string, unknown> = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
    },
  );

  server.registerTool(
    "confluence_get_pages_for_label",
    {
      description:
        "Get Confluence pages that have a specified label. Returns paginated results with page metadata (id, title, spaceId, etc.).",
      inputSchema: {
        labelId: z.string().describe("Label ID (numeric)"),
        spaceId: z.string().optional().describe("Filter by space ID"),
        bodyFormat: z
          .enum(["storage", "atlas_doc_format", "view"])
          .optional()
          .describe("Body representation: storage (XHTML), atlas_doc_format, or view"),
        sort: z.string().optional().describe("Sort order (e.g. id, title, createdAt)"),
        cursor: z.string().optional().describe("Pagination cursor from previous response"),
        limit: z.number().optional().describe("Max results per page (default 25)"),
      },
    },
    async ({ labelId, spaceId, bodyFormat, sort, cursor, limit }) => {
      const params = new URLSearchParams();
      if (spaceId) params.set("space-id", spaceId);
      if (bodyFormat) params.set("body-format", bodyFormat);
      if (sort) params.set("sort", sort);
      if (cursor) params.set("cursor", cursor);
      if (limit != null) params.set("limit", String(limit));
      const qs = params.toString();
      const res = await fetch(`${apiBase}/labels/${labelId}/pages${qs ? `?${qs}` : ""}`, { headers: headers() });
      const data: Record<string, unknown> = await res.json();
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    "confluence_get_pages_in_space",
    {
      description:
        "Get all Confluence pages in a space. Returns paginated results. Supports filtering by status and title.",
      inputSchema: {
        spaceId: z.string().describe("Space ID"),
        depth: z.string().optional().describe("Page depth (all, root, etc.)"),
        sort: z.string().optional().describe("Sort order (e.g. id, title, createdAt)"),
        status: z.string().optional().describe("Filter by status (e.g. current, archived, draft)"),
        title: z.string().optional().describe("Filter by title (partial match)"),
        bodyFormat: z
          .enum(["storage", "atlas_doc_format", "view"])
          .optional()
          .describe("Body representation: storage (XHTML), atlas_doc_format, or view"),
        cursor: z.string().optional().describe("Pagination cursor from previous response"),
        limit: z.number().optional().describe("Max results per page (default 25)"),
      },
    },
    async ({ spaceId, depth, sort, status, title, bodyFormat, cursor, limit }) => {
      const params = new URLSearchParams();
      if (depth) params.set("depth", depth);
      if (sort) params.set("sort", sort);
      if (status) params.set("status", status);
      if (title) params.set("title", title);
      if (bodyFormat) params.set("body-format", bodyFormat);
      if (cursor) params.set("cursor", cursor);
      if (limit != null) params.set("limit", String(limit));
      const qs = params.toString();
      const res = await fetch(`${apiBase}/spaces/${spaceId}/pages${qs ? `?${qs}` : ""}`, { headers: headers() });
      const data: Record<string, unknown> = await res.json();
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error ${res.status}: ${JSON.stringify(data)}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
