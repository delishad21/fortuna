import { getImportSummaries } from "@/app/actions/analytics";
import { ImportHistoryClient } from "@/components/analytics/ImportHistoryClient";
import { getAgentDrafts } from "@/app/actions/agentDrafts";
import { getCategories } from "@/app/actions/categories";
import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { getParserOptions } from "@/lib/parsers";

export default async function ImportsPage() {
  const [data, agentData, categories, accountNumbers, bankParsers, tripParsers] =
    await Promise.all([
      getImportSummaries(),
      getAgentDrafts(),
      getCategories({ scope: "main" }),
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
      imports={data.imports || []}
      agentDrafts={agentData.drafts || []}
      categories={categories}
      accountNumbers={accountNumbers}
      parserOptions={Array.from(parsers.values()).map((parser) => ({
        value: parser.id,
        label: parser.name,
        description: parser.description,
      }))}
    />
  );
}
