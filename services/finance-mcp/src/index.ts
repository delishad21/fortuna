import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { config } from "./config.js";
import { resolveAccountIdentity } from "./clients.js";
import { uploadStatement } from "./clients.js";
import { createFinanceMcpServer } from "./mcp.js";

function secretMatches(value: string | undefined, expected: string) {
  if (!value) return false;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match) return false;
  const actualBuffer = Buffer.from(match[1], "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requestHost(value: string | undefined) {
  return (value || "").split(":", 1)[0].toLowerCase();
}

const identity = await resolveAccountIdentity();
console.error(`Finance MCP bound to account ${identity.user.username} (${identity.user.id})`);

const handler = createMcpHandler(() => createFinanceMcpServer(identity), { responseMode: "json" });
const nodeHandler = toNodeHandler(handler);

async function readUpload(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 25 * 1024 * 1024) throw Object.assign(new Error("Statement exceeds 25 MB"), { status: 413 });
    chunks.push(buffer);
  }
  if (size === 0) throw Object.assign(new Error("Statement body is empty"), { status: 400 });
  return Buffer.concat(chunks);
}

const httpServer = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "finance-mcp" }));
    return;
  }
  if (request.url !== "/mcp" && request.url !== "/upload") {
    response.writeHead(404).end();
    return;
  }
  if (!config.allowedHosts.has(requestHost(request.headers.host))) {
    response.writeHead(403).end();
    return;
  }
  if (!secretMatches(request.headers.authorization, config.mcpClientToken)) {
    response.writeHead(401, { "WWW-Authenticate": "Bearer" });
    response.end(JSON.stringify({ error: "MCP client token required" }));
    return;
  }
  if (request.url === "/upload") {
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    try {
      const bytes = await readUpload(request);
      const filenameHeader = request.headers["x-filename"];
      const filename = Array.isArray(filenameHeader) ? filenameHeader[0] : filenameHeader;
      const result = await uploadStatement({
        bytes,
        filename: filename?.trim() || "statement",
        contentType: request.headers["content-type"] || "application/octet-stream",
      });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead((error as { status?: number }).status || 500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Upload failed" }));
    }
    return;
  }
  void nodeHandler(request, response);
});

httpServer.listen(config.port, config.host, () => {
  console.error(`Finance MCP listening on ${config.host}:${config.port}/mcp`);
});

async function shutdown() {
  httpServer.close();
  await handler.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
