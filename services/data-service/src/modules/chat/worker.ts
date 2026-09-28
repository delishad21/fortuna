import express from "express";
import { timingSafeEqual } from "node:crypto";
import prisma from "../../lib/prisma";
import { CodexRuntime } from "./providers/codex-runtime";
import { CodexProvider } from "./providers/codex";
import { OpenRouterProvider } from "./providers/openrouter";
import { ConnectionService } from "./connections.service";
import { RunRepository } from "./run.repository";
import { executeRun } from "./runner";
const runtime = new CodexRuntime(),
  codex = new CodexProvider(runtime),
  connections = new ConnectionService(prisma),
  repo = new RunRepository(prisma);
const stop = new AbortController();
const app = express();
app.use(express.json({ limit: "16kb" }));
let lastHeartbeat = 0;
app.get("/health", (_req, res) =>
  res
    .status(Date.now() - lastHeartbeat < 120000 ? 200 : 503)
    .json({
      service: "chat-worker",
      status: Date.now() - lastHeartbeat < 120000 ? "ok" : "stalled",
    }),
);
app.post("/codex/:operation", async (req, res) => {
  const expected = Buffer.from(process.env.INTERNAL_SERVICE_TOKEN || ""),
    actual = Buffer.from(req.header("x-internal-service-token") || "");
  if (
    !expected.length ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    return res.status(401).json({ error: "Authentication required" });
  const userId = req.header("x-authenticated-user-id");
  if (!userId)
    return res.status(401).json({ error: "Authentication required" });
  try {
    if (
      !(await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }))
    )
      return res.status(401).json({ error: "Authentication required" });
    switch (req.params.operation) {
      case "start":
        return res.json(await runtime.startLogin(userId));
      case "status":
        if (typeof req.body.loginId !== "string")
          return res.status(400).json({ error: "Login ID required" });
        return res.json(await runtime.loginStatus(userId, req.body.loginId));
      case "test":
        return res.json(await codex.testConnection(userId));
      case "disconnect":
        await runtime.disconnect(userId);
        return res.json({ disconnected: true });
      default:
        return res.status(404).json({ error: "Unknown operation" });
    }
  } catch {
    return res.status(503).json({ error: "Codex connection is unavailable" });
  }
});
const server = app.listen(Number(process.env.CHAT_WORKER_PORT || 4003));
const checkQueue = () =>
  prisma.$queryRaw`SELECT 1`
    .then(() => {
      lastHeartbeat = Date.now();
    })
    .catch(() => {});
void checkQueue();
const beat = setInterval(() => void checkQueue(), 10000);
async function loop() {
  while (!stop.signal.aborted) {
    try {
      if (process.env.CHAT_ENABLED === "true") {
        const run = await repo.claimRun();
        if (run) {
          const provider =
            run.provider === "codex"
              ? codex
              : new OpenRouterProvider((id) =>
                  connections.keyForUser(id, run.connectionGeneration),
                );
          await executeRun(prisma, run, provider, stop.signal);
          continue;
        }
      }
    } catch {
      console.error("Chat worker iteration failed; retrying");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
for (const name of ["SIGTERM", "SIGINT"])
  process.once(name, () => {
    stop.abort();
    runtime.close();
    clearInterval(beat);
    server.close();
  });
const concurrency = Math.max(
  1,
  Math.min(8, Number(process.env.CHAT_WORKER_CONCURRENCY) || 2),
);
void Promise.all(Array.from({ length: concurrency }, () => loop())).finally(
  async () => {
    await prisma.$disconnect();
  },
);
