/** Accounts and cards as the apps get them (data-service publicAccount). */
export const ACCOUNT_TYPES = [
  { value: "savings", label: "Savings" },
  { value: "current", label: "Current" },
  { value: "credit_card", label: "Credit card" },
  { value: "other", label: "Other" },
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number]["value"];

export const CARD_NETWORKS = [
  { value: "visa", label: "Visa" },
  { value: "mastercard", label: "Mastercard" },
  { value: "amex", label: "Amex" },
  { value: "unionpay", label: "UnionPay" },
  { value: "jcb", label: "JCB" },
  { value: "discover", label: "Discover" },
  { value: "nets", label: "NETS" },
  { value: "other", label: "Other" },
] as const;
export type CardNetwork = (typeof CARD_NETWORKS)[number]["value"];

export interface AccountCard {
  id: string;
  accountId: string;
  last4: string;
  network: CardNetwork | null;
  nickname: string | null;
  /** The card's own image; null when it uses its account's. */
  imageId: string | null;
  /** The image to show: the card's own, else its account's. */
  imageUrl: string | null;
}

export interface Account {
  id: string;
  name: string;
  institution: string | null;
  type: AccountType;
  color: string;
  archived: boolean;
  /** Created automatically (by the assistant) and not yet confirmed or merged. */
  autoCreated: boolean;
  /** What it was created from, e.g. "identifier:532392****2124" or "card:1234". */
  autoCreatedFrom: string | null;
  imageId: string | null;
  imageUrl: string | null;
  identifiers: Array<{ id: string; identifier: string }>;
  cards: AccountCard[];
  transactionCount: number;
}

/** A card as people read it: "Nickname ·· 1234" or "Visa ·· 1234". */
export const cardDisplay = (card: Pick<AccountCard, "last4" | "network" | "nickname">) => {
  const network = CARD_NETWORKS.find((n) => n.value === card.network)?.label;
  return `${card.nickname?.trim() || network || "Card"} ·· ${card.last4}`;
};

/** Where an automatically created account came from, in words. */
export const autoCreatedFromDisplay = (from: string | null | undefined) => {
  if (!from) return "Created automatically";
  const [kind, ...rest] = from.split(":");
  const value = rest.join(":");
  if (kind === "card") return `Created automatically from card ending ${value}`;
  if (kind === "identifier") return `Created automatically from statement identifier ${value}`;
  return `Created automatically from ${from}`;
};
