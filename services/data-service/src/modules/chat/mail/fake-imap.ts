import { Readable } from "node:stream";
import { ImapFactory, ReadOnlyImap } from "./gmail";

// An in-memory mailbox for tests. It records every IMAP call so tests can check the
// client only ever opens read-only and searches the PayLah sender.

export type FakeMessage = { uid: number; from: string; date: string; messageId: string; html: string };
export type FakeCall = { op: string; args: unknown[] };

export function fakeImap(messages: FakeMessage[], options: { rejectLogin?: boolean } = {}) {
  const calls: FakeCall[] = [];
  const logins: Array<{ user: string; pass: string }> = [];
  const record = (op: string, ...args: unknown[]) => calls.push({ op, args });
  const factory: ImapFactory = (auth) => {
    logins.push(auth);
    const client: ReadOnlyImap = {
      async connect() {
        record("connect");
        if (options.rejectLogin)
          throw Object.assign(new Error("Invalid credentials (Failure)"), { authenticationFailed: true });
      },
      async list() {
        record("list");
        return [{ path: "INBOX", specialUse: "\\Inbox" }, { path: "[Gmail]/All Mail", specialUse: "\\All" }];
      },
      async mailboxOpen(path, opts) {
        record("mailboxOpen", path, opts);
      },
      async search(query, opts) {
        record("search", query, opts);
        // Like IMAP FROM, a substring match on the sender.
        return messages.filter((m) => m.from.includes(query.from)).map((m) => m.uid);
      },
      async fetchOne(uid, query, opts) {
        record("fetchOne", uid, query, opts);
        const m = messages.find((x) => String(x.uid) === uid);
        if (!m) return false;
        return {
          uid: m.uid,
          envelope: { date: new Date(m.date), messageId: m.messageId, from: [{ address: m.from }] },
          bodyStructure: {
            type: "multipart/mixed",
            childNodes: [{ part: "1", type: "text/html", size: m.html.length }],
          },
        };
      },
      async download(uid, part, opts) {
        record("download", uid, part, opts);
        const m = messages.find((x) => String(x.uid) === uid);
        return m ? { content: Readable.from([Buffer.from(m.html)]) } : {};
      },
      async logout() {
        record("logout");
      },
      close() {
        record("close");
      },
    };
    return client;
  };
  return { factory, calls, logins };
}
