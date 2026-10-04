"use server";

import { auth } from "@/lib/actionAuth";
import { prisma } from "@/lib/db/client";

export interface AccountIdentifier {
  id: string;
  accountIdentifier: string;
  /** Friendly name shown with the identifier; null when not set. */
  label: string | null;
  color: string;
}
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
    select: {
      id: true,
      accountIdentifier: true,
      label: true,
      color: true,
    },
    orderBy: {
      accountIdentifier: "asc",
    },
  });

  return accounts;
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
    select: {
      id: true,
      accountIdentifier: true,
      label: true,
      color: true,
    },
  });

  return account;
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
    select: {
      id: true,
      accountIdentifier: true,
      label: true,
      color: true,
    },
  });

  return account;
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
