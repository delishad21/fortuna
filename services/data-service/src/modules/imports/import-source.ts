export type ImportSourceStrategy =
  | "existing_source_filename"
  | "single_batch_filename"
  | "statement_month"
  | "transaction_month";

export interface ImportSourceInput {
  batchFilename?: string | null;
  transactionDate?: Date | string | null;
  metadata?: unknown;
}

export interface ImportSourceResult {
  filename: string;
  strategy: ImportSourceStrategy;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_PATTERN =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export const splitImportBatchFilenames = (filename?: string | null) =>
  (filename || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

export const extractMonthYearFromFilename = (filename: string) => {
  const normalized = filename.replace(/[_-]+/g, " ");
  const monthFirst = new RegExp(`${MONTH_PATTERN}\\s*(20\\d{2})`, "i").exec(
    normalized,
  );
  const yearFirst = new RegExp(`(20\\d{2})\\s*${MONTH_PATTERN}`, "i").exec(
    normalized,
  );
  const match = monthFirst
    ? { monthName: monthFirst[1], year: monthFirst[2] }
    : yearFirst
      ? { monthName: yearFirst[2], year: yearFirst[1] }
      : null;

  if (!match) return null;
  const month = MONTHS[match.monthName.toLowerCase()];
  const year = Number(match.year);
  if (!month || !Number.isInteger(year)) return null;
  return { year, month };
};

const getMetadata = (metadata: unknown) =>
  metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};

const getStringMetadata = (metadata: Record<string, unknown>, key: string) => {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const getNumberMetadata = (metadata: Record<string, unknown>, key: string) => {
  const value = metadata[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getStatementMonthYear = (metadata: Record<string, unknown>) => {
  const year = getNumberMetadata(metadata, "statementYear");
  const month = getNumberMetadata(metadata, "statementMonth");
  if (!year || !month) return null;
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  return { year, month };
};

const getTransactionMonthYear = (value?: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
};

const findUniqueFilenameForMonth = (
  filenames: string[],
  target: { year: number; month: number } | null,
) => {
  if (!target) return null;
  const matches = filenames.filter((filename) => {
    const monthYear = extractMonthYearFromFilename(filename);
    return monthYear?.year === target.year && monthYear.month === target.month;
  });
  return matches.length === 1 ? matches[0] : null;
};

export const inferImportSourceFilename = ({
  batchFilename,
  transactionDate,
  metadata,
}: ImportSourceInput): ImportSourceResult | null => {
  const cleanMetadata = getMetadata(metadata);
  const existingSourceFilename = getStringMetadata(
    cleanMetadata,
    "sourceFilename",
  );
  if (existingSourceFilename) {
    return {
      filename: existingSourceFilename,
      strategy: "existing_source_filename",
    };
  }

  const batchFilenames = splitImportBatchFilenames(batchFilename);
  if (batchFilenames.length === 1) {
    return {
      filename: batchFilenames[0],
      strategy: "single_batch_filename",
    };
  }
  if (batchFilenames.length === 0) return null;

  const statementFilename = findUniqueFilenameForMonth(
    batchFilenames,
    getStatementMonthYear(cleanMetadata),
  );
  if (statementFilename) {
    return { filename: statementFilename, strategy: "statement_month" };
  }

  const transactionFilename = findUniqueFilenameForMonth(
    batchFilenames,
    getTransactionMonthYear(transactionDate),
  );
  if (transactionFilename) {
    return { filename: transactionFilename, strategy: "transaction_month" };
  }

  return null;
};
