"use client";
import { useState } from "react";
import { accountDisplay } from "@/lib/accounts";

import { ChevronDown, Plus, Trash2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberInput } from "@/components/ui/NumberInput";
import type { ImportRule } from "@/app/actions/importRules";
import type { Category } from "@/app/actions/categories";
import type { ParserOption } from "@/lib/parsers";
import { formatDay } from "@/components/analytics/parts";
import { ruleOriginLabel, ruleScopeText } from "@/lib/reviewTypes";
import { cn } from "@/lib/utils";

const fieldLabel = "text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6";

/** Empty input clears the bound; anything else is a non-negative amount. */
const amountValue = (text: string) => {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

interface ManageImportRulesModalProps {
  isOpen: boolean;
  rules: ImportRule[];
  categories: Category[];
  parserOptions: ParserOption[];
  accounts: Array<{
    accountIdentifier: string;
    label?: string | null;
    color?: string | null;
  }>;
  onClose: () => void;
  onAddRule: () => void;
  onRuleChange: (id: string, updates: Partial<ImportRule>) => void;
  /** Turns a rule on or off; saved rules are saved right away. */
  onToggleEnabled: (id: string, enabled: boolean) => void | Promise<void>;
  onDeleteRule: (id: string) => void;
  onSaveAll: () => void | Promise<void>;
}

export function ManageImportRulesModal({
  isOpen,
  rules,
  categories,
  parserOptions,
  accounts,
  onClose,
  onAddRule,
  onRuleChange,
  onToggleEnabled,
  onDeleteRule,
  onSaveAll,
}: ManageImportRulesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-dark-2 rounded-lg shadow-[var(--shadow-card-2)] w-full max-w-6xl">
        <div className="p-6 border-b border-stroke dark:border-dark-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/15 dark:bg-primary/25 text-primary flex items-center justify-center">
              <WandSparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark dark:text-white">
                Manage Import Rules
              </h2>
              <p className="text-sm text-dark-5 dark:text-dark-6 mt-0.5">
                Configure parser-specific or global auto-rules for imports.
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={onAddRule}
            >
              Add Rule
            </Button>
          </div>

          <div className="space-y-3 max-h-[55vh] overflow-auto pr-2 custom-scrollbar">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-lg border border-stroke dark:border-dark-3 p-3 bg-white dark:bg-dark-2"
              >
                <RuleSummary rule={rule} onToggleEnabled={onToggleEnabled} />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Rule Name
                    </label>
                    <TextInput
                      value={rule.name}
                      onChange={(e) => onRuleChange(rule.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Parser Scope
                    </label>
                    <Select
                      value={rule.parserId || "__all__"}
                      options={[
                        { value: "__all__", label: "All Parsers" },
                        ...parserOptions.map((parser) => ({
                          value: parser.id,
                          label: parser.name,
                        })),
                      ]}
                      onChange={(value) =>
                        onRuleChange(rule.id, {
                          parserId: value === "__all__" ? null : value,
                        })
                      }
                      buttonClassName="w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Account
                    </label>
                    <Select
                      value={rule.accountIdentifier || "__all__"}
                      options={[
                        { value: "__all__", label: "All Accounts" },
                        ...accounts.map((account) => ({
                          value: account.accountIdentifier,
                          label: accountDisplay(account),
                        })),
                      ]}
                      onChange={(value) =>
                        onRuleChange(rule.id, {
                          accountIdentifier: value === "__all__" ? null : value,
                        })
                      }
                      buttonClassName="w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Match Type
                    </label>
                    <Select
                      value={rule.matchType}
                      options={[
                        { value: "description_contains", label: "Description Contains" },
                        { value: "always", label: "Always Match" },
                      ]}
                      onChange={(value) =>
                        onRuleChange(rule.id, {
                          matchType: value as "description_contains" | "always",
                        })
                      }
                      buttonClassName="w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Match Value
                    </label>
                    <TextInput
                      value={rule.matchValue || ""}
                      disabled={rule.matchType === "always"}
                      onChange={(e) =>
                        onRuleChange(rule.id, { matchValue: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Set Label
                    </label>
                    <TextInput
                      value={rule.setLabel || ""}
                      onChange={(e) => onRuleChange(rule.id, { setLabel: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                      Set Category
                    </label>
                    <Select
                      value={rule.setCategoryName || "__none__"}
                      options={[
                        { value: "__none__", label: "No category change" },
                        ...categories.map((category) => ({
                          value: category.name,
                          label: category.name,
                        })),
                      ]}
                      onChange={(value) =>
                        onRuleChange(rule.id, {
                          setCategoryName: value === "__none__" ? null : value,
                        })
                      }
                      buttonClassName="w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={fieldLabel}>Amount Range</label>
                    <div className="flex items-center gap-2">
                      <AmountField
                        value={rule.amountMin}
                        placeholder="Min"
                        onChange={(amountMin) => onRuleChange(rule.id, { amountMin })}
                      />
                      <span className="text-sm text-dark-5 dark:text-dark-6">to</span>
                      <AmountField
                        value={rule.amountMax}
                        placeholder="Max"
                        onChange={(amountMax) => onRuleChange(rule.id, { amountMax })}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={rule.caseSensitive}
                      onChange={(checked) =>
                        onRuleChange(rule.id, { caseSensitive: checked })
                      }
                    />
                    <span className="text-sm text-dark dark:text-white">Case-sensitive</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={rule.markInternal}
                      onChange={(checked) =>
                        onRuleChange(rule.id, { markInternal: checked })
                      }
                    />
                    <span className="text-sm text-dark dark:text-white">Mark Internal</span>
                  </div>
                  <NumberInput
                    value={rule.sortOrder}
                    onChange={(e) =>
                      onRuleChange(rule.id, { sortOrder: Number(e.target.value || 0) })
                    }
                    className="w-[150px]"
                    inputClassName="w-full"
                    placeholder="Sort"
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => onDeleteRule(rule.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {rules.length === 0 && (
              <div className="text-sm text-dark-5 dark:text-dark-6">
                No import rules yet.
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={onSaveAll}>
            Save Rules
          </Button>
        </div>
      </div>
    </div>
  );
}

/** An optional amount; keeps what is typed (e.g. "12.") while passing the number up. */
function AmountField({
  value,
  placeholder,
  onChange,
}: {
  value: number | null | undefined;
  placeholder: string;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  return (
    <NumberInput
      value={text}
      placeholder={placeholder}
      className="flex-1"
      inputClassName="w-full"
      onChange={(e) => {
        setText(e.target.value);
        onChange(amountValue(e.target.value));
      }}
    />
  );
}

/** Origin, reason, scope, hit stats and examples of a rule, with its on/off switch. */
function RuleSummary({
  rule,
  onToggleEnabled,
}: {
  rule: ImportRule;
  onToggleEnabled: (id: string, enabled: boolean) => void | Promise<void>;
}) {
  const [showExamples, setShowExamples] = useState(false);
  const saved = !rule.id.startsWith("temp-");
  const scope = ruleScopeText({
    account: rule.account ?? null,
    accountIdentifier: rule.accountIdentifier ?? null,
    card: rule.card ?? null,
    amountMin: rule.amountMin ?? null,
    amountMax: rule.amountMax ?? null,
  });
  const examples = rule.examples ?? [];
  const exampleCount = rule.exampleTransactionIds?.length ?? examples.length;
  const hits = rule.hitCount ?? 0;

  return (
    <div className="mb-3 flex flex-col gap-1.5 border-b border-stroke pb-3 dark:border-dark-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-dark-5 dark:text-dark-6">
          <span className="inline-flex items-center rounded border border-stroke px-1.5 py-px text-[11px] text-dark dark:border-dark-3 dark:text-white">
            {ruleOriginLabel(rule.origin)}
          </span>
          {scope ? <span>{scope}</span> : null}
          {saved ? (
            <span>
              {hits === 0
                ? "Not used yet"
                : `Used ${hits === 1 ? "once" : `${hits} times`}${rule.lastHitAt ? `, last on ${formatDay(rule.lastHitAt, "d MMM yyyy")}` : ""}`}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {rule.undoneAt ? <span className="text-xs text-dark-5 dark:text-dark-6">Undone</span> : null}
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            aria-label={rule.enabled ? `Turn off ${rule.name}` : `Turn on ${rule.name}`}
            onClick={() => void onToggleEnabled(rule.id, !rule.enabled)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition",
              rule.enabled ? "bg-primary" : "bg-stroke dark:bg-dark-3",
            )}
          >
            <span
              className={cn(
                "inline-block size-4 rounded-full bg-white transition",
                rule.enabled ? "translate-x-[18px]" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </div>
      {rule.reason ? <p className="text-sm text-dark dark:text-white">{rule.reason}</p> : null}
      {exampleCount > 0 ? (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowExamples((value) => !value)}
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary"
          >
            {exampleCount === 1 ? "1 example" : `${exampleCount} examples`}
            <ChevronDown className={cn("size-3.5 transition", showExamples && "rotate-180")} />
          </button>
          {showExamples ? (
            <ul className="flex flex-col gap-0.5 text-xs text-dark dark:text-white">
              {examples.map((example) => (
                <li key={example.id} className="truncate">
                  {formatDay(example.date, "d MMM yyyy")} · {example.label || example.description} ·{" "}
                  {example.category || "Uncategorized"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
