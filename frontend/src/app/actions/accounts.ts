"use server";

import { auth } from "@/lib/actionAuth";
import { dataServiceRequest } from "@/lib/dataService";
import type { Account, AccountCard, AccountType, CardNetwork } from "@/lib/accountTypes";

/**
 * Accounts and cards for the web and mobile apps. They go through
 * data-service's /api/agent/accounts so the app, the API and the assistant
 * share one implementation (and its audit trail).
 */

async function userId() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}

const call = async <T>(path: string, method = "GET", body?: Record<string, unknown>) =>
  dataServiceRequest<T>(await userId(), `/api/agent/accounts${path}`, {
    method,
    ...(method === "GET" ? {} : { body: { ...body, confirmed: true } }),
  });
const id = (value: string) => encodeURIComponent(value);

export async function getAccounts(options: { includeArchived?: boolean } = {}): Promise<Account[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  const { accounts } = await call<{ accounts: Account[] }>(`?includeArchived=${options.includeArchived ? "true" : "false"}`);
  return accounts;
}

export async function createAccount(input: {
  name: string;
  institution?: string | null;
  type: AccountType;
  color: string;
  identifiers?: string[];
}): Promise<Account> {
  return (await call<{ account: Account }>("", "POST", input)).account;
}

export async function updateAccount(
  accountId: string,
  input: { name?: string; institution?: string | null; type?: AccountType; color?: string; archived?: boolean },
): Promise<Account> {
  return (await call<{ account: Account }>(`/${id(accountId)}`, "PATCH", input)).account;
}

export async function deleteAccount(accountId: string): Promise<void> {
  await call(`/${id(accountId)}`, "DELETE");
}

/** Keeps an automatically created account; it leaves the review list. */
export async function confirmAccount(accountId: string): Promise<Account> {
  return (await call<{ account: Account }>(`/${id(accountId)}/confirm`, "POST")).account;
}

/** Moves everything on accountId (identifiers, cards, transactions) onto intoAccountId and deletes it. */
export async function mergeAccount(accountId: string, intoAccountId: string): Promise<Account> {
  return (await call<{ account: Account }>(`/${id(accountId)}/merge`, "POST", { intoAccountId })).account;
}

/** Adds a statement identifier, moving it (and its transactions) from another account if needed. */
export async function addAccountIdentifier(accountId: string, identifier: string): Promise<Account> {
  return (await call<{ account: Account }>(`/${id(accountId)}/identifiers`, "POST", { identifier })).account;
}

export async function removeAccountIdentifier(identifierId: string): Promise<void> {
  await call(`/identifiers/${id(identifierId)}`, "DELETE");
}

export async function addCard(
  accountId: string,
  input: { last4: string; network?: CardNetwork | null; nickname?: string | null },
): Promise<AccountCard> {
  return (await call<{ card: AccountCard }>(`/${id(accountId)}/cards`, "POST", input)).card;
}

export async function updateCard(
  cardId: string,
  input: { last4?: string; network?: CardNetwork | null; nickname?: string | null; accountId?: string },
): Promise<AccountCard> {
  return (await call<{ card: AccountCard }>(`/cards/${id(cardId)}`, "PATCH", input)).card;
}

export async function deleteCard(cardId: string): Promise<void> {
  await call(`/cards/${id(cardId)}`, "DELETE");
}

type ImageResult = { imageId: string | null; imageUrl: string | null };

/** Sets an account's image from base64 bytes, or clears it with null. */
export async function setAccountImage(accountId: string, base64: string | null): Promise<ImageResult> {
  const user = await userId();
  return dataServiceRequest(user, `/api/agent/accounts/${id(accountId)}/image`, base64 ? { method: "PUT", body: { base64 } } : { method: "DELETE" });
}

/** Sets a card's own image from base64 bytes, or clears it (it then shows the account's). */
export async function setCardImage(cardId: string, base64: string | null): Promise<ImageResult> {
  const user = await userId();
  return dataServiceRequest(user, `/api/agent/accounts/cards/${id(cardId)}/image`, base64 ? { method: "PUT", body: { base64 } } : { method: "DELETE" });
}

/** Sets a transaction's image (merchant logo or receipt) from base64 bytes, or clears it. */
export async function setTransactionImage(transactionId: string, base64: string | null): Promise<ImageResult> {
  const user = await userId();
  return dataServiceRequest(user, `/api/agent/transactions/${id(transactionId)}/image`, base64 ? { method: "PUT", body: { base64 } } : { method: "DELETE" });
}
