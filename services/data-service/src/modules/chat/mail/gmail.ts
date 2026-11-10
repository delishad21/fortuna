import { PrismaClient } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { z } from "zod";
import { ChatError } from "../contracts";
import { EncryptedSecret, openCredential, sealCredential } from "../credentials";
import {
  PAYLAH_ALERT_SENDER,
  PAYLAH_ALERT_SUBJECT,
  PAYLAH_SEARCH_PADDING_DAYS,
} from "../../imports/paylah-emails";
import { alertText, PaylahAlert, parsePaylahAlert } from "./paylah-alerts";

// Gmail over IMAP with an app password. The password opens the whole mailbox, so the
// read-only guarantee lives here: the mailbox is only ever opened with EXAMINE, and the
// client type below has no way to set flags, move, delete, append or send.

export const GMAIL_IMAP = { host: "imap.gmail.com", port: 993, secure: true } as const;
export const PAYLAH_RESULT_LIMIT = 300;
const MAX_WINDOW_DAYS = 93;
const MAX_BODY_BYTES = 256 * 1024;
const PURPOSE = "gmail-imap" as const;

type Structure = { part?: string; type: string; size?: number; disposition?: string; childNodes?: Structure[] };
type Envelope = { date?: Date | string; messageId?: string; from?: { address?: string }[] };

/** The only IMAP operations Fortuna uses. Everything here is read-only. */
export type ReadOnlyImap = {
  connect(): Promise<void>;
  list(): Promise<{ path: string; specialUse?: string }[]>;
  mailboxOpen(path: string, options: { readOnly: true }): Promise<unknown>;
  search(
    query: { from: string; subject: string; since: Date; before: Date },
    options: { uid: true },
  ): Promise<number[] | false | undefined>;
  fetchOne(
    uid: string,
    query: { uid: true; envelope: true; bodyStructure: true; internalDate: true },
    options: { uid: true },
  ): Promise<{ uid: number; envelope?: Envelope; bodyStructure?: Structure; internalDate?: Date | string } | false>;
  download(
    uid: string,
    part: string,
    options: { uid: true; maxBytes: number },
  ): Promise<{ content?: AsyncIterable<Buffer | string> }>;
  logout(): Promise<void>;
  close(): void;
};
export type ImapFactory = (auth: { user: string; pass: string }) => ReadOnlyImap;

export const imapflowFactory: ImapFactory = (auth) => {
  const client = new ImapFlow({
    ...GMAIL_IMAP,
    auth,
    // imapflow logs protocol traffic; keep it off so nothing from the session reaches logs.
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  });
  // Socket errors also reject the pending command; without a listener they would crash the process.
  client.on("error", () => undefined);
  return client as unknown as ReadOnlyImap;
};

export const mailConnectSchema = z
  .object({
    address: z.string().trim().toLowerCase().email().max(254),
    // Google shows app passwords as four groups of four letters; spaces are cosmetic.
    password: z
      .string()
      .transform((v) => v.replace(/\s+/g, ""))
      .pipe(z.string().min(8).max(64)),
  })
  .strict();

export const paylahSearchSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  })
  .strict();

const dayMs = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function findTextPart(node: Structure | undefined, depth = 0): Structure | null {
  if (!node || depth > 8) return null;
  if (node.childNodes?.length) {
    const parts = node.childNodes.map((child) => findTextPart(child, depth + 1)).filter(Boolean) as Structure[];
    return parts.find((p) => p.type === "text/plain") || parts.find((p) => p.type === "text/html") || null;
  }
  if (node.disposition === "attachment") return null;
  return node.type === "text/plain" || node.type === "text/html" ? node : null;
}

async function readLimited(stream: AsyncIterable<Buffer | string>) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) break;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function withClient<T>(client: ReadOnlyImap, fn: () => Promise<T>) {
  try {
    await client.connect();
    return await fn();
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function connectError(error: unknown): never {
  const e = error as { authenticationFailed?: boolean; responseText?: string };
  if (e?.authenticationFailed)
    throw new ChatError(
      400,
      "Gmail rejected the address or app password. Check both, and that 2-Step Verification is on for the account.",
    );
  throw new ChatError(502, "Could not reach Gmail. Try again shortly.");
}

export type PaylahSearchResult = {
  window: { from: string; to: string };
  emails: Array<PaylahAlert & { messageId: string }>;
  truncated: boolean;
  unreadable: number;
};

/**
 * PayLah payment alerts sent in [from - 3 days, to + 3 days], as parsed fields only.
 * Gmail's All Mail is searched so archived alerts are found too; each IMAP message is
 * one email, so Gmail's conversation threading does not hide any of them.
 */
export async function searchPaylahAlerts(client: ReadOnlyImap, raw: unknown): Promise<PaylahSearchResult> {
  const input = paylahSearchSchema.parse(raw);
  const start = new Date(`${input.from}T00:00:00Z`);
  const end = new Date(`${input.to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start)
    throw new ChatError(400, "Give a valid from/to date range");
  if ((end.getTime() - start.getTime()) / dayMs > MAX_WINDOW_DAYS)
    throw new ChatError(400, `Search at most ${MAX_WINDOW_DAYS} days at a time`);
  const windowFrom = isoDay(new Date(start.getTime() - PAYLAH_SEARCH_PADDING_DAYS * dayMs));
  const windowTo = isoDay(new Date(end.getTime() + PAYLAH_SEARCH_PADDING_DAYS * dayMs));
  return withClient(client, async () => {
    const boxes = await client.list();
    const mailbox = boxes.find((b) => b.specialUse === "\\All")?.path || "INBOX";
    // readOnly makes imapflow send EXAMINE, so the server keeps every flag as it is.
    await client.mailboxOpen(mailbox, { readOnly: true });
    // IMAP dates are whole days in the server's zone; search a day wider and filter on
    // the SGT date from each body below.
    const uids =
      (await client.search(
        {
          from: PAYLAH_ALERT_SENDER,
          subject: PAYLAH_ALERT_SUBJECT,
          since: new Date(new Date(`${windowFrom}T00:00:00Z`).getTime() - dayMs),
          before: new Date(new Date(`${windowTo}T00:00:00Z`).getTime() + 2 * dayMs),
        },
        { uid: true },
      )) || [];
    const emails: PaylahSearchResult["emails"] = [];
    let unreadable = 0;
    let truncated = false;
    for (const uid of [...uids].sort((a, b) => a - b)) {
      if (emails.length >= PAYLAH_RESULT_LIMIT) {
        truncated = true;
        break;
      }
      const message = await client.fetchOne(
        String(uid),
        { uid: true, envelope: true, bodyStructure: true, internalDate: true },
        { uid: true },
      );
      if (!message) continue;
      // IMAP FROM matches substrings; only the exact sender counts.
      const sender = message.envelope?.from?.[0]?.address?.toLowerCase();
      if (sender !== PAYLAH_ALERT_SENDER) continue;
      const part = findTextPart(message.bodyStructure);
      if (!part || (part.size ?? 0) > MAX_BODY_BYTES) {
        unreadable += 1;
        continue;
      }
      const download = await client.download(String(uid), part.part || "1", {
        uid: true,
        maxBytes: MAX_BODY_BYTES,
      });
      if (!download.content) {
        unreadable += 1;
        continue;
      }
      const text = alertText(await readLimited(download.content), part.type === "text/html");
      const sent = new Date(message.envelope?.date || message.internalDate || NaN);
      const alert = parsePaylahAlert(text, sent);
      if (!alert) {
        unreadable += 1;
        continue;
      }
      if (alert.date < windowFrom || alert.date > windowTo) continue;
      emails.push({
        ...alert,
        messageId: String(message.envelope?.messageId || `uid:${uid}`).slice(0, 300),
      });
    }
    emails.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
    return { window: { from: windowFrom, to: windowTo }, emails, truncated, unreadable };
  }).catch((error) => {
    if (error instanceof ChatError || error instanceof z.ZodError) throw error;
    return connectError(error);
  });
}

export type MailSettings = {
  connected: boolean;
  provider: "gmail";
  address: string | null;
  checkedAt: Date | null;
};

/** Per-user Gmail connection. The app password is sealed at rest and never returned. */
export class MailConnectionService {
  constructor(
    private db: PrismaClient,
    private factory: ImapFactory = imapflowFactory,
  ) {}
  async settings(userId: string): Promise<MailSettings> {
    const record = await this.db.mailConnection.findUnique({
      where: { userId },
      select: { address: true, checkedAt: true },
    });
    return {
      connected: !!record,
      provider: "gmail",
      address: record?.address ?? null,
      checkedAt: record?.checkedAt ?? null,
    };
  }
  /** Logs in once to prove the address and app password work, then stores them. */
  async connect(userId: string, raw: unknown) {
    const parsed = mailConnectSchema.safeParse(raw);
    if (!parsed.success)
      throw new ChatError(400, "Enter your Gmail address and the 16-letter app password from your Google Account.");
    const input = parsed.data;
    await withClient(this.factory({ user: input.address, pass: input.password }), async () => undefined).catch(
      connectError,
    );
    const secret = sealCredential(userId, input.password, PURPOSE) as unknown as object;
    await this.db.mailConnection.upsert({
      where: { userId },
      create: { userId, address: input.address, secret, checkedAt: new Date() },
      update: { address: input.address, secret, checkedAt: new Date() },
    });
    return this.settings(userId);
  }
  async disconnect(userId: string) {
    await this.db.mailConnection.deleteMany({ where: { userId } });
    return this.settings(userId);
  }
  /** A fresh read-only client for the user's mailbox. */
  async client(userId: string) {
    const record = await this.db.mailConnection.findUnique({ where: { userId } });
    if (!record)
      throw new ChatError(
        409,
        "No mailbox is connected. Ask the user to connect Gmail in Settings → AI (Gmail for PayLah emails) first.",
      );
    let pass: string;
    try {
      pass = openCredential(userId, record.secret as unknown as EncryptedSecret, PURPOSE);
    } catch {
      throw new ChatError(409, "The saved Gmail app password can't be read. Ask the user to connect Gmail again in Settings.");
    }
    return this.factory({ user: record.address, pass });
  }
  async searchPaylah(userId: string, raw: unknown) {
    paylahSearchSchema.parse(raw);
    return searchPaylahAlerts(await this.client(userId), raw);
  }
}
