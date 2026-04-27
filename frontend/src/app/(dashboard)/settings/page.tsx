import { getCategories } from "@/app/actions/categories";
import { getAccountNumbers } from "@/app/actions/accountNumbers";
import { getCurrentUser } from "@/app/actions/user";
import { bootstrapDefaultImportRules, getImportRules } from "@/app/actions/importRules";
import {
  getAppliedClassificationSummary,
  getClassificationPatterns,
} from "@/app/actions/classificationPatterns";
import { getParserOptions } from "@/lib/parsers";
import { SettingsClient } from "@/components/settings/SettingsClient";

export default async function SettingsPage() {
  try {
    await bootstrapDefaultImportRules();
  } catch (error) {
    console.error("Failed to bootstrap import rules:", error);
  }

  const [
    user,
    categories,
    accounts,
    importRules,
    parserOptions,
    classificationPatterns,
    appliedClassificationSummary,
  ] = await Promise.all([
    getCurrentUser(),
    getCategories({ scope: "settings" }),
    getAccountNumbers(),
    getImportRules(),
    getParserOptions("bank"),
    getClassificationPatterns(),
    getAppliedClassificationSummary(),
  ]);

  return (
    <SettingsClient
      user={user}
      initialCategories={categories}
      initialAccountIdentifiers={accounts}
      initialImportRules={importRules}
      parserOptions={parserOptions}
      initialClassificationPatterns={classificationPatterns}
      initialAppliedClassificationSummary={appliedClassificationSummary}
    />
  );
}
