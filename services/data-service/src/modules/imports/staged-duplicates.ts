export type StagedRowSummary = {
  draftId: string;
  rowId: string;
  rowIndex: number;
  filename: string;
  date: string;
  description: string;
  amountIn: number | null;
  amountOut: number | null;
};

export type DuplicateFinding = {
  row: StagedRowSummary;
  match: StagedRowSummary & { source: "staged" | "saved" };
  score: number;
  reasons: string[];
};

function bigrams(value: string) {
  const pairs: string[] = [];
  for (let index = 0; index < value.length - 1; index++) {
    pairs.push(value.slice(index, index + 2));
  }
  return pairs;
}

function descriptionSimilarity(left: string, right: string) {
  const first = left.toLowerCase();
  const second = right.toLowerCase();
  if (first === second) return 1;
  if (first.length < 2 || second.length < 2) return 0;
  const firstPairs = bigrams(first);
  const secondPairs = bigrams(second);
  const shared = firstPairs.filter((pair) => secondPairs.includes(pair)).length;
  return (2 * shared) / (firstPairs.length + secondPairs.length);
}

export function compareStagedRows(left: StagedRowSummary, right: StagedRowSummary) {
  const days = Math.abs(new Date(left.date).getTime() - new Date(right.date).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days > 2) return null;
  const sameCredit = left.amountIn != null && left.amountIn > 0 && left.amountIn === right.amountIn;
  const sameDebit = left.amountOut != null && left.amountOut > 0 && left.amountOut === right.amountOut;
  if (!sameCredit && !sameDebit) return null;

  const reasons: string[] = [];
  let score = 0.3;
  reasons.push("Exact amount match");
  if (days === 0) {
    score += 0.3;
    reasons.push("Same date");
  } else {
    score += 0.15;
    reasons.push(`Date within ${Math.ceil(days)} days`);
  }
  const similarity = descriptionSimilarity(left.description, right.description);
  if (similarity === 1) {
    score += 0.4;
    reasons.push("Exact description match");
  } else if (similarity >= 0.9) {
    score += 0.3;
    reasons.push("Very similar description");
  } else if (similarity >= 0.7) {
    score += 0.2;
    reasons.push("Similar description");
  } else if (similarity >= 0.5) {
    score += 0.1;
    reasons.push("Somewhat similar description");
  }
  return score >= 0.8 ? { score, reasons } : null;
}

export function findStagedDuplicates(rows: StagedRowSummary[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  for (let index = 0; index < rows.length; index++) {
    for (let prior = 0; prior < index; prior++) {
      const comparison = compareStagedRows(rows[index], rows[prior]);
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
