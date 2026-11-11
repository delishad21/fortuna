import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ParserFactoryService as factory } from "../../imports/parser-factory.service";
import { ChatContext, ChatError, idSchema } from "../contracts";
import { ToolDefinition } from "../providers/provider";

export const totalsDefinition: ToolDefinition = {
  name: "check_statement_totals",
  description:
    "Check a staged import against the statement's own figures in one call: the draft's money in, money out, row count and opening/closing balance per account and currency, compared with the balances and totals printed in the statement (read from its text) and the parser's own checks. Lists each difference. Use it after staging, before telling the user the import is complete, instead of reading the statement yourself. Visible only to you.",
  inputSchema: {
    type: "object",
    properties: { draftId: { type: "string" } },
    required: ["draftId"],
    additionalProperties: false,
  },
};

const MAX_TEXT_CALLS = 5;
const MAX_FIGURES = 40;
const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const money = (value: number) => (value / 100).toFixed(2);

type FigureKind = "opening" | "closing" | "moneyIn" | "moneyOut";
// Summary lines as banks and card issuers print them. Order matters: closing before
// opening, since "Total Balance Carried Forward" also says "balance".
const FIGURE_LINES: Array<[FigureKind, RegExp]> = [
  ["closing", /balance\s+carried\s+forward|balance\s+c\/f|closing\s+balance|new\s+balance|ending\s+balance|total\s+balance\s+for|statement\s+balance/i],
  ["opening", /balance\s+brought\s+forward|balance\s+b\/f|opening\s+balance|previous\s+(statement\s+)?balance|beginning\s+balance|balance\s+from\s+previous/i],
  ["moneyIn", /total\s+(deposits?|credits?|payments?\s+(and|&)\s+credits?|money\s+in|repayments?)|money\s+in\b/i],
  ["moneyOut", /total\s+(withdrawals?|debits?|charges|purchases|spending|money\s+out)|money\s+out\b/i],
];
const AMOUNT = /\(?-?(?:S\$|\$|SGD\s?)?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR)\b)?/gi;

export type PrintedFigure = {
  kind: FigureKind;
  value: string;
  credit?: boolean;
  page: number | null;
  line: string;
};

/** Balances and totals printed in the statement text, with the line each came from. */
export function printedFigures(pages: Array<{ page: number | null; text: string }>) {
  const figures: PrintedFigure[] = [];
  for (const { page, text } of pages)
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim().replace(/\s+/g, " ");
      const kind = FIGURE_LINES.find(([, pattern]) => pattern.test(line))?.[0];
      if (!kind) continue;
      const amounts = line.match(AMOUNT);
      if (!amounts) continue;
      const last = amounts[amounts.length - 1];
      figures.push({
        kind,
        value: money(cents(last.replace(/[^\d.]/g, ""))),
        ...(/CR\b/i.test(last) || /^\(.*\)$/.test(last.replace(/\s?(CR|DR)$/i, "")) || last.includes("-")
          ? { credit: true }
          : {}),
        page,
        line: line.length > 140 ? `${line.slice(0, 139)}…` : line,
      });
    }
  return figures;
}

type Payload = Record<string, any>;
const balanceOf = (p: Payload) =>
  p.balance === null || p.balance === undefined || p.balance === "" || !Number.isFinite(Number(p.balance))
    ? null
    : cents(p.balance);

/** Per account and currency: count, money in and out, and the balances the rows start and end on. */
export function draftFigures(payloads: Payload[]) {
  const groups = new Map<string, Payload[]>();
  for (const p of payloads) {
    const key = `${p.accountIdentifier || ""}|${p.currency || p.metadata?.currency || ""}`;
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [accountIdentifier, currency] = key.split("|");
    const moneyIn = rows.reduce((n, p) => n + cents(p.amountIn), 0);
    const moneyOut = rows.reduce((n, p) => n + cents(p.amountOut), 0);
    const balanced = rows.filter((p) => balanceOf(p) !== null);
    let opening: number | null = null;
    let closing: number | null = null;
    if (balanced.length) {
      // Statements listed newest first run backwards; pick the order the balances follow.
      const step = (a: Payload, b: Payload) =>
        balanceOf(a)! - cents(b.amountOut) + cents(b.amountIn) === balanceOf(b);
      const pairs = balanced.slice(1).map((p, i) => [balanced[i], p]);
      const forward = pairs.filter(([a, b]) => step(a, b)).length;
      const backward = pairs.filter(([a, b]) => step(b, a)).length;
      const ordered = backward > forward ? [...balanced].reverse() : balanced;
      const first = ordered[0];
      opening = balanceOf(first)! + cents(first.amountOut) - cents(first.amountIn);
      closing = balanceOf(ordered[ordered.length - 1]);
    }
    return {
      accountIdentifier: accountIdentifier || null,
      currency: currency || null,
      count: rows.length,
      moneyIn,
      moneyOut,
      opening,
      closing,
    };
  });
}

type Check = {
  accountIdentifier: string | null;
  currency: string | null;
  check: string;
  draft: string;
  statement: string | string[] | null;
  matches: boolean | null;
  difference?: string;
};

/** Each draft figure against the printed ones of the same kind. */
export function compareFigures(
  groups: ReturnType<typeof draftFigures>,
  figures: PrintedFigure[],
) {
  const checks: Check[] = [];
  const of = (kind: FigureKind) => figures.filter((f) => f.kind === kind);
  const compare = (
    group: (typeof groups)[number],
    check: string,
    value: number | null,
    printed: PrintedFigure[],
  ) => {
    if (value === null || !printed.length) return;
    const values = [...new Set(printed.map((f) => f.value))];
    const matches = values.some((v) => Math.abs(cents(v) - Math.abs(value)) === 0);
    checks.push({
      accountIdentifier: group.accountIdentifier,
      currency: group.currency,
      check,
      draft: money(value),
      statement: values.length === 1 ? values[0] : values.slice(0, 8),
      matches,
      // One draft group against one printed figure is a like-for-like difference.
      ...(!matches && groups.length === 1 && values.length === 1
        ? { difference: money(Math.abs(value) - cents(values[0])) }
        : {}),
    });
  };
  for (const group of groups) {
    compare(group, "opening balance", group.opening, of("opening"));
    compare(group, "closing balance", group.closing, of("closing"));
    compare(group, "money in", group.moneyIn, of("moneyIn"));
    compare(group, "money out", group.moneyOut, of("moneyOut"));
    // A card statement has no running balance: previous + charges - credits = new balance.
    const opening = of("opening");
    const closing = of("closing");
    if (group.opening === null && groups.length === 1 && opening.length === 1 && closing.length === 1) {
      const sign = (f: PrintedFigure) => (f.credit ? -1 : 1) * cents(f.value);
      const expected = sign(closing[0]) - sign(opening[0]);
      const net = group.moneyOut - group.moneyIn;
      checks.push({
        accountIdentifier: group.accountIdentifier,
        currency: group.currency,
        check: "net change (new balance - previous balance = money out - money in)",
        draft: money(net),
        statement: money(expected),
        matches: net === expected,
        ...(net !== expected ? { difference: money(net - expected) } : {}),
      });
    }
  }
  return checks;
}

export async function checkStatementTotals(
  db: PrismaClient,
  context: ChatContext,
  raw: unknown,
) {
  const { draftId } = z.object({ draftId: idSchema }).strict().parse(raw);
  const draft = await db.importDraft.findFirst({
    where: { id: draftId, userId: context.userId },
    select: {
      id: true,
      sourceFilename: true,
      parserId: true,
      sourceFile: { select: { id: true, deletedAt: true, status: true } },
      rows: { orderBy: { rowIndex: "asc" }, select: { currentPayload: true, selected: true } },
    },
  });
  if (!draft) throw new ChatError(404, "Import draft not found");
  const payloads = draft.rows.map((r) => (r.currentPayload || {}) as Payload);
  const groups = draftFigures(payloads);
  const parserWarnings = [
    ...new Set(
      payloads
        .map((p) => p.metadata?.parseWarning)
        .filter((w): w is string => typeof w === "string" && !!w.trim()),
    ),
  ].slice(0, 5);

  let figures: PrintedFigure[] = [];
  let pagesRead = 0;
  let statementNote: string | undefined;
  const file = draft.sourceFile;
  if (!file || file.deletedAt || file.status !== "available")
    statementNote = "The statement file is no longer available, so only the parser's checks are shown.";
  else
    try {
      let startPage: number | null = 1;
      for (let call = 0; call < MAX_TEXT_CALLS && startPage; call++) {
        const { fixture } = (await factory.inspectStatement(context.userId, file.id, startPage)) as {
          fixture: { pages?: Array<{ page: number; text: string }>; text?: string; nextPage?: number | null };
        };
        const pages = fixture.pages || (fixture.text ? [{ page: null as unknown as number, text: fixture.text }] : []);
        pagesRead += pages.length;
        figures.push(...printedFigures(pages));
        startPage = fixture.nextPage || null;
      }
      if (startPage) statementNote = `Read the first ${pagesRead} pages only.`;
    } catch (error) {
      statementNote = `The statement text couldn't be read (${(error as Error).message}), so only the parser's checks are shown.`;
    }
  figures = figures.slice(0, MAX_FIGURES);
  const checks = compareFigures(groups, figures);
  const mismatches = checks.filter((c) => c.matches === false);
  return {
    draftId: draft.id,
    filename: draft.sourceFilename,
    parserId: draft.parserId,
    draft: groups.map((g) => ({
      accountIdentifier: g.accountIdentifier,
      currency: g.currency,
      count: g.count,
      moneyIn: money(g.moneyIn),
      moneyOut: money(g.moneyOut),
      openingBalance: g.opening === null ? null : money(g.opening),
      closingBalance: g.closing === null ? null : money(g.closing),
    })),
    statement: { pagesRead, figures, ...(statementNote ? { note: statementNote } : {}) },
    ...(parserWarnings.length ? { parserWarnings } : {}),
    checks,
    result: !checks.length
      ? parserWarnings.length
        ? "The parser reported problems; see parserWarnings."
        : "Nothing to compare: the statement prints no balances or totals this check recognises. Compare the figures yourself only if the user asks."
      : mismatches.length
        ? `${mismatches.length} of ${checks.length} figures differ. Tell the user which, with the amounts; a missing or extra row usually explains a money in/out difference.`
        : `All ${checks.length} figures match the statement.`,
    note: "A statement that prints several accounts or currencies lists all their figures; a draft figure matches when any printed figure of the same kind equals it. Row counts are rarely printed, so count is the draft's only.",
  };
}
