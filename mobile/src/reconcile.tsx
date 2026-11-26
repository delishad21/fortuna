import React, { useState } from "react";
import { View } from "react-native";
import {
  ActionMenu,
  Button,
  Card,
  Pill,
  Section,
  Sheet,
  Txt,
  styles,
  type Action,
} from "./ui";
import {
  LEFTOVER_ACTION_LABELS,
  LEFTOVER_REASON_LABELS,
  SUGGESTED_ACTION_LABELS,
  entryTitle,
  reconcileAmount,
  type ReconcileChange,
  type ReconcileEntry,
  type ReconcilePlan,
} from "../../frontend/shared/reconcile";

type Draft = { id: string; sourceFilename?: string; rows: any[]; reconcile?: ReconcilePlan | null };
type Account = { id: string; name: string; archived?: boolean };

const rowLine = (row: any) => {
  const p = row?.currentPayload || {};
  return `${String(p.date || "").slice(0, 10)} · ${p.description || ""} · ${reconcileAmount({ amountIn: p.amountIn ?? null, amountOut: p.amountOut ?? null })}`;
};
const entryLine = (entry: ReconcileEntry) => `${entry.date} · ${entryTitle(entry)} · ${reconcileAmount(entry)}`;

/**
 * The reconcile plan of the drafts under review, like the web's panel: rows
 * matched to entries already logged, new rows, and logged entries the
 * statement doesn't show. Renders nothing for a plain upload.
 */
export function ReconcileCard({
  drafts,
  accounts,
  busy,
  onChange,
}: {
  drafts: Draft[];
  accounts: Account[];
  busy: boolean;
  onChange: (draftId: string, change: ReconcileChange) => void;
}) {
  const [open, setOpen] = useState(false);
  const plans = drafts.flatMap((draft) => (draft.reconcile ? [{ draft, plan: draft.reconcile }] : []));
  if (!plans.length) return null;
  const sum = (key: keyof ReconcilePlan["summary"]) => plans.reduce((n, { plan }) => n + plan.summary[key], 0);
  const accountName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name || "another account";

  return (
    <Card style={{ gap: 8 }}>
      <Txt bold>Reconcile with logged entries</Txt>
      <View style={[styles.row, { gap: 6, flexWrap: "wrap" }]}>
        <Pill label={`${sum("matched")} matched`} tone="green" />
        <Pill label={`${sum("gaps")} new`} />
        <Pill label={`${sum("leftovers")} not on statement`} tone={sum("leftovers") ? "amber" : "neutral"} />
        {sum("amountWarnings") > 0 && <Pill label={`${sum("amountWarnings")} amount differs`} tone="amber" />}
      </View>
      <Txt muted size={13}>
        Matched rows confirm the logged entry, which keeps its label and category. New rows are added as usual.
      </Txt>
      <Button title="Review matches" secondary compact onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Reconcile with logged entries">
        <View style={{ gap: 18 }}>
          <Section title={`Matched (${sum("matched")})`}>
            {plans.flatMap(({ draft, plan }) =>
              plan.matched.map((match) => {
                const actions: Action[] = [
                  {
                    label: "Unmatch (add the row as new)",
                    icon: "unlink-outline",
                    onPress: () => onChange(draft.id, { rows: [{ rowId: match.rowId, transactionId: null }] }),
                  },
                  ...(match.mode === "manual"
                    ? [{
                        label: "Match automatically",
                        icon: "sparkles-outline",
                        onPress: () => onChange(draft.id, { rows: [{ rowId: match.rowId, transactionId: "auto" }] }),
                      }]
                    : []),
                  ...plan.leftovers.map((leftover) => ({
                    label: `Match to ${entryLine(leftover.entry)}`,
                    icon: "link-outline",
                    onPress: () => onChange(draft.id, { rows: [{ rowId: match.rowId, transactionId: leftover.entry.id }] }),
                  })),
                ];
                return (
                  <Card key={`${draft.id}:${match.rowId}`} style={{ gap: 4 }}>
                    <View style={[styles.between, { gap: 8 }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt size={14}>Row {match.rowIndex + 1}: {rowLine(draft.rows.find((r) => r.id === match.rowId))}</Txt>
                        <Txt muted size={13}>
                          {match.mode === "manual" ? "Matched by hand to" : "Matches"} {entryLine(match.entry)}
                        </Txt>
                      </View>
                      <ActionMenu title="Change match" actions={actions.map((a) => ({ ...a, disabled: busy }))} />
                    </View>
                    {[...match.errors, ...match.warnings].map((w) => (
                      <Txt key={w} size={13} tone="amber">{w}</Txt>
                    ))}
                  </Card>
                );
              }),
            )}
          </Section>

          <Section title={`New rows (${sum("gaps")})`} hint="Nothing was logged for these; they are saved as new transactions.">
            {plans.flatMap(({ draft, plan }) =>
              plan.gaps.map((gap) => {
                const ids = [...gap.candidates.map((c) => c.transactionId), ...plan.leftovers.map((l) => l.entry.id)]
                  .filter((id, i, all) => all.indexOf(id) === i);
                const actions: Action[] = [
                  ...(gap.unmatched
                    ? [{
                        label: "Match automatically",
                        icon: "sparkles-outline",
                        onPress: () => onChange(draft.id, { rows: [{ rowId: gap.rowId, transactionId: "auto" }] }),
                      }]
                    : []),
                  ...ids.flatMap((id) => {
                    const entry = plan.leftovers.find((l) => l.entry.id === id)?.entry;
                    return entry
                      ? [{
                          label: `Match to ${entryLine(entry)}`,
                          icon: "link-outline",
                          onPress: () => onChange(draft.id, { rows: [{ rowId: gap.rowId, transactionId: id }] }),
                        }]
                      : [];
                  }),
                ];
                return (
                  <Card key={`${draft.id}:${gap.rowId}`} style={[styles.between, { gap: 8 }]}>
                    <Txt size={14} style={{ flex: 1 }}>
                      Row {gap.rowIndex + 1}: {rowLine(draft.rows.find((r) => r.id === gap.rowId))}
                      {gap.unmatched ? " · unmatched by you" : ""}
                    </Txt>
                    {actions.length > 0 && (
                      <ActionMenu title="Match to a logged entry" actions={actions.map((a) => ({ ...a, disabled: busy }))} />
                    )}
                  </Card>
                );
              }),
            )}
          </Section>

          <Section title={`Logged but not on the statement (${sum("leftovers")})`}>
            {plans.flatMap(({ draft, plan }) =>
              plan.leftovers.map((leftover) => {
                const entry = leftover.entry;
                const set = (action: "keep" | "delete" | "move", accountId?: string) =>
                  onChange(draft.id, { entries: [{ transactionId: entry.id, action, accountId: accountId ?? null }] });
                const actions: Action[] = [
                  { label: LEFTOVER_ACTION_LABELS.keep, icon: "checkmark-outline", onPress: () => set("keep") },
                  { label: LEFTOVER_ACTION_LABELS.delete, icon: "trash-outline", danger: true, onPress: () => set("delete") },
                  ...accounts
                    .filter((a) => a.id !== entry.accountId && !a.archived)
                    .map((a) => ({ label: `Move to ${a.name}`, icon: "swap-horizontal-outline", onPress: () => set("move", a.id) })),
                  ...plan.gaps.map((gap) => ({
                    label: `Link to row ${gap.rowIndex + 1}: ${rowLine(draft.rows.find((r) => r.id === gap.rowId))}`,
                    icon: "link-outline",
                    onPress: () => onChange(draft.id, { rows: [{ rowId: gap.rowId, transactionId: entry.id }] }),
                  })),
                ];
                const chosen =
                  leftover.action === "move"
                    ? `Moves to ${accountName(leftover.accountId)}`
                    : LEFTOVER_ACTION_LABELS[leftover.action];
                return (
                  <Card key={`${draft.id}:${entry.id}`} style={{ gap: 4 }}>
                    <View style={[styles.between, { gap: 8 }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Txt size={14}>{entryLine(entry)}</Txt>
                        <Txt muted size={12}>{entry.accountName || accountName(entry.accountId)} · {chosen}</Txt>
                      </View>
                      <ActionMenu title={entryTitle(entry)} actions={actions.map((a) => ({ ...a, disabled: busy }))} />
                    </View>
                    {leftover.reasons.map((r) => (
                      <Txt key={r.code} size={13}>
                        <Txt bold size={13}>{LEFTOVER_REASON_LABELS[r.code]}: </Txt>
                        {r.message}
                      </Txt>
                    ))}
                    {leftover.suggestedAction !== "keep" && leftover.action === "keep" && (
                      <Txt muted size={12}>Suggested: {SUGGESTED_ACTION_LABELS[leftover.suggestedAction]}.</Txt>
                    )}
                    {leftover.errors.map((e) => (
                      <Txt key={e} size={13} tone="red">{e}</Txt>
                    ))}
                  </Card>
                );
              }),
            )}
          </Section>
        </View>
      </Sheet>
    </Card>
  );
}
