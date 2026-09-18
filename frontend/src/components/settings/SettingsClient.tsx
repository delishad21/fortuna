"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { TextInput } from "@/components/ui/TextInput";
import { Button } from "@/components/ui/Button";
import { PageTabs } from "@/components/ui/PageTabs";
import { Modal, type ModalType } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberInput } from "@/components/ui/NumberInput";
import {
  User,
  Tags,
  WalletCards,
  Settings2,
  WandSparkles,
  EyeOff,
} from "lucide-react";
import { ManageCategoriesModal } from "@/components/settings/ManageCategoriesModal";
import { ManageAccountsModal } from "@/components/settings/ManageAccountsModal";
import { ChangePasswordModal } from "@/components/settings/ChangePasswordModal";
import { ManageImportRulesModal } from "@/components/settings/ManageImportRulesModal";
import {
  updateUserProfile,
  changePassword,
  updateAutoLabelSettings,
  updateAnalyticsExcludedCategories,
  type UserProfile,
} from "@/app/actions/user";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  type Category,
} from "@/app/actions/categories";
import { TRIP_CATEGORY_DEFINITIONS } from "@/lib/tripCategories";
import {
  updateAccountIdentifier,
  deleteAccountIdentifier,
  upsertAccountNumber,
  type AccountIdentifier,
} from "@/app/actions/accountNumbers";
import {
  createImportRule,
  updateImportRule,
  deleteImportRule,
  type ImportRule,
} from "@/app/actions/importRules";
import {
  getAppliedClassificationSummary,
  rebuildClassificationPatterns,
  updateClassificationPattern,
  type AppliedClassificationSummaryItem,
  type ClassificationPattern,
  type ClassificationPatternStatus,
} from "@/app/actions/classificationPatterns";
import type { ParserOption } from "@/lib/parsers";
import type { ApiTokenSummary } from "@/lib/apiTokens";
import { ApiTokensPanel } from "@/components/settings/ApiTokensPanel";

interface SettingsClientProps {
  user: UserProfile | null;
  initialCategories: Category[];
  initialAccountIdentifiers: AccountIdentifier[];
  initialImportRules: ImportRule[];
  parserOptions: ParserOption[];
  initialClassificationPatterns: ClassificationPattern[];
  initialAppliedClassificationSummary: AppliedClassificationSummaryItem[];
  initialApiTokens: ApiTokenSummary[];
}

export function SettingsClient({
  user,
  initialCategories,
  initialAccountIdentifiers,
  initialImportRules,
  parserOptions,
  initialClassificationPatterns,
  initialAppliedClassificationSummary,
  initialApiTokens,
}: SettingsClientProps) {
  const PREVIEW_CHIP_LIMIT = 4;
  const tripCategoryNames = TRIP_CATEGORY_DEFINITIONS.map((item) => item.name);

  const [profile, setProfile] = useState<UserProfile | null>(user);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [accounts, setAccounts] = useState<AccountIdentifier[]>(
    initialAccountIdentifiers,
  );
  const [importRules, setImportRules] = useState<ImportRule[]>(initialImportRules);
  const [classificationPatterns, setClassificationPatterns] = useState<
    ClassificationPattern[]
  >(initialClassificationPatterns);
  const [appliedClassificationSummary, setAppliedClassificationSummary] = useState<
    AppliedClassificationSummaryItem[]
  >(initialAppliedClassificationSummary);
  const [activeTab, setActiveTab] = useState<"profile" | "rules" | "api">("profile");

  const [passwordState, setPasswordState] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [autoLabelEnabled, setAutoLabelEnabled] = useState(
    user?.autoLabelEnabled ?? false,
  );
  const [autoLabelThreshold, setAutoLabelThreshold] = useState(
    user?.autoLabelThreshold ?? 0.5,
  );
  const [analyticsExcludedCategoryIds, setAnalyticsExcludedCategoryIds] =
    useState<string[]>(user?.analyticsExcludedCategoryIds ?? []);
  const [savedAnalyticsExcludedCategoryIds, setSavedAnalyticsExcludedCategoryIds] =
    useState<string[]>(user?.analyticsExcludedCategoryIds ?? []);

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: ModalType;
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    message: "",
  });

  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [manageAccountsOpen, setManageAccountsOpen] = useState(false);
  const [manageRulesOpen, setManageRulesOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newCategory, setNewCategory] = useState({
    name: "",
    color: "#6366f1",
  });
  const [newAccount, setNewAccount] = useState({
    identifier: "",
    color: "#6366f1",
  });

  const showModal = (
    type: ModalType,
    title: string,
    message: string,
    onConfirm?: () => void,
  ) => {
    setModalState({ isOpen: true, type, title, message, onConfirm });
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
  };

  const handleProfileSave = async () => {
    if (!profile) return;
    try {
      const updated = await updateUserProfile({
        name: profile.name,
        username: profile.username,
        email: profile.email,
      });
      setProfile(updated);
      showModal("success", "Profile Updated", "Your profile has been saved.");
    } catch (error) {
      showModal(
        "error",
        "Update Failed",
        error instanceof Error ? error.message : "Failed to update profile",
      );
    }
  };

  const handlePasswordSave = async () => {
    if (!passwordState.current || !passwordState.next) {
      showModal("warning", "Missing Fields", "Fill in all password fields.");
      return;
    }
    if (passwordState.next.length < 6) {
      showModal(
        "warning",
        "Password Too Short",
        "Password must be at least 6 characters.",
      );
      return;
    }
    if (passwordState.next !== passwordState.confirm) {
      showModal(
        "warning",
        "Passwords Mismatch",
        "New password and confirmation do not match.",
      );
      return;
    }
    try {
      await changePassword(passwordState.current, passwordState.next);
      setPasswordState({ current: "", next: "", confirm: "" });
      setPasswordModalOpen(false);
      showModal(
        "success",
        "Password Updated",
        "Password updated successfully.",
      );
    } catch (error) {
      showModal(
        "error",
        "Password Update Failed",
        error instanceof Error ? error.message : "Failed to update password",
      );
    }
  };

  const handleCategoryDelete = (categoryId: string) => {
    const category = categories.find((item) => item.id === categoryId);
    if (
      category &&
      tripCategoryNames.some(
        (name) => name.toLowerCase() === category.name.toLowerCase(),
      )
    ) {
      showModal(
        "warning",
        "Category Locked",
        "Trip category names are fixed and cannot be deleted.",
      );
      return;
    }

    showModal(
      "warning",
      "Delete Category",
      "This will remove the category.",
      async () => {
        try {
          await deleteCategory(categoryId);
          setCategories((prev) =>
            prev.filter((item) => item.id !== categoryId),
          );
          setAnalyticsExcludedCategoryIds((prev) =>
            prev.filter((id) => id !== categoryId),
          );
          setSavedAnalyticsExcludedCategoryIds((prev) =>
            prev.filter((id) => id !== categoryId),
          );
          showModal("success", "Category Deleted", "Category removed.");
        } catch (error) {
          showModal(
            "error",
            "Delete Failed",
            error instanceof Error
              ? error.message
              : "Failed to delete category",
          );
        }
      },
    );
  };

  const handleAccountDelete = (accountId: string) => {
    showModal(
      "warning",
      "Delete Account",
      "This will remove the account.",
      async () => {
        try {
          await deleteAccountIdentifier(accountId);
          setAccounts((prev) => prev.filter((item) => item.id !== accountId));
          showModal("success", "Account Deleted", "Account removed.");
        } catch (error) {
          showModal(
            "error",
            "Delete Failed",
            error instanceof Error ? error.message : "Failed to delete account",
          );
        }
      },
    );
  };

  const handleSaveAllCategories = async () => {
    try {
      await Promise.all(
        categories.map((category) =>
          updateCategory(category.id, category.name, category.color),
        ),
      );
      showModal("success", "Categories Saved", "All categories updated.");
    } catch (error) {
      showModal(
        "error",
        "Save Failed",
        error instanceof Error ? error.message : "Failed to update categories",
      );
    }
  };

  const handleSaveAllAccounts = async () => {
    try {
      await Promise.all(
        accounts.map((account) =>
          updateAccountIdentifier(
            account.id,
            account.accountIdentifier,
            account.color,
          ),
        ),
      );
      showModal("success", "Accounts Saved", "All accounts updated.");
    } catch (error) {
      showModal(
        "error",
        "Save Failed",
        error instanceof Error ? error.message : "Failed to update accounts",
      );
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (ruleId.startsWith("temp-")) {
      setImportRules((prev) => prev.filter((rule) => rule.id !== ruleId));
      return;
    }
    showModal(
      "warning",
      "Delete Rule",
      "This will remove the import rule.",
      async () => {
        try {
          await deleteImportRule(ruleId);
          setImportRules((prev) => prev.filter((rule) => rule.id !== ruleId));
          showModal("success", "Rule Deleted", "Import rule removed.");
        } catch (error) {
          showModal(
            "error",
            "Delete Failed",
            error instanceof Error ? error.message : "Failed to delete rule",
          );
        }
      },
    );
  };

  const handleSaveAllRules = async () => {
    try {
      const savedRules: ImportRule[] = [];
      for (const rule of importRules) {
        const payload = {
          name: rule.name,
          parserId: rule.parserId || null,
          matchType: rule.matchType,
          matchValue: rule.matchValue || null,
          caseSensitive: rule.caseSensitive,
          enabled: rule.enabled,
          setLabel: rule.setLabel || null,
          setCategoryName: rule.setCategoryName || null,
          markInternal: rule.markInternal,
          sortOrder: rule.sortOrder,
        };
        if (rule.id.startsWith("temp-")) {
          const created = await createImportRule(payload);
          savedRules.push(created);
        } else {
          const updated = await updateImportRule(rule.id, payload);
          savedRules.push(updated);
        }
      }
      setImportRules(savedRules);
      showModal("success", "Rules Saved", "Import rules updated.");
    } catch (error) {
      showModal(
        "error",
        "Save Failed",
        error instanceof Error ? error.message : "Failed to save import rules",
      );
    }
  };

  const handleSaveAutoLabelSettings = async () => {
    try {
      const updated = await updateAutoLabelSettings(
        autoLabelEnabled,
        autoLabelThreshold,
      );
      setAutoLabelEnabled(updated.autoLabelEnabled);
      setAutoLabelThreshold(updated.autoLabelThreshold);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              autoLabelEnabled: updated.autoLabelEnabled,
              autoLabelThreshold: updated.autoLabelThreshold,
            }
          : prev,
      );
      showModal("success", "Auto-labelling Saved", "Preferences updated.");
    } catch (error) {
      showModal(
        "error",
        "Save Failed",
        error instanceof Error
          ? error.message
          : "Failed to save auto-labelling settings",
      );
    }
  };

  const handleAnalyticsExclusionToggle = (
    categoryId: string,
    excluded: boolean,
  ) => {
    setAnalyticsExcludedCategoryIds((prev) => {
      if (excluded) {
        return prev.includes(categoryId) ? prev : [...prev, categoryId];
      }
      return prev.filter((id) => id !== categoryId);
    });
  };

  const handleSaveAnalyticsExclusions = async () => {
    try {
      const updated = await updateAnalyticsExcludedCategories(
        analyticsExcludedCategoryIds,
      );
      setAnalyticsExcludedCategoryIds(updated.analyticsExcludedCategoryIds);
      setSavedAnalyticsExcludedCategoryIds(updated.analyticsExcludedCategoryIds);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              analyticsExcludedCategoryIds:
                updated.analyticsExcludedCategoryIds,
            }
          : prev,
      );
      showModal("success", "Analytics Exclusions Saved", "Preferences updated.");
    } catch (error) {
      showModal(
        "error",
        "Save Failed",
        error instanceof Error
          ? error.message
          : "Failed to save analytics exclusions",
      );
    }
  };

  const handleRebuildClassificationPatterns = async () => {
    try {
      const result = await rebuildClassificationPatterns();
      const summary = await getAppliedClassificationSummary();
      setClassificationPatterns(result.patterns || []);
      setAppliedClassificationSummary(summary);
      showModal(
        "success",
        "Learned Rules Rebuilt",
        `Rebuilt ${result.rebuiltCount} learned classification rules.`,
      );
    } catch (error) {
      showModal(
        "error",
        "Rebuild Failed",
        error instanceof Error ? error.message : "Failed to rebuild learned rules",
      );
    }
  };

  const handlePatternStatusChange = async (
    patternId: string,
    status: ClassificationPatternStatus,
  ) => {
    try {
      const updated = await updateClassificationPattern(patternId, { status });
      setClassificationPatterns((prev) =>
        prev.map((pattern) => (pattern.id === patternId ? updated : pattern)),
      );
    } catch (error) {
      showModal(
        "error",
        "Update Failed",
        error instanceof Error ? error.message : "Failed to update learned rule",
      );
    }
  };

  const baselineAutoLabelEnabled = profile?.autoLabelEnabled ?? false;
  const baselineAutoLabelThreshold = profile?.autoLabelThreshold ?? 0.5;
  const isAutoLabelDirty =
    autoLabelEnabled !== baselineAutoLabelEnabled ||
    Number(autoLabelThreshold.toFixed(4)) !==
      Number(baselineAutoLabelThreshold.toFixed(4));
  const sortIds = (ids: string[]) => [...ids].sort().join("|");
  const analyticsExclusionsDirty =
    sortIds(analyticsExcludedCategoryIds) !==
    sortIds(savedAnalyticsExcludedCategoryIds);
  const analyticsExclusionCategories = categories.filter(
    (category) =>
      !tripCategoryNames.some(
        (name) => name.toLowerCase() === category.name.toLowerCase(),
      ),
  );
  const excludedCategoryPreview = analyticsExclusionCategories.filter((category) =>
    analyticsExcludedCategoryIds.includes(category.id),
  );

  const categoryPreview = categories.slice(0, PREVIEW_CHIP_LIMIT);
  const categoryRemaining = Math.max(categories.length - PREVIEW_CHIP_LIMIT, 0);
  const accountPreview = accounts.slice(0, PREVIEW_CHIP_LIMIT);
  const accountRemaining = Math.max(accounts.length - PREVIEW_CHIP_LIMIT, 0);
  const rulePreview = importRules.slice(0, PREVIEW_CHIP_LIMIT);
  const ruleRemaining = Math.max(importRules.length - PREVIEW_CHIP_LIMIT, 0);
  const learnedPatterns = classificationPatterns.filter(
    (pattern) => pattern.status !== "unresolved",
  );
  const ambiguousPatterns = classificationPatterns.filter(
    (pattern) => pattern.status !== "unresolved" && pattern.conflictCount > 0,
  );
  const unresolvedPatterns = classificationPatterns.filter(
    (pattern) => pattern.status === "unresolved",
  );
  const formatConfidence = (value: number | string) =>
    `${Math.round(Number(value || 0) * 100)}%`;
  const statusLabel = (status: ClassificationPatternStatus) =>
    status.replace(/_/g, " ");

  return (
    <div className="flex flex-col gap-6">
      <PageTabs
        tabs={[
          { key: "profile", label: "Profile & Preferences" },
          { key: "rules", label: "Rules" },
          { key: "api", label: "API Tokens" },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "profile" ? (
      <>
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <User className="h-6 w-6 shrink-0 text-primary" />
              <div className="min-w-0">
                <CardTitle>Profile</CardTitle>
                <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                  Update your account details and credentials.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 lg:justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPasswordModalOpen(true)}
              >
                Change Password
              </Button>
              <Button variant="primary" size="sm" onClick={handleProfileSave}>
                Save
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Full name
            </label>
            <TextInput
              value={profile?.name || ""}
              onChange={(e) =>
                setProfile((prev) =>
                  prev ? { ...prev, name: e.target.value } : prev,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Username
            </label>
            <TextInput
              value={profile?.username || ""}
              onChange={(e) =>
                setProfile((prev) =>
                  prev ? { ...prev, username: e.target.value } : prev,
                )
              }
            />
          </div>
          <div className="flex flex-col gap-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Email address
            </label>
            <TextInput
              value={profile?.email || ""}
              onChange={(e) =>
                setProfile((prev) =>
                  prev ? { ...prev, email: e.target.value } : prev,
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 min-w-0">
            <Settings2 className="h-6 w-6 shrink-0 text-blue" />
            <div className="min-w-0">
              <CardTitle>Preferences</CardTitle>
              <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                Manage categories and account identifiers.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-stroke dark:border-dark-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <Tags className="h-6 w-6 shrink-0 text-orange" />
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-dark dark:text-white">
                    Categories
                  </h4>
                  <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                    Color-coded categories for analytics.
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setManageCategoriesOpen(true)}
              >
                Manage
              </Button>
            </div>
            <div className="mt-4 flex max-h-[68px] flex-wrap gap-2 overflow-hidden text-sm text-dark-5 dark:text-dark-6">
              {categoryPreview.map((category) => (
                <span
                  key={category.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-stroke px-3 py-1 dark:border-dark-3"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="truncate">{category.name}</span>
                </span>
              ))}
              {categories.length === 0 && <span>No categories yet.</span>}
              {categoryRemaining > 0 && (
                <span className="inline-flex items-center rounded-full border border-stroke px-3 py-1 dark:border-dark-3">
                  +{categoryRemaining} more
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-stroke dark:border-dark-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <EyeOff className="h-6 w-6 shrink-0 text-red" />
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-dark dark:text-white">
                    Analytics Exclusions
                  </h4>
                  <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                    Hide selected categories from analytics.
                  </p>
                </div>
              </div>
              <Button
                variant={analyticsExclusionsDirty ? "success" : "secondary"}
                size="sm"
                onClick={handleSaveAnalyticsExclusions}
                disabled={!analyticsExclusionsDirty}
              >
                Save
              </Button>
            </div>

            <div className="mt-4 grid max-h-[220px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {analyticsExclusionCategories.map((category) => (
                <label
                  key={category.id}
                  className="flex min-w-0 items-center gap-3 rounded-lg border border-stroke px-3 py-2 text-sm text-dark dark:border-dark-3 dark:text-white"
                >
                  <Checkbox
                    checked={analyticsExcludedCategoryIds.includes(category.id)}
                    onChange={(checked) =>
                      handleAnalyticsExclusionToggle(category.id, checked)
                    }
                  />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="truncate">{category.name}</span>
                </label>
              ))}
              {analyticsExclusionCategories.length === 0 && (
                <span className="text-sm text-dark-5 dark:text-dark-6">
                  No categories yet.
                </span>
              )}
            </div>

            {excludedCategoryPreview.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-dark-5 dark:text-dark-6">
                {excludedCategoryPreview.map((category) => (
                  <span
                    key={category.id}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-stroke px-3 py-1 dark:border-dark-3"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: category.color }}
                    />
                    <span className="truncate">{category.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-stroke dark:border-dark-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <WalletCards className="h-6 w-6 shrink-0 text-green" />
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-dark dark:text-white">
                    Account Identifiers
                  </h4>
                  <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                    Accounts tied to imported statements.
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setManageAccountsOpen(true)}
              >
                Manage
              </Button>
            </div>
            <div className="mt-4 flex max-h-[68px] flex-wrap gap-2 overflow-hidden text-sm text-dark-5 dark:text-dark-6">
              {accountPreview.map((account) => (
                <span
                  key={account.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-stroke px-3 py-1 dark:border-dark-3"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: account.color }}
                  />
                  <span className="truncate">{account.accountIdentifier}</span>
                </span>
              ))}
              {accounts.length === 0 && <span>No accounts yet.</span>}
              {accountRemaining > 0 && (
                <span className="inline-flex items-center rounded-full border border-stroke px-3 py-1 dark:border-dark-3">
                  +{accountRemaining} more
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      </div>
      </>
      ) : activeTab === "rules" ? (
      <>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3 min-w-0">
            <WandSparkles className="h-6 w-6 shrink-0 text-primary" />
            <div className="min-w-0">
              <CardTitle>Import Rules</CardTitle>
              <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                Auto-label, auto-categorize, and auto-mark imports.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-stroke px-4 py-3 dark:border-dark-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-dark dark:text-white">
                  Fixed Rules
                </h4>
                <p className="text-xs text-dark-5 dark:text-dark-6 mt-1">
                  Add and maintain parser-specific matching rules.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setManageRulesOpen(true)}
              >
                Manage Rules
              </Button>
            </div>
            <div className="mt-3 flex max-h-[68px] flex-wrap gap-2 overflow-hidden text-sm text-dark-5 dark:text-dark-6">
              {rulePreview.map((rule) => (
                <span
                  key={rule.id}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-stroke px-3 py-1 dark:border-dark-3"
                >
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  <span className="truncate">{rule.name}</span>
                </span>
              ))}
              {importRules.length === 0 && <span>No import rules yet.</span>}
              {ruleRemaining > 0 && (
                <span className="inline-flex items-center rounded-full border border-stroke px-3 py-1 dark:border-dark-3">
                  +{ruleRemaining} more
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-stroke px-4 py-3 dark:border-dark-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2">
                <h4 className="text-sm font-semibold text-dark dark:text-white">
                  Auto-labelling
                </h4>
                <span className="rounded-full border border-orange/50 bg-orange/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-orange">
                  Experimental
                </span>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                <Checkbox
                  checked={autoLabelEnabled}
                  onChange={(checked) => setAutoLabelEnabled(checked)}
                />
                Enable
              </label>

              {autoLabelEnabled ? (
                <div className="inline-flex items-center gap-2 text-sm">
                  <span className="text-dark-5 dark:text-dark-6">Threshold</span>
                  <NumberInput
                    value={autoLabelThreshold}
                    step="0.05"
                    min="0"
                    max="1"
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setAutoLabelThreshold(Number.isFinite(value) ? value : 0.5);
                    }}
                    className="w-[120px]"
                    inputClassName="w-full"
                  />
                </div>
              ) : null}

              <div className="ml-auto">
                <Button
                  variant={
                    isAutoLabelDirty && autoLabelEnabled ? "success" : "secondary"
                  }
                  size="sm"
                  onClick={handleSaveAutoLabelSettings}
                  disabled={!isAutoLabelDirty}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <WandSparkles className="h-6 w-6 shrink-0 text-primary" />
              <div className="min-w-0">
                <CardTitle>Learned Rules</CardTitle>
                <p className="text-sm text-dark-5 dark:text-dark-6 mt-1">
                  Review classifier patterns learned from committed transactions.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRebuildClassificationPatterns}
            >
              Rebuild Learned Rules
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-stroke p-3 dark:border-dark-3">
              <p className="text-xs text-dark-5 dark:text-dark-6">Learned</p>
              <p className="text-2xl font-semibold text-dark dark:text-white">
                {learnedPatterns.length}
              </p>
            </div>
            <div className="rounded-lg border border-stroke p-3 dark:border-dark-3">
              <p className="text-xs text-dark-5 dark:text-dark-6">Auto-apply</p>
              <p className="text-2xl font-semibold text-dark dark:text-white">
                {classificationPatterns.filter((pattern) => pattern.status === "auto_apply").length}
              </p>
            </div>
            <div className="rounded-lg border border-stroke p-3 dark:border-dark-3">
              <p className="text-xs text-dark-5 dark:text-dark-6">Disabled</p>
              <p className="text-2xl font-semibold text-dark dark:text-white">
                {classificationPatterns.filter((pattern) => pattern.status === "disabled").length}
              </p>
            </div>
            <div className="rounded-lg border border-stroke p-3 dark:border-dark-3">
              <p className="text-xs text-dark-5 dark:text-dark-6">Unresolved</p>
              <p className="text-2xl font-semibold text-dark dark:text-white">
                {unresolvedPatterns.length}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-stroke dark:border-dark-3">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-1 text-xs uppercase tracking-wide text-dark-5 dark:bg-dark-3 dark:text-dark-6">
                <tr>
                  <th className="px-3 py-2">Pattern</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">Support</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {learnedPatterns.slice(0, 12).map((pattern) => (
                  <tr key={pattern.id} className="border-t border-stroke dark:border-dark-3">
                    <td className="px-3 py-2">
                      <div className="font-medium text-dark dark:text-white">
                        {pattern.patternValue}
                      </div>
                      <div className="text-xs text-dark-5 dark:text-dark-6">
                        {pattern.patternType.replace(/_/g, " ")}
                        {pattern.parserId ? ` · ${pattern.parserId}` : ""}
                        {pattern.direction ? ` · ${pattern.direction}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-dark-5 dark:text-dark-6">
                      {pattern.label || "No label"}
                      {pattern.category?.name ? ` · ${pattern.category.name}` : ""}
                      {pattern.markInternal ? " · Internal" : ""}
                    </td>
                    <td className="px-3 py-2 text-dark dark:text-white">
                      {formatConfidence(pattern.confidence)}
                    </td>
                    <td className="px-3 py-2 text-dark-5 dark:text-dark-6">
                      {pattern.supportCount} matches
                      {pattern.conflictCount > 0 ? ` · ${pattern.conflictCount} conflicts` : ""}
                    </td>
                    <td className="px-3 py-2 capitalize text-dark-5 dark:text-dark-6">
                      {statusLabel(pattern.status)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handlePatternStatusChange(pattern.id, "auto_apply")}
                        >
                          Auto
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handlePatternStatusChange(pattern.id, "disabled")}
                        >
                          Disable
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {learnedPatterns.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-dark-5 dark:text-dark-6" colSpan={6}>
                      No learned rules yet. They will appear after imports are committed.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border border-stroke p-4 dark:border-dark-3">
              <h4 className="text-sm font-semibold text-dark dark:text-white">
                Ambiguous Disabled Rules
              </h4>
              <div className="mt-3 space-y-2 text-sm text-dark-5 dark:text-dark-6">
                {ambiguousPatterns.slice(0, 5).map((pattern) => (
                  <div key={pattern.id} className="rounded-md bg-gray-1 p-2 dark:bg-dark-3">
                    {pattern.patternValue} · {formatConfidence(pattern.confidence)} · {pattern.conflictCount} conflicts
                  </div>
                ))}
                {ambiguousPatterns.length === 0 && <p>No ambiguous disabled rules.</p>}
              </div>
            </div>
            <div className="rounded-lg border border-stroke p-4 dark:border-dark-3">
              <h4 className="text-sm font-semibold text-dark dark:text-white">
                Unresolved Patterns
              </h4>
              <div className="mt-3 space-y-2 text-sm text-dark-5 dark:text-dark-6">
                {unresolvedPatterns.slice(0, 5).map((pattern) => (
                  <div key={pattern.id} className="rounded-md bg-gray-1 p-2 dark:bg-dark-3">
                    {pattern.patternValue} · {pattern.supportCount} occurrences
                  </div>
                ))}
                {unresolvedPatterns.length === 0 && <p>No unresolved repeated patterns.</p>}
              </div>
            </div>
            <div className="rounded-lg border border-stroke p-4 dark:border-dark-3">
              <h4 className="text-sm font-semibold text-dark dark:text-white">
                Applied Rules
              </h4>
              <div className="mt-3 space-y-2 text-sm text-dark-5 dark:text-dark-6">
                {appliedClassificationSummary.slice(0, 5).map((item) => (
                  <div key={`${item.type}-${item.id}`} className="rounded-md bg-gray-1 p-2 dark:bg-dark-3">
                    {item.type === "fixed" ? item.name : item.patternValue || item.name} · {item.appliedCount} applied
                  </div>
                ))}
                {appliedClassificationSummary.length === 0 && <p>No applied rule history yet.</p>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      </>
      ) : (
        <ApiTokensPanel initialTokens={initialApiTokens} />
      )}

      <ManageCategoriesModal
        isOpen={manageCategoriesOpen}
        categories={categories}
        lockedCategoryNames={tripCategoryNames}
        newCategory={newCategory}
        onClose={() => setManageCategoriesOpen(false)}
        onNewCategoryChange={setNewCategory}
        onAddCategory={async () => {
          if (!newCategory.name.trim()) return;
          try {
            const created = await createCategory(
              newCategory.name.trim(),
              newCategory.color,
            );
            setCategories((prev) => [...prev, created]);
            setNewCategory({ name: "", color: "#6366f1" });
          } catch (error) {
            showModal(
              "error",
              "Create Failed",
              error instanceof Error
                ? error.message
                : "Failed to create category",
            );
          }
        }}
        onCategoryNameChange={(id, name) =>
          setCategories((prev) =>
            prev.map((item) => (item.id === id ? { ...item, name } : item)),
          )
        }
        onCategoryColorChange={(id, color) =>
          setCategories((prev) =>
            prev.map((item) => (item.id === id ? { ...item, color } : item)),
          )
        }
        onDeleteCategory={handleCategoryDelete}
        onSaveAll={handleSaveAllCategories}
      />

      <ManageAccountsModal
        isOpen={manageAccountsOpen}
        accounts={accounts}
        newAccount={newAccount}
        onClose={() => setManageAccountsOpen(false)}
        onNewAccountChange={setNewAccount}
        onAddAccount={async () => {
          if (!newAccount.identifier.trim()) return;
          try {
            const created = await upsertAccountNumber(
              newAccount.identifier.trim(),
              newAccount.color,
            );
            setAccounts((prev) => {
              const exists = prev.some((item) => item.id === created.id);
              if (exists) {
                return prev.map((item) =>
                  item.id === created.id ? created : item,
                );
              }
              return [...prev, created];
            });
            setNewAccount({ identifier: "", color: "#6366f1" });
          } catch (error) {
            showModal(
              "error",
              "Create Failed",
              error instanceof Error
                ? error.message
                : "Failed to create account identifier",
            );
          }
        }}
        onAccountIdentifierChange={(id, identifier) =>
          setAccounts((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, accountIdentifier: identifier } : item,
            ),
          )
        }
        onAccountColorChange={(id, color) =>
          setAccounts((prev) =>
            prev.map((item) => (item.id === id ? { ...item, color } : item)),
          )
        }
        onDeleteAccount={handleAccountDelete}
        onSaveAll={handleSaveAllAccounts}
      />

      <ChangePasswordModal
        isOpen={passwordModalOpen}
        current={passwordState.current}
        next={passwordState.next}
        confirm={passwordState.confirm}
        onChange={setPasswordState}
        onClose={() => setPasswordModalOpen(false)}
        onSave={handlePasswordSave}
      />

      <ManageImportRulesModal
        isOpen={manageRulesOpen}
        rules={importRules}
        categories={categories}
        parserOptions={parserOptions}
        onClose={() => setManageRulesOpen(false)}
        onAddRule={() =>
          setImportRules((prev) => [
            ...prev,
            {
              id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: "New Rule",
              parserId: null,
              matchType: "description_contains",
              matchValue: "",
              caseSensitive: false,
              enabled: true,
              setLabel: null,
              setCategoryName: null,
              markInternal: false,
              sortOrder: prev.length + 1,
            },
          ])
        }
        onRuleChange={(id, updates) =>
          setImportRules((prev) =>
            prev.map((item) => (item.id === id ? { ...item, ...updates } : item)),
          )
        }
        onDeleteRule={handleDeleteRule}
        onSaveAll={handleSaveAllRules}
      />

      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
        onConfirm={modalState.onConfirm}
      />
    </div>
  );
}
