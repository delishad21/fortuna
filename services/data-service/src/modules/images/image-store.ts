import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Images for transactions (merchant logos, receipts), accounts and cards. The
 * files live under IMAGE_STORAGE_DIR (a volume on the server); the images
 * table holds one row per distinct file per user, so a logo the assistant
 * attaches to every Grab ride is stored once.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Db = PrismaClient | Prisma.TransactionClient;

export function imageStorageDir() {
  return process.env.IMAGE_STORAGE_DIR || "/data/images";
}

/** The image type from the file's first bytes; null when it isn't one we keep. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};

/** Saves the bytes as an image of the user, reusing an identical one. */
export async function saveImage(
  db: Db,
  userId: string,
  bytes: Uint8Array,
  options: { sourceUrl?: string | null } = {},
) {
  if (!bytes.length) fail(400, "The image is empty");
  if (bytes.length > MAX_IMAGE_BYTES)
    fail(413, `Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
  const contentType = sniffImageType(bytes);
  if (!contentType) fail(415, "Use a PNG, JPEG, GIF or WebP image");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.storedImage.findUnique({
    where: { userId_sha256: { userId, sha256 } },
  });
  if (existing) return existing;

  const storagePath = path.join(userId, `${randomUUID()}.${contentType!.split("/")[1]}`);
  const file = path.join(imageStorageDir(), storagePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { mode: 0o600 });
  try {
    return await db.storedImage.create({
      data: {
        userId,
        contentType: contentType!,
        sizeBytes: bytes.length,
        sha256,
        storagePath,
        sourceUrl: options.sourceUrl?.slice(0, 2000) || null,
      },
    });
  } catch (error) {
    await rm(file, { force: true });
    // Saved at the same time by another request.
    const raced = await db.storedImage.findUnique({
      where: { userId_sha256: { userId, sha256 } },
    });
    if (raced) return raced;
    throw error;
  }
}

/** The bytes of one of the user's images, or null when it isn't theirs. */
export async function readImage(db: Db, userId: string, imageId: string) {
  const image = await db.storedImage.findFirst({ where: { id: imageId, userId } });
  if (!image) return null;
  const file = path.resolve(imageStorageDir(), image.storagePath);
  if (!file.startsWith(path.resolve(imageStorageDir()) + path.sep)) return null;
  try {
    return { image, bytes: await readFile(file) };
  } catch {
    return null;
  }
}

/** Deletes an image once no transaction, account or card uses it. */
export async function deleteImageIfUnused(db: Db, imageId: string | null | undefined) {
  if (!imageId) return;
  const image = await db.storedImage.findUnique({
    where: { id: imageId },
    include: { _count: { select: { transactions: true, accounts: true, cards: true } } },
  });
  if (!image) return;
  const { transactions, accounts, cards } = image._count;
  if (transactions + accounts + cards > 0) return;
  await db.storedImage.delete({ where: { id: image.id } });
  await rm(path.join(imageStorageDir(), image.storagePath), { force: true });
}

function privateAddress(address: string) {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return privateAddress(lower.slice(7));
    return (
      lower === "::" || lower === "::1" || lower.startsWith("fc") ||
      lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") ||
      lower.startsWith("fea") || lower.startsWith("feb")
    );
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

async function assertPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(400, "The image URL isn't valid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    fail(400, "Image URLs must start with https:// or http://");
  if (url.username || url.password) fail(400, "Image URLs can't carry a username or password");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => fail(400, `Couldn't resolve ${host}`))).map(
        (entry) => entry.address,
      );
  if (!addresses.length || addresses.some(privateAddress))
    fail(400, "Image URLs must point to a public address");
  return url;
}

/**
 * Downloads an image from a public URL (no private or local addresses, at
 * most 3 redirects, each checked again, and at most MAX_IMAGE_BYTES).
 */
export async function fetchImage(raw: string, fetchImpl: typeof fetch = fetch) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop <= 3; hop += 1) {
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { accept: "image/*" },
    }).catch(() => fail(502, `Couldn't download ${url.hostname}`));
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) fail(502, "The image URL redirected nowhere");
      url = await assertPublicUrl(new URL(next!, url).toString());
      continue;
    }
    if (!response.ok) fail(502, `The image URL answered ${response.status}`);
    if (Number(response.headers.get("content-length") || 0) > MAX_IMAGE_BYTES)
      fail(413, `Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_IMAGE_BYTES) {
          await reader.cancel();
          fail(413, `Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
        }
        chunks.push(chunk.value);
      }
    return Buffer.concat(chunks);
  }
  return fail(502, "The image URL redirected too many times");
}

/** Image input accepted by the API: base64 bytes or a URL to download. */
export async function imageBytesFromInput(input: { base64?: string; url?: string }) {
  if (input.base64) {
    const cleaned = input.base64.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) fail(400, "base64 isn't valid base64");
    return { bytes: Buffer.from(cleaned, "base64"), sourceUrl: null };
  }
  if (input.url) return { bytes: await fetchImage(input.url), sourceUrl: input.url };
  return fail(400, "Send base64 or url");
}

/**
 * Deletes images nothing uses any more (their transaction was deleted, say),
 * leaving ones saved in the last hour alone in case they're about to be used.
 */
export async function cleanupUnusedImages(db: Db, now = new Date()) {
  const unused = await db.storedImage.findMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) },
      transactions: { none: {} },
      accounts: { none: {} },
      cards: { none: {} },
    },
    select: { id: true },
    take: 500,
  });
  for (const { id } of unused) await deleteImageIfUnused(db, id);
  return unused.length;
}
