const PARSER_SERVICE_URL =
  process.env.PARSER_SERVICE_URL || "http://file-parser:4000";

/** Each parser's current version as the parser service reports it ("builtin-<hash>" or "dynamic-v<n>"). */
export async function currentParserVersions(userId: string) {
  const response = await fetch(
    new URL("/parsers?mode=all", PARSER_SERVICE_URL),
    {
      headers: {
        "X-Internal-Service-Token": process.env.INTERNAL_SERVICE_TOKEN || "",
        "X-Authenticated-User-Id": userId,
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`Parsers returned ${response.status}`);
  const body = (await response.json()) as {
    parsers?: Array<{ id?: string; parserVersion?: string }>;
  };
  return new Map(
    (body.parsers || []).flatMap((p) =>
      p.id && p.parserVersion ? [[p.id, p.parserVersion] as const] : [],
    ),
  );
}

/**
 * What to tell the chat when a draft was staged by a different parser version
 * than the one that would parse it now; null when they match or can't be told.
 */
export function staleParserNote(
  parserId: string | null,
  stagedVersion: string | null,
  currentVersion: string | undefined,
) {
  if (!parserId || !currentVersion || stagedVersion === currentVersion)
    return null;
  if (stagedVersion === "assistant") return null;
  const how =
    "Its rows show what that version produced, not what the current parser does. To use the current one, propose restage_draft: it re-parses the statement and keeps labels, categories, metadata and reimbursement links on rows that still match. Don't judge or rebuild the parser from these rows.";
  return `Staged with an older version of ${parserId} (${stagedVersion || "unrecorded"}; the current one is ${currentVersion}); re-stage to use the current one. ${how}`;
}
