"use server";

import { auth } from "@/lib/actionAuth";
import { prisma } from "@/lib/db/client";

/**
 * A statement identifier with the name and colour of the account it maps to
 * (label is the account's name), so screens keyed by identifier show accounts.
 * Manage accounts themselves with actions/accounts.ts.
 */
export interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  /** The account's name; null only for an identifier without an account. */
  label: string | null;
  color: string;
  accountId: string | null;
}

const identifierSelect = {
  id: true,
  accountIdentifier: true,
  label: true,
  color: true,
  accountId: true,
  account: { select: { name: true, color: true } },
} as const;

const withAccount = (row: {
  id: string;
  accountIdentifier: string;
  label: string | null;
  color: string;
  accountId: string | null;
  account: { name: string; color: string } | null;
}): AccountIdentifier => ({
  id: row.id,
  accountIdentifier: row.accountIdentifier,
  label: row.account?.name ?? row.label,
  color: row.account?.color ?? row.color,
  accountId: row.accountId,
});
const cleanLabel = (label: string | null | undefined) =>
  label === undefined ? undefined : label?.trim().slice(0, 80) || null;

export async function getAccountNumbers(): Promise<AccountIdentifier[]> {
  const session = await auth();

  if (!session?.user?.id) {
    return [];
  }

  const accounts = await prisma.accountIdentifier.findMany({
    where: {
      userId: session.user.id,
    },
    select: identifierSelect,
    orderBy: {
      accountIdentifier: "asc",
    },
  });

  return accounts.map(withAccount);
}

export async function upsertAccountNumber(
  accountIdentifier: string,
  color: string,
  label?: string | null,
): Promise<AccountIdentifier> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  // A new identifier gets an account of its own (database trigger); an
  // existing one renames and recolours its account.
  const account = await prisma.accountIdentifier.upsert({
    where: {
      userId_accountIdentifier: {
        userId: session.user.id,
        accountIdentifier,
      },
    },
    update: {
      color,
      ...(label !== undefined ? { label: cleanLabel(label) } : {}),
    },
    create: {
      userId: session.user.id,
      accountIdentifier,
      color,
      label: cleanLabel(label) ?? null,
    },
    select: identifierSelect,
  });
  if (account.accountId && account.account) {
    const name = cleanLabel(label);
    await prisma.financialAccount.update({
      where: { id: account.accountId },
      data: { color, ...(name ? { name } : {}) },
    });
    return { ...withAccount(account), color, label: name || account.account.name };
  }

  return withAccount(account);
}

export async function updateAccountIdentifier(
  id: string,
  accountIdentifier: string,
  color: string,
  label?: string | null,
): Promise<AccountIdentifier> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const existing = await prisma.accountIdentifier.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    throw new Error("Account not found or unauthorized");
  }

  const account = await prisma.accountIdentifier.update({
    where: { id },
    data: {
      accountIdentifier,
      color,
      ...(label !== undefined ? { label: cleanLabel(label) } : {}),
    },
    select: identifierSelect,
  });
  if (account.accountId) {
    const name = cleanLabel(label);
    await prisma.financialAccount.update({
      where: { id: account.accountId },
      data: { color, ...(name ? { name } : {}) },
    });
    return { ...withAccount(account), color, label: name || account.account?.name || null };
  }

  return withAccount(account);
}

export async function deleteAccountIdentifier(id: string): Promise<void> {
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const existing = await prisma.accountIdentifier.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    throw new Error("Account not found or unauthorized");
  }

  const transactionCount = await prisma.transaction.count({
    where: {
      userId: session.user.id,
      accountIdentifier: existing.accountIdentifier,
    },
  });

  if (transactionCount > 0) {
    throw new Error(
      "Account identifier is still used by existing transactions.",
    );
  }

  await prisma.accountIdentifier.delete({
    where: { id },
  });
}
