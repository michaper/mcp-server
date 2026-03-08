import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface GoogleScriptEnv {
  GOOGLE_APPS_SCRIPT_URL: string;
  GOOGLE_APPS_SCRIPT_SECRET: string;
}

async function callAppsScript(
  url: string,
  secret: string,
  action: string,
  params: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, action, params }),
  });
  return res.text();
}

export function registerGoogleScriptTools(server: McpServer, env: GoogleScriptEnv) {
  const { GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET } = env;

  server.registerTool(
    "gdrive_list_files",
    {
      description: "List all ShiriOS files in Google Drive",
      inputSchema: {},
    },
    async () => {
      const text = await callAppsScript(GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET, "list_files");
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "gdrive_get_file",
    {
      description: "Get the content of a file by its Drive file ID",
      inputSchema: {
        fileId: z.string().describe("The Google Drive file ID"),
      },
    },
    async ({ fileId }) => {
      const text = await callAppsScript(GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET, "get_file", { fileId });
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "gdrive_update_file",
    {
      description: "Update the content of an existing file",
      inputSchema: {
        fileId: z.string().describe("The Google Drive file ID"),
        content: z.string().describe("The new content to write"),
      },
    },
    async ({ fileId, content }) => {
      const text = await callAppsScript(GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET, "update_file", {
        fileId,
        content,
      });
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "gdrive_create_file",
    {
      description: "Create a new file in the ShiriOS Drive folder",
      inputSchema: {
        title: z.string().describe("The filename"),
        content: z.string().describe("The initial content"),
      },
    },
    async ({ title, content }) => {
      const text = await callAppsScript(GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET, "create_file", {
        title,
        content,
      });
      return { content: [{ type: "text" as const, text }] };
    },
  );

  server.registerTool(
    "gdrive_delete_file",
    {
      description: "Delete a file by its Drive file ID",
      inputSchema: {
        fileId: z.string().describe("The Google Drive file ID"),
      },
    },
    async ({ fileId }) => {
      const text = await callAppsScript(GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_SECRET, "delete_file", {
        fileId,
      });
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
