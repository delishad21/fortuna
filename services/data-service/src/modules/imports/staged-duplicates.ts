import { scoreDuplicatePair } from "../duplicates/duplicate-scoring";

export type StagedRowSummary = {
  draftId: string;
  rowId: string;
  rowIndex: number;
  filename: string;
  date: string;
  description: string;
  amountIn: number | null;
  amountOut: number | null;
  accountIdentifier?: string | null;
  metadata?: unknown;
  /** The row's full content (times, references, label), compared within one draft. Defaults to date, description and amounts. */
  content?: string;
  /** The source lists these rows separately (e.g. two people on the same bus), so even identical rows are not duplicates. */
  distinctWithinDraft?: boolean;
};

export type DuplicateFinding = {
  row: StagedRowSummary;
  match: StagedRowSummary & { source: "staged" | "saved" };
  score: number;
  reasons: string[];
};

/** What the row says, for spotting a line the same statement printed twice. */
function rowContent(row: StagedRowSummary) {
  return row.content ?? JSON.stringify([row.date, row.description, row.amountIn, row.amountOut]);
}

export function findStagedDuplicates(
  rows: StagedRowSummary[],
): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  for (let index = 0; index < rows.length; index++) {
    for (let prior = 0; prior < index; prior++) {
      // A statement lists each transaction once, so two of its lines are two
      // transactions however alike they look (two riders on one bus, the same
      // coffee every morning). Only a line repeated word for word, with the
      // same times and references, could be a parsing mistake.
      if (
        rows[index].draftId === rows[prior].draftId &&
        (rows[index].distinctWithinDraft ||
          rows[prior].distinctWithinDraft ||
          rowContent(rows[index]) !== rowContent(rows[prior]))
      )
        continue;
      const comparison = scoreDuplicatePair(rows[index], rows[prior]);
      if (!comparison) continue;
      findings.push({
        row: rows[index],
        match: { ...rows[prior], source: "staged" },
        ...comparison,
      });
    }
  }
  return findings;
}
