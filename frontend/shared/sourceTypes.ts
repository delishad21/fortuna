/** Sources as the apps get them (data-service publicSource): how an account's or card's transactions reach the assistant. */
export const SOURCE_KINDS = [
  { value: "notification", label: "Phone notifications" },
  { value: "email", label: "Alert emails" },
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number]["value"];

export const SOURCE_CHANNELS = [
  { value: "main", label: "Main" },
  { value: "backup", label: "Backup" },
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number]["value"];

export interface TransactionSource {
  id: string;
  kind: SourceKind;
  name: string | null;
  accountId: string;
  cardId: string | null;
  account: { id: string; name: string; type: string; color: string };
  card: { id: string; last4: string; nickname: string | null; network: string | null } | null;
  /** App packages (notification) or sender addresses (email). */
  senders: string[];
  subjectPatterns: string[];
  textPatterns: string[];
  /** What ties a message to the account or card, e.g. "card ending 1234". */
  identifiers: string[];
  channel: SourceChannel;
  enabled: boolean;
  notes: string | null;
  /** Messages from it that reached Fortuna. */
  reportCount: number;
}

/** A source Fortuna can tell from imports; offered, never added by itself. */
export interface SourceSuggestion {
  key: string;
  accountId: string;
  accountName: string;
  cardId: string | null;
  kind: SourceKind;
  name: string;
  senders: string[];
  subjectPatterns: string[];
  textPatterns: string[];
  identifiers: string[];
  channel: SourceChannel;
  notes: string;
  why: string;
}

export interface SourceInput {
  kind: SourceKind;
  accountId?: string;
  cardId?: string | null;
  name?: string | null;
  senders: string[];
  subjectPatterns?: string[];
  textPatterns?: string[];
  identifiers?: string[];
  channel?: SourceChannel;
  enabled?: boolean;
  notes?: string | null;
}

export const sourceKindLabel = (kind: SourceKind) => SOURCE_KINDS.find((k) => k.value === kind)?.label || kind;
export const sendersLabel = (kind: SourceKind) => (kind === "email" ? "Sender addresses" : "App packages");
export const sendersPlaceholder = (kind: SourceKind) => (kind === "email" ? "e.g. alerts@bank.com" : "e.g. sg.com.transitlink");

/** "a, b\nc" → ["a", "b", "c"]; the form fields take several values separated by commas or lines. */
export const splitList = (text: string) => [...new Set(text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
export const joinList = (items: string[] | null | undefined) => (items || []).join(", ");

/** What a source reports: "UOB One · card 4591" or just the account. */
export const sourceTarget = (source: Pick<TransactionSource, "account" | "card">) =>
  source.card ? `${source.account.name} · card ${source.card.last4}` : source.account.name;

/** The source's name, else its first sender. */
export const sourceTitle = (source: Pick<TransactionSource, "name" | "senders" | "kind">) =>
  source.name?.trim() || source.senders[0] || sourceKindLabel(source.kind);
