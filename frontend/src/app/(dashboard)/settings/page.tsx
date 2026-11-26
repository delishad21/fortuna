import { getCategories } from "@/app/actions/categories";
import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { getAccounts } from "@/app/actions/accounts";
import { getSources } from "@/app/actions/sources";
import { getCurrentUser } from "@/app/actions/user";
import { bootstrapDefaultImportRules, getImportRules } from "@/app/actions/importRules";
import {
  getAppliedClassificationSummary,
  getClassificationPatterns,
} from "@/app/actions/classificationPatterns";
import { getParserOptions } from "@/lib/parsers";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { getApiTokens } from "@/app/actions/apiTokens";

export default async function SettingsPage() {
  try {
    await bootstrapDefaultImportRules();
  } catch (error) {
    console.error("Failed to bootstrap import rules:", error);
  }

  const [
    user,
    categories,
    accountIdentifiers,
    accounts,
    sources,
    importRules,
    parserOptions,
    classificationPatterns,
    appliedClassificationSummary,
    apiTokens,
  ] = await Promise.all([
    getCurrentUser(),
    getCategories({ scope: "settings" }),
    getAccountNumbers(),
    getAccounts({ includeArchived: true }).catch((error) => {
      console.error("Failed to load accounts:", error);
      return [];
    }),
    getSources().catch((error) => {
      console.error("Failed to load sources:", error);
      return [];
    }),
    getImportRules(),
    getParserOptions("bank"),
    getClassificationPatterns(),
    getAppliedClassificationSummary(),
    getApiTokens(),
  ]);

  return (
    <SettingsClient
      user={user}
      initialCategories={categories}
      initialAccountIdentifiers={accountIdentifiers}
      initialAccounts={accounts}
      initialSources={sources}
      initialImportRules={importRules}
      parserOptions={parserOptions}
      initialClassificationPatterns={classificationPatterns}
      initialAppliedClassificationSummary={appliedClassificationSummary}
      initialApiTokens={apiTokens}
    />
  );
}
