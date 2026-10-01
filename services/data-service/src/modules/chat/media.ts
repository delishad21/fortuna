import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { CHAT_LIMITS, ChatError } from "./contracts";
import { ModelImage } from "./providers/provider";

/** Image formats every supported model accepts. Detected from content, never from the declared type. */
export function detectImageType(buffer: Buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")))
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("latin1")))
    return "image/gif";
  if (
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return null;
}
const isHeic = (buffer: Buffer) =>
  buffer.subarray(4, 8).toString("latin1") === "ftyp" &&
  /^(heic|heix|hevc|mif1|msf1|heis)$/.test(
    buffer.subarray(8, 12).toString("latin1"),
  );
export const IMAGE_NOT_STATEMENT =
  "This attachment is an image, already visible to you. Only statements can be inspected or staged.";
export const isImageType = (contentType: string) =>
  contentType.startsWith("image/");

/** Validate an upload that claims to be, or is, an image. Returns the trusted content type. */
export function classifyUpload(file: { mimetype: string; buffer: Buffer }) {
  const image = detectImageType(file.buffer);
  if (image) {
    if (file.buffer.length > CHAT_LIMITS.imageBytes)
      throw new ChatError(400, "Choose an image smaller than 10 MB.");
    return { kind: "image" as const, contentType: image };
  }
  if (isHeic(file.buffer) || file.mimetype.startsWith("image/"))
    throw new ChatError(
      400,
      isHeic(file.buffer)
        ? "HEIC photos aren't supported yet. Share the image as JPEG or PNG."
        : "Use a PNG, JPEG, WebP or GIF image.",
    );
  return { kind: "statement" as const, contentType: file.mimetype };
}

type Blocks = Array<{ type?: string; id?: string }>;
/**
 * Load the most recent image attachments in the replayed messages as model inputs.
 * Older, expired or deleted images stay as their text attachment blocks only.
 */
export async function loadModelImages(
  db: PrismaClient,
  userId: string,
  messages: Array<{ role: string; blocks: unknown }>,
) {
  const ids = messages
    .filter((m) => m.role === "user")
    .flatMap((m) =>
      Array.isArray(m.blocks)
        ? (m.blocks as Blocks)
            .filter((b) => b?.type === "attachment" && b.id)
            .map((b) => b.id!)
        : [],
    );
  if (!ids.length) return new Map<string, ModelImage>();
  const attachments = await db.chatAttachment.findMany({
    where: { id: { in: ids }, userId },
    include: { statementFile: true },
  });
  const byId = new Map(attachments.map((a) => [a.id, a]));
  const now = new Date();
  const recent = ids
    .filter((id) => {
      const file = byId.get(id)?.statementFile;
      return (
        file &&
        isImageType(file.contentType) &&
        !file.deletedAt &&
        (file.retained || file.expiresAt > now)
      );
    })
    .slice(-CHAT_LIMITS.modelImages);
  const images = new Map<string, ModelImage>();
  for (const id of recent) {
    const file = byId.get(id)!.statementFile;
    const data = await readFile(file.storagePath).catch(() => null);
    if (!data || detectImageType(data) !== file.contentType) continue;
    images.set(id, {
      attachmentId: id,
      filename: file.filename,
      dataUrl: `data:${file.contentType};base64,${data.toString("base64")}`,
    });
  }
  return images;
}
