import React, { useMemo, useState } from "react";
import { Platform, RefreshControl, View } from "react-native";
import { useApi, usePaged, useResource } from "./api";
import {
  Button,
  Card,
  Checkbox,
  Choice,
  Chips,
  confirm,
  Empty,
  Group,
  IconButton,
  Input,
  ListItem,
  notice,
  plural,
  Screen,
  Section,
  Sheet,
  State,
  styles,
  toast,
  TransactionRow,
  Txt,
} from "./ui";
import { TransactionThumb } from "./images";
import { ReimbursableSheet, RepaymentProposalCard } from "./reimbursables";
import { AccountThumb } from "./accounts";
import type { Account } from "../../frontend/shared/accountTypes";
import { autoCreatedFromDisplay } from "../../frontend/shared/accountTypes";
import {
  classificationLabel,
  ENTRY_SOURCE_LABELS,
  ENTRY_SOURCES,
  REVIEW_REASON_LABELS,
  reviewReasonsText,
} from "../../frontend/shared/entrySource";
import {
  REVIEW_REASONS,
  ruleEffectText,
  suggestRuleMatch,
  type PublicRule,
  type ReviewEntry,
  type ReviewQueue,
} from "../../frontend/shared/reviewTypes";
import { DecisionBlock, Questions } from "./decision";

/**
 * To review: entries the assistant logged (and anything put back in the
 * queue), the accounts Fortuna created for them, and corrections that can
 * become rules. It uses the same review routes as twee, so both work one queue.
 */

const STATUS_LABELS: Record<string, string> = { to_review: "To review", reviewed: "Reviewed", all: "All" };

/** Accounts Fortuna created for entries that matched none: keep them, or merge into an existing one. */
function NewAccounts({ accounts, onChanged }: { accounts: Account[]; onChanged: () => Promise<any> | void }) {
  const { call } = useApi();
  const [merging, setMerging] = useState<Account | null>(null);
  const created = accounts.filter((a) => a.autoCreated);
  const targets = accounts.filter((a) => a.id !== merging?.id && !a.archived && !a.autoCreated);
  if (!created.length) return null;
  return (
    <Section title="New accounts" hint="Fortuna created these for entries that matched none of your accounts.">
      <Group>
        {created.map((a) => (
          <ListItem
            key={a.id}
            left={<AccountThumb account={a} size={32} />}
            title={a.name}
            subtitle={`${autoCreatedFromDisplay(a.autoCreatedFrom)} · ${plural(a.transactionCount, "transaction")}`}
            right={
              <View style={[styles.row, { gap: 6 }]}>
                <Button
                  title="Keep"
                  compact
                  secondary
                  onPress={() =>
                    void call("confirmReviewAccount", a.id)
                      .then(() => {
                        toast(`${a.name} kept`);
                        return onChanged();
                      })
                      .catch(notice)
                  }
                />
                <Button title="Merge…" compact secondary onPress={() => setMerging(a)} />
              </View>
            }
          />
        ))}
      </Group>
      <Sheet visible={!!merging} onClose={() => setMerging(null)} title={merging ? `Merge ${merging.name} into` : undefined}>
        {targets.length ? (
          <Group>
            {targets.map((target) => (
              <ListItem
                key={target.id}
                left={<AccountThumb account={target} size={32} />}
                title={target.name}
                subtitle={target.institution || undefined}
                onPress={() => {
                  const source = merging;
                  if (!source) return;
                  setMerging(null);
                  // Let the sheet close before the alert (iOS drops alerts over a closing modal).
                  setTimeout(
                    () =>
                      confirm(
                        `Merge into ${target.name}?`,
                        `${source.name}'s cards, statement identifiers and entries move to ${target.name}, and ${source.name} is deleted.`,
                        async () => {
                          await call("mergeReviewAccount", source.id, target.id);
                          toast(`Merged into ${target.name}`);
                          await onChanged();
                        },
                        "Merge",
                      ),
                    Platform.OS === "ios" ? 350 : 0,
                  );
                }}
              />
            ))}
          </Group>
        ) : (
          <Txt muted>No other accounts to merge into.</Txt>
        )}
      </Sheet>
    </Section>
  );
}

/** Rules the assistant created by itself since the last review; undoing one puts its entries back in the queue. */
function NewRules({ rules, onChanged }: { rules: PublicRule[]; onChanged: () => Promise<any> | void }) {
  const { call } = useApi();
  if (!rules.length) return null;
  return (
    <Section title="New rules" hint="The assistant created these from entries it logged.">
      <Group>
        {rules.map((rule) => (
          <ListItem
            key={rule.id}
            icon="git-branch-outline"
            title={rule.name}
            subtitle={[
              ruleEffectText(rule),
              rule.reason,
              rule.examples.length ? plural(rule.examples.length, "example") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            right={
              <Button
                title="Undo"
                compact
                secondary
                onPress={() =>
                  confirm(
                    `Undo “${rule.name}”?`,
                    "The rule is turned off and the entries it classified go back in the queue.",
                    async () => {
                      const result = await call<{ reopened: number }>("undoReviewRule", rule.id);
                      toast(result?.reopened ? `Undone · ${plural(result.reopened, "entry", "entries")} back in review` : "Rule undone");
                      await onChanged();
                    },
                    "Undo",
                  )
                }
              />
            }
          />
        ))}
      </Group>
    </Section>
  );
}

/** Category, account and label for the selected entries, optionally saved as a rule. */
function CorrectSheet({
  entries,
  accounts,
  visible,
  onClose,
  onDone,
}: {
  entries: ReviewEntry[];
  accounts: Account[];
  visible: boolean;
  onClose: () => void;
  onDone: () => Promise<any> | void;
}) {
  const { call } = useApi();
  const categories = useResource("getCategories", { scope: "main" });
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const [label, setLabel] = useState("");
  const [makeRule, setMakeRule] = useState(false);
  const [matchValue, setMatchValue] = useState("");
  const [accountOnly, setAccountOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const descriptions = entries.map((e) => e.description);
  const suggestion = useMemo(() => suggestRuleMatch(descriptions), [descriptions.join("\n")]);
  const reset = () => {
    setCategory("");
    setAccount("");
    setLabel("");
    setMakeRule(false);
    setMatchValue("");
    setAccountOnly(false);
  };
  const nothing = !category && !account && !label.trim();
  const ruleProblem = makeRule
    ? !category && !label.trim()
      ? "A rule needs a category or a label to set."
      : matchValue.trim().length < 2
        ? "Give at least two characters the descriptions contain."
        : descriptions.some((d) => !d.toLowerCase().includes(matchValue.trim().toLowerCase()))
          ? "Every selected description must contain this text."
          : null
    : null;
  const apply = async () => {
    setSaving(true);
    try {
      const result = await call<{ transactions: ReviewEntry[]; rule?: { name: string } }>("correctReviewEntries", {
        ids: entries.map((e) => e.id),
        ...(category ? { category } : {}),
        ...(account ? { account } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
        markReviewed: true,
        ...(makeRule ? { createRule: { matchValue: matchValue.trim(), accountOnly } } : {}),
      });
      toast(result.rule ? `Saved, with rule “${result.rule.name}”` : `${plural(result.transactions.length, "entry", "entries")} corrected`);
      reset();
      onClose();
      await onDone();
    } catch (error) {
      notice(error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Correct ${plural(entries.length, "entry", "entries")}`}
      subtitle="Corrected entries are marked reviewed."
      footer={<Button title="Apply" loading={saving} disabled={nothing || !!ruleProblem || saving} onPress={() => void apply()} />}
    >
      <Choice
        label="Category"
        value={category}
        placeholder="Keep as is"
        options={[
          { label: "Keep as is", value: "" },
          ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
        ]}
        onChange={(v) => setCategory(v || "")}
      />
      <Choice
        label="Account"
        value={account}
        placeholder="Keep as is"
        options={[
          { label: "Keep as is", value: "" },
          ...accounts.filter((a) => !a.archived).map((a) => ({ label: a.name, value: a.id, color: a.color })),
        ]}
        onChange={(v) => setAccount(v || "")}
      />
      <Input label="Label" value={label} onChangeText={setLabel} placeholder="Keep as is" />
      <Card style={{ gap: 10 }}>
        <View style={[styles.row, { gap: 10 }]}>
          <Checkbox
            checked={makeRule}
            label="Make a rule from this correction"
            onChange={(on) => {
              setMakeRule(on);
              if (on && !matchValue) setMatchValue(suggestion);
            }}
          />
          <Txt style={{ flex: 1 }}>Make a rule from this correction</Txt>
        </View>
        {makeRule && (
          <>
            <Input
              label="When the description contains"
              value={matchValue}
              onChangeText={setMatchValue}
              autoCapitalize="none"
              error={ruleProblem || undefined}
            />
            <View style={[styles.row, { gap: 10 }]}>
              <Checkbox checked={accountOnly} label="Only for this account" onChange={setAccountOnly} />
              <Txt style={{ flex: 1 }}>Only for this account</Txt>
            </View>
            <Txt muted size={12}>
              Future entries and imports that match get the same category and label.
            </Txt>
          </>
        )}
      </Card>
    </Sheet>
  );
}

export function ReviewScreen({ navigation }: any) {
  const { call } = useApi();
  const [status, setStatus] = useState("to_review");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const [account, setAccount] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [reimbursing, setReimbursing] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const accounts = useResource<Account[]>("getAccounts", { includeArchived: false });
  const base = {
    status,
    ...(source ? { entrySource: [source] } : {}),
    ...(account ? { account } : {}),
  };
  // Reason counts ignore the reason filter, so the chips show what each holds.
  const counts = useResource<ReviewQueue>("getReviewQueue", { ...base, limit: 1 });
  const filters = { ...base, ...(reason ? { reasons: [reason] } : {}) };
  const queue = usePaged<ReviewEntry>(
    "getReviewQueue",
    (offset, limit) => [{ ...filters, offset, limit: Math.min(limit, 200) }],
    (data) => ({ items: data.transactions || [], total: data.total || 0 }),
    [filters],
    50,
  );
  const byId = useMemo(() => new Map((accounts.data || []).map((a) => [a.id, a])), [accounts.data]);
  const chosen = queue.items.filter((e) => selected.includes(e.id));
  const toggle = (id: string) =>
    setSelected((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const reload = async () => {
    await Promise.all([queue.reload(), counts.reload(), accounts.reload()]);
  };
  const markReviewed = async (ids: string[]) => {
    try {
      await call("setReviewEntriesStatus", ids, "reviewed");
      toast(ids.length === 1 ? "Marked reviewed" : `${ids.length} marked reviewed`);
      setSelected((now) => now.filter((id) => !ids.includes(id)));
      await reload();
    } catch (error) {
      notice(error);
    }
  };
  const done = () => {
    setSelected([]);
    setSelecting(false);
  };
  const reasonCounts = counts.data?.reasons;
  return (
    <Screen
      refreshControl={<RefreshControl refreshing={queue.loading && queue.loaded} onRefresh={() => void reload()} />}
      footer={
        selecting ? (
          <>
            <Txt bold size={14}>
              {selected.length ? `${selected.length} selected` : "Tap entries to select them"}
            </Txt>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button title="Correct…" compact disabled={!chosen.length} onPress={() => setCorrecting(true)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Reimbursable…" compact secondary disabled={!chosen.length} onPress={() => setReimbursing(true)} />
              </View>
              {status !== "reviewed" && (
                <View style={{ flex: 1 }}>
                  <Button
                    title="Mark reviewed"
                    compact
                    secondary
                    disabled={!chosen.length}
                    onPress={() => void markReviewed(chosen.map((e) => e.id))}
                  />
                </View>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={selected.length === queue.items.length ? "Select none" : "Select all shown"}
                  compact
                  ghost
                  onPress={() => setSelected(selected.length === queue.items.length ? [] : queue.items.map((e) => e.id))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Done" compact ghost onPress={done} />
              </View>
            </View>
          </>
        ) : undefined
      }
    >
      <NewRules rules={counts.data?.newRules || []} onChanged={reload} />
      <NewAccounts accounts={accounts.data || []} onChanged={reload} />
      <Chips values={Object.keys(STATUS_LABELS)} labels={STATUS_LABELS} value={status} onChange={setStatus} />
      <Chips
        values={["", ...REVIEW_REASONS]}
        labels={{ "": "All reasons", ...REVIEW_REASON_LABELS }}
        counts={reasonCounts ? { "": counts.data?.total, ...reasonCounts } : undefined}
        value={reason}
        onChange={setReason}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Choice
            compact
            label="Source"
            value={source}
            options={[
              { label: "All sources", value: "" },
              ...ENTRY_SOURCES.map((s) => ({ label: ENTRY_SOURCE_LABELS[s], value: s })),
            ]}
            onChange={(v) => setSource(v || "")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Choice
            compact
            label="Account"
            value={account}
            options={[
              { label: "All accounts", value: "" },
              ...(accounts.data || []).map((a) => ({ label: a.name, value: a.id, color: a.color })),
            ]}
            onChange={(v) => setAccount(v || "")}
          />
        </View>
      </View>
      <State loading={queue.loading} error={queue.error} reload={queue.reload} data={queue.loaded || null} />
      {queue.loaded && (
        <Section
          title={`${queue.total} ${status === "to_review" ? "waiting" : status === "reviewed" ? "reviewed" : "entries"}`}
          action={!selecting && queue.items.length ? "Select" : undefined}
          onAction={() => setSelecting(true)}
        >
          {queue.items.length === 0 ? (
            <Card>
              <Empty icon="checkmark-done-outline" title={status === "to_review" ? "Nothing waiting for review" : "No entries"} />
            </Card>
          ) : (
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {queue.items.map((item) => {
                const entryAccount = item.accountId ? byId.get(item.accountId) : undefined;
                const decided = classificationLabel(item.classification);
                const why = [reviewReasonsText(item.reviewReasons), decided ? `Category from ${decided.charAt(0).toLowerCase()}${decided.slice(1)}` : null]
                  .filter(Boolean)
                  .join(" · ");
                const hasDecision = !!(item.decision || item.classification?.decidedBy || item.precedents?.length);
                const showing = hasDecision && open.includes(item.id);
                return (
                  <View key={item.id}>
                    <TransactionRow
                      item={{
                        ...item,
                        accountColor: entryAccount?.color,
                        accountLabel: entryAccount?.name || item.account,
                      }}
                      leading={<TransactionThumb item={item} />}
                      showDate
                      selectable={selecting}
                      selected={selected.includes(item.id)}
                      onPress={() =>
                        selecting ? toggle(item.id) : navigation.navigate("Transaction", { id: item.id, item })
                      }
                      onLongPress={() => {
                        setSelecting(true);
                        toggle(item.id);
                      }}
                      right={
                        !selecting && item.reviewStatus === "to_review" ? (
                          <IconButton
                            icon="checkmark-circle-outline"
                            label="Mark reviewed"
                            size={34}
                            onPress={() => void markReviewed([item.id])}
                          />
                        ) : undefined
                      }
                    />
                    {(!!why || hasDecision || !!item.questions?.length) && (
                      <View style={{ paddingLeft: 61, paddingRight: 12, marginTop: -6, paddingBottom: 8, gap: 8 }}>
                        {(!!why || hasDecision) && (
                          <View style={[styles.between, { gap: 8 }]}>
                            <Txt muted size={12} style={{ flex: 1 }}>
                              {why}
                            </Txt>
                            {hasDecision && (
                              <Button
                                title={showing ? "Hide" : "Show"}
                                label={showing ? "Hide decision" : "Show decision"}
                                compact
                                ghost
                                onPress={() =>
                                  setOpen((now) => (now.includes(item.id) ? now.filter((x) => x !== item.id) : [...now, item.id]))
                                }
                              />
                            )}
                          </View>
                        )}
                        {showing && (
                          <DecisionBlock
                            classification={item.classification}
                            decision={item.decision}
                            merchant={item.merchant}
                            transactionType={item.transactionType}
                            precedents={item.precedents}
                          />
                        )}
                        {!selecting && <Questions transactionId={item.id} questions={item.questions} onAnswered={reload} />}
                      </View>
                    )}
                    {!!item.reimbursementProposal && !selecting && (
                      <View style={{ paddingLeft: 61, paddingRight: 12, paddingBottom: 10 }}>
                        <RepaymentProposalCard proposal={item.reimbursementProposal} onConfirmed={reload} />
                      </View>
                    )}
                  </View>
                );
              })}
              {queue.items.length < queue.total && (
                <View style={{ padding: 10 }}>
                  <Button
                    title={`Load more (${queue.total - queue.items.length})`}
                    secondary
                    compact
                    loading={queue.loadingMore}
                    onPress={queue.loadMore}
                  />
                </View>
              )}
            </Card>
          )}
        </Section>
      )}
      <CorrectSheet
        entries={chosen}
        accounts={accounts.data || []}
        visible={correcting}
        onClose={() => setCorrecting(false)}
        onDone={async () => {
          done();
          await reload();
        }}
      />
      <ReimbursableSheet
        visible={reimbursing}
        ids={chosen.map((e) => e.id)}
        amountOut={chosen.length === 1 ? Number(chosen[0].amountOut || 0) : undefined}
        onClose={() => setReimbursing(false)}
        onSaved={async () => {
          done();
          await reload();
        }}
      />
    </Screen>
  );
}
