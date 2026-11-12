import { Prisma } from "@prisma/client";

/**
 * The amount a search box entry names, if it is a number: "4.49", "$4.49",
 * "S$4.49" and "$1,200" all count. A whole number ("4", "$4") stands for the
 * whole dollar range 4.00–4.99; a number with cents matches that amount only.
 */
export function parseSearchAmount(
  search: string | undefined,
): { text: string; min: number; max?: number } | null {
  const text = (search ?? "").trim().replace(/^s?\$\s*/i, "");
  const match = /^(\d+|\d{1,3}(?:,\d{3})+)(\.\d{1,2})?$/.exec(text);
  if (!match) return null;
  const value = Number(`${match[1].replace(/,/g, "")}${match[2] ?? ""}`);
  if (!Number.isFinite(value)) return null;
  return match[2] ? { text, min: value } : { text, min: value, max: value + 1 };
}

/** Where clause for the transactions search box: description or label, or the amount. */
export function buildSearchWhere(search: string): Prisma.TransactionWhereInput {
  const amount = parseSearchAmount(search);
  const texts = amount && amount.text !== search ? [search, amount.text] : [search];
  const clauses: Prisma.TransactionWhereInput[] = texts.flatMap((text) => [
    { description: { contains: text, mode: "insensitive" } },
    { label: { contains: text, mode: "insensitive" } },
  ]);
  if (amount) {
    const range: { equals: number } | { gte: number; lt: number } =
      amount.max === undefined
        ? { equals: amount.min }
        : { gte: amount.min, lt: amount.max };
    clauses.push({ amountIn: range }, { amountOut: range });
  }
  return { OR: clauses };
}
