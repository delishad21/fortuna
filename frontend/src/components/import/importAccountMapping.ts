import type { MultiFileParseResult } from "@/app/actions/parser";

export interface AccountIdentifierLike {
  id: string;
  accountIdentifier: string;
  color: string;
}

export interface TransactionLike {
  date: string;
  description: string;
  accountIdentifier?: string;
  accountNumber?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}

export const NEUTRAL_ACCOUNT_COLOR = "#9ca3af";

export function buildSourceAwareTransactions(
  results: MultiFileParseResult[],
): TransactionLike[] {
  return results
    .filter((result) => result.success)
    .flatMap((result) =>
      result.transactions.map((transaction) => {
        const accountIdentifier =
          transaction.accountIdentifier ||
          transaction.accountNumber ||
          result.accountIdentifier ||
          transaction.metadata?.accountIdentifier ||
          transaction.metadata?.accountNumber ||
          "";

        return {
          ...transaction,
          accountIdentifier: accountIdentifier || undefined,
          metadata: {
            ...(transaction.metadata || {}),
            sourceFilename: result.filename,
            parserId: result.parserId,
            ...(accountIdentifier ? { accountIdentifier } : {}),
          },
        };
      }),
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function detectNewAccountIdentifiers(
  transactions: Array<{ accountIdentifier?: string }>,
  savedAccounts: AccountIdentifierLike[],
): string[] {
  const saved = new Set(savedAccounts.map((account) => account.accountIdentifier));
  const seen = new Set<string>();
  const newAccounts: string[] = [];

  transactions.forEach((transaction) => {
    const accountIdentifier = String(transaction.accountIdentifier || "").trim();
    if (!accountIdentifier || saved.has(accountIdentifier) || seen.has(accountIdentifier)) {
      return;
    }
    seen.add(accountIdentifier);
    newAccounts.push(accountIdentifier);
  });

  return newAccounts;
}

export function resolveTransactionAccountColor(
  accountIdentifier: string | undefined,
  savedAccounts: AccountIdentifierLike[],
  pendingAccountColors: Map<string, string> = new Map(),
) {
  const normalized = String(accountIdentifier || "").trim();
  if (!normalized) return NEUTRAL_ACCOUNT_COLOR;

  const saved = savedAccounts.find(
    (account) => account.accountIdentifier === normalized,
  );
  return saved?.color || pendingAccountColors.get(normalized) || NEUTRAL_ACCOUNT_COLOR;
}

export function mergeFileParseStatuses<
  T extends {
    file: unknown;
    status: "pending" | "parsing" | "success" | "error";
    error?: string;
  },
>(files: T[], pendingFiles: T[], results: MultiFileParseResult[]): T[] {
  const resultByFile = new Map<unknown, MultiFileParseResult>();
  pendingFiles.forEach((fileState, index) => {
    resultByFile.set(fileState.file, results[index]);
  });

  return files.map((fileState) => {
    if (!resultByFile.has(fileState.file)) return fileState;

    const result = resultByFile.get(fileState.file);
    if (!result) {
      return {
        ...fileState,
        status: "error" as const,
        error: "Not found in results",
      };
    }
    if (!result.success) {
      return {
        ...fileState,
        status: "error" as const,
        error: result.error,
      };
    }
    return { ...fileState, status: "success" as const, error: undefined };
  });
}
