import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
export async function withChatDb(fn: (db: PrismaClient) => Promise<void>) {
  const url = process.env.CHAT_TEST_DATABASE_URL;
  if (!url || url === process.env.DATABASE_URL)
    throw new Error(
      "Set a separate CHAT_TEST_DATABASE_URL to the disposable fortuna_chat_test database",
    );
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/fortuna_chat_test"
  )
    throw new Error(
      "Chat tests require the local disposable fortuna_chat_test database",
    );
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const admin = new PrismaClient({ datasources: { db: { url } } });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  // Copy the migrated public schema using pg_dump/psql, retaining constraints and indexes.
  const { execFileSync } = await import("node:child_process");
  // CHAT_TEST_DOCKER_CONTAINER runs pg_dump/psql in a named container instead of
  // the fortuna-chat-test compose project, so parallel worktrees can each use their own.
  const container = process.env.CHAT_TEST_DOCKER_CONTAINER;
  const inPostgres = (command: string[]) =>
    container
      ? ["exec", "-i", container, ...command]
      : ["compose", "-p", "fortuna-chat-test", "-f", "docker-compose.chat-test.yml", "exec", "-T", "postgres", ...command];
  const dump = execFileSync(
    "docker",
    inPostgres([
      "pg_dump",
      "-U",
      "chat_test",
      "-d",
      "fortuna_chat_test",
      "--schema-only",
      "--schema=public",
    ]),
    { encoding: "utf8" },
  );
  const ddl = dump
    .replaceAll("public.", `"${schema}".`)
    .replace(/CREATE SCHEMA public;/g, "")
    .replace(/ALTER SCHEMA public OWNER TO[^;]+;/g, "");
  execFileSync(
    "docker",
    inPostgres([
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "chat_test",
      "-d",
      "fortuna_chat_test",
    ]),
    { input: ddl, stdio: ["pipe", "pipe", "pipe"] },
  );
  parsed.searchParams.set("schema", schema);
  const db = new PrismaClient({
    datasources: { db: { url: parsed.toString() } },
  });
  try {
    await fn(db);
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
}
