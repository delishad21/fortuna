/** How an account is shown to people: its label with the identifier, or just the identifier. */
export type NamedAccount = { accountIdentifier: string; label?: string | null };

export const accountDisplay = (account: NamedAccount) =>
  account.label?.trim()
    ? `${account.label.trim()} · ${account.accountIdentifier}`
    : account.accountIdentifier;

/** Display names keyed by identifier, for places that only hold the identifier. */
export const accountDisplayMap = (accounts: NamedAccount[] = []) =>
  Object.fromEntries(accounts.map((a) => [a.accountIdentifier, accountDisplay(a)]));

/** Display a bare identifier, using its account's label when one is known. */
export const accountName = (
  identifier: string | null | undefined,
  accounts: NamedAccount[] | Record<string, string> = [],
) => {
  if (!identifier) return "";
  if (!Array.isArray(accounts)) return accounts[identifier] || identifier;
  const found = accounts.find((a) => a.accountIdentifier === identifier);
  return found ? accountDisplay(found) : identifier;
};
