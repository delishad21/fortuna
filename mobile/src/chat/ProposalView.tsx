import React from "react";
import { View } from "react-native";
import { Card, Txt, TransactionRow, useTheme } from "../ui";
import {
  Proposal,
  CategoryChip,
  FieldDiff,
  PreviewReferences,
  categoryChip,
  fieldText,
  formatMoney,
  groupTransactionChanges,
  linkageView,
  ruleSummary,
  shortDate,
  signedAmount,
  summaryLabel,
  summaryValue,
  transactionTitle,
  FIELD_LABELS,
} from "./api";

const NEUTRAL = "#9CA3AF";

function Dot({ color }: { color?: string | null }) {
  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: color || NEUTRAL,
      }}
    />
  );
}
function Chip({ value }: { value: CategoryChip | null }) {
  if (!value) return <Txt muted>None</Txt>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Dot color={value.color} />
      <Txt>{value.name}</Txt>
    </View>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return (
    <Txt
      muted
      size={11}
      style={{ textTransform: "uppercase", letterSpacing: 0.5 }}
    >
      {children}
    </Txt>
  );
}

function Linkage({
  value,
  references,
}: {
  value: any;
  references: PreviewReferences;
}) {
  const { colors } = useTheme();
  const view = linkageView(value, references);
  return (
    <View style={{ gap: 6 }}>
      <Txt>{view.label}</Txt>
      {view.links.length > 0 && (
        <Txt muted size={12}>
          {view.kind === "reimbursement" ? "Pays back" : "Paid back by"}
        </Txt>
      )}
      {view.links.map((link) => (
        <View
          key={link.id}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 8,
            backgroundColor: colors.bg,
            borderRadius: 8,
            padding: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Txt size={13} numberOfLines={1}>
              {link.summary
                ? transactionTitle(link.summary)
                : link.staged
                  ? "Staged import row"
                  : "Saved transaction"}
            </Txt>
            <Txt muted size={11} numberOfLines={1}>
              {link.summary
                ? shortDate(link.summary.date)
                : `#${link.id.slice(-6)}`}
              {link.staged ? " · not imported yet" : ""}
            </Txt>
          </View>
          {link.amount !== null && (
            <Txt bold size={13} style={{ color: colors.purple }}>
              {formatMoney(link.amount, link.summary?.currency || "SGD")}
            </Txt>
          )}
        </View>
      ))}
      {view.leftover && (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Txt muted size={12}>
            Leftover goes to
          </Txt>
          <Chip value={view.leftover} />
        </View>
      )}
    </View>
  );
}

function Value({
  diff,
  side,
  currency,
  references,
}: {
  diff: FieldDiff;
  side: "before" | "after";
  currency: string;
  references: PreviewReferences;
}) {
  const value = diff[side];
  if (diff.key === "category") return <Chip value={categoryChip(value)} />;
  if (diff.key === "linkage")
    return <Linkage value={value} references={references} />;
  if (diff.key === "accountIdentifier" && value)
    return (
      <Chip
        value={{
          name: String(value),
          color: references.accounts?.[String(value)] || null,
        }}
      />
    );
  return (
    <Txt muted={side === "before"}>
      {fieldText(diff.key, value, currency, formatMoney)}
    </Txt>
  );
}

function TransactionEdits({ preview }: { preview: any }) {
  const { colors } = useTheme();
  const references: PreviewReferences = preview.references || {};
  const groups = groupTransactionChanges(preview.changes || []);
  if (!groups.length) return <Txt muted>Nothing would change.</Txt>;
  return (
    <>
      {groups.map((group, index) => {
        const currency = group.transactions[0]?.currency || "SGD";
        return (
          <Card key={index}>
            <Txt bold>
              {group.transactions.length === 1
                ? "1 transaction"
                : `${group.transactions.length} transactions`}
            </Txt>
            {group.diffs.map((diff) => (
              <View
                key={diff.key}
                style={{
                  gap: 6,
                  borderTopWidth: 1,
                  borderColor: colors.line,
                  paddingTop: 10,
                }}
              >
                <Label>{FIELD_LABELS[diff.key] || diff.key}</Label>
                <View style={{ gap: 4 }}>
                  <Value
                    diff={diff}
                    side="before"
                    currency={currency}
                    references={references}
                  />
                  <Txt muted size={12}>
                    ↓
                  </Txt>
                  <View
                    style={{
                      backgroundColor: colors.tint,
                      borderRadius: 8,
                      padding: 8,
                    }}
                  >
                    <Value
                      diff={diff}
                      side="after"
                      currency={currency}
                      references={references}
                    />
                  </View>
                </View>
              </View>
            ))}
            <View style={{ borderTopWidth: 1, borderColor: colors.line }}>
              {group.transactions.map((t) => (
                <TransactionRow key={t.id} item={t} />
              ))}
            </View>
          </Card>
        );
      })}
    </>
  );
}

function Summary({
  value,
  hide = [],
}: {
  value: Record<string, unknown>;
  hide?: string[];
}) {
  const { colors } = useTheme();
  return (
    <View>
      {Object.entries(value || {})
        .filter(([k, v]) => !hide.includes(k) && v !== undefined)
        .map(([key, item]) => (
          <View
            key={key}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 12,
              paddingVertical: 6,
              borderBottomWidth: 1,
              borderColor: colors.line,
            }}
          >
            <Txt muted size={13}>
              {summaryLabel(key)}
            </Txt>
            <Txt size={13} style={{ flexShrink: 1, textAlign: "right" }}>
              {summaryValue(item)}
            </Txt>
          </View>
        ))}
    </View>
  );
}

function MiniTransaction({ t }: { t: any }) {
  const { colors } = useTheme();
  const { income, value } = signedAmount(t || {});
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Txt size={13} numberOfLines={1}>
        {transactionTitle(t || {})}
      </Txt>
      <Txt muted size={11}>
        {shortDate(t?.date)}
      </Txt>
      <Txt bold size={13} style={{ color: income ? colors.green : colors.red }}>
        {income ? "+" : "−"}
        {formatMoney(value, t?.currency || "SGD")}
      </Txt>
    </View>
  );
}

function CommitDrafts({ preview }: { preview: any }) {
  const { colors } = useTheme();
  return (
    <>
      {(preview.drafts || []).map((draft: any) => (
        <Card key={draft.draftId}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <Txt bold numberOfLines={1} style={{ flex: 1 }}>
              {draft.filename || "Staged import"}
            </Txt>
            <Txt
              bold
              size={12}
              style={{ color: draft.valid ? colors.green : colors.red }}
            >
              {draft.valid ? "Ready" : "Blocked"}
            </Txt>
          </View>
          {draft.summary && <Summary value={draft.summary} />}
          {(draft.errors || []).map((e: any, i: number) => (
            <Txt key={`e${i}`} style={{ color: colors.red }}>
              ⚠ {e.message || summaryValue(e)}
            </Txt>
          ))}
          {(draft.warnings || []).map((w: any, i: number) => (
            <Txt key={`w${i}`} muted>
              ⚠ {w.message || summaryValue(w)}
            </Txt>
          ))}
        </Card>
      ))}
      {Array.isArray(preview.duplicates) && preview.duplicates.length > 0 && (
        <Card>
          <Txt bold>
            {preview.duplicates.length} possible{" "}
            {preview.duplicates.length === 1 ? "duplicate" : "duplicates"}
          </Txt>
          {preview.duplicates.map((d: any, i: number) => (
            <View
              key={i}
              style={{
                flexDirection: "row",
                gap: 12,
                borderTopWidth: 1,
                borderColor: colors.line,
                paddingTop: 8,
              }}
            >
              <MiniTransaction t={d.row} />
              <MiniTransaction t={d.match} />
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

function RuleCard({ rule, label }: { rule: any; label?: string }) {
  const summary = ruleSummary(rule);
  if (!summary) return null;
  return (
    <Card>
      {!!label && <Label>{label}</Label>}
      <Txt bold>{summary.name}</Txt>
      <Label>When</Label>
      {summary.conditions.map((c) => (
        <Txt key={c}>{c}</Txt>
      ))}
      <Label>Then</Label>
      {summary.effects.map((e) => (
        <Txt key={e} bold>
          {e}
        </Txt>
      ))}
      <Txt muted size={12}>
        {summary.enabled ? "Enabled" : "Disabled"} · applies to future imports
        only
      </Txt>
    </Card>
  );
}

/** Readable body for any approval proposal; never raw JSON. */
export function ProposalView({ proposal }: { proposal: Proposal }) {
  const preview = proposal.preview || {};
  if (proposal.kind === "edit_transactions" || preview.changes)
    return <TransactionEdits preview={preview} />;
  if (proposal.kind === "commit_drafts")
    return <CommitDrafts preview={preview} />;
  if (proposal.kind === "create_account" || proposal.kind === "create_category")
    return (
      <Card>
        <Label>
          {proposal.kind === "create_account" ? "New account" : "New category"}
        </Label>
        <Chip
          value={{
            name: preview.after?.accountIdentifier || preview.after?.name,
            color: preview.after?.color,
          }}
        />
      </Card>
    );
  if (proposal.kind === "update_import_rule")
    return (
      <>
        {preview.before && <RuleCard rule={preview.before} label="Current" />}
        <RuleCard
          rule={{ ...(preview.before || {}), ...(preview.after || {}) }}
          label={preview.before ? "New" : undefined}
        />
      </>
    );
  const details = preview.details || {};
  if (proposal.kind === "retain_fixture")
    return (
      <Card>
        {(details.files || []).map((f: any) => (
          <View
            key={f.filename}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <Txt numberOfLines={1} style={{ flex: 1 }}>
              {f.filename}
            </Txt>
            <Txt muted size={12}>
              {f.retained
                ? "Already kept"
                : `Expires ${shortDate(f.expiresAt)}`}
            </Txt>
          </View>
        ))}
      </Card>
    );
  const { title: _title, ...rest } = proposal.kind.endsWith("_parser")
    ? { title: "", ...details }
    : preview;
  return (
    <Card>
      <Summary
        value={rest}
        hide={["testReport", "sourceCode", "specification", "versions"]}
      />
      {details.testReport && (
        <>
          <Label>Test results</Label>
          <Summary value={details.testReport} />
        </>
      )}
    </Card>
  );
}
