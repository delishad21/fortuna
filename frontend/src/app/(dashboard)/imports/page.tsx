import { getImportSummaries } from "@/app/actions/analytics";
import { ImportHistoryClient } from "@/components/analytics/ImportHistoryClient";
import { getAgentDrafts } from "@/app/actions/agentDrafts";
import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { getParserOptions } from "@/lib/parsers";

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const [data, agentData, accountNumbers, bankParsers, tripParsers] =
    await Promise.all([
      getImportSummaries(),
      getAgentDrafts(),
      getAccountNumbers(),
      getParserOptions("bank"),
      getParserOptions("trip"),
    ]);
  const parsers = new Map<string, (typeof bankParsers)[number]>();
  [...bankParsers, ...tripParsers].forEach((parser) =>
    parsers.set(parser.id, parser),
  );

  return (
    <ImportHistoryClient
      initialTab={tab === "history" ? "history" : "import"}
      imports={data.imports || []}
      agentDrafts={agentData.drafts || []}
      accountNumbers={accountNumbers}
      parserOptions={Array.from(parsers.values()).map((parser) => ({
        value: parser.id,
        label: parser.name,
        description: parser.description,
      }))}
    />
  );
}
