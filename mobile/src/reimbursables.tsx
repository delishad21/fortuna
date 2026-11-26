import React, { useEffect, useMemo, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useApi, useResource } from "./api";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Chips,
  confirm,
  Empty,
  fmtDate,
  fmtMonth,
  Group,
  Input,
  KeyValue,
  ListItem,
  money,
  notice,
  Pill,
  plural,
  Screen,
  Section,
  Segmented,
  Sheet,
  Stat,
  StatGrid,
  State,
  styles,
  toast,
  Txt,
} from "./ui";
import {
  MATCH_LABELS,
  describeShare,
  flagFromRow,
  isShareError,
  owedFor,
  shareFields,
  shareFromFields,
  shareInput,
  shareOf,
  type BackfillItem,
  type BackfillProposal,
  type OutstandingReimbursements,
  type PersonBalance,
  type ReimbursableFlag,
  type ReimbursableSummary,
  type RepaymentProposal,
  type RepaymentProposalWithRepayment,
  type ShareMode,
} from "../../frontend/shared/reimbursables";

/**
 * Reimbursable spending on the phone: money out paid for someone who pays it
 * back. It keeps its category; the flag names the person and what they owe.
 */

const SHARE_LABELS: Record<ShareMode, string> = { full: "In full", half: "Half", amount: "Amount", percent: "Share %" };
const NEW = "__new__";

function ShareInput({ mode, value, onMode, onValue }: { mode: ShareMode; value: string; onMode: (m: ShareMode) => void; onValue: (v: string) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <Segmented values={["full", "half", "amount", "percent"]} labels={SHARE_LABELS} value={mode} onChange={(v) => onMode(v as ShareMode)} />
      {(mode === "amount" || mode === "percent") && (
        <Input
          label={mode === "amount" ? "Amount they owe" : "Their share in %"}
          value={value}
          onChangeText={onValue}
          keyboardType="decimal-pad"
          placeholder={mode === "amount" ? "0.00" : "50"}
        />
      )}
    </View>
  );
}

/** Who one or more transactions were paid for and what they owe. Saves on Save. */
export function ReimbursableSheet({
  visible,
  ids,
  current,
  amountOut,
  onClose,
  onSaved,
}: {
  visible: boolean;
  ids: string[];
  current?: ReimbursableFlag | null;
  amountOut?: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { call } = useApi();
  const people = useResource<{ people: PersonBalance[] }>(visible ? "getReimbursementPeople" : "");
  const list = (people.data?.people || []).map((p) => p.person);
  const [person, setPerson] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<ShareMode>("full");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const fields = shareFields(current?.share);
    setMode(fields.mode);
    setValue(fields.value);
    setNote(current?.note || "");
    setName("");
    setPerson(current?.personId || "");
  }, [visible, current]);
  useEffect(() => {
    if (visible && !person && people.data) setPerson(list[0]?.id || NEW);
  }, [visible, person, people.data]);
  const share = shareFromFields(mode, value);
  const owed = amountOut && !isShareError(share) ? owedFor(amountOut, shareOf(share)) : null;
  const save = async () => {
    if (isShareError(share)) return notice(new Error(share.error));
    const creating = person === NEW;
    const who = creating ? name.trim() : person;
    if (!who) return notice(new Error("Choose who it was for, or add them"));
    setSaving(true);
    try {
      const result: any = await call("setTransactionsReimbursable", { ids, person: who, createPerson: creating, share, note: note.trim() || null });
      toast(result.skipped?.length ? `Marked · ${plural(result.skipped.length, "row")} skipped` : `Marked reimbursable · ${money(result.owed)} owed`);
      onClose();
      await onSaved();
    } catch (error) {
      notice(error);
    } finally {
      setSaving(false);
    }
  };
  const clear = async () => {
    setSaving(true);
    try {
      await call("clearTransactionsReimbursable", ids);
      toast("Unmarked");
      onClose();
      await onSaved();
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
      title="Paid for someone"
      subtitle={ids.length > 1 ? `${plural(ids.length, "transaction")} · money in and transfers are skipped` : "It keeps its category"}
      footer={
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!!current && (
            <View style={{ flex: 1 }}>
              <Button title="Unmark" secondary danger disabled={saving} onPress={() => void clear()} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button title={current ? "Save" : "Mark reimbursable"} loading={saving} onPress={() => void save()} />
          </View>
        </View>
      }
    >
      <View style={{ gap: 8 }}>
        <Txt muted size={13} bold>
          Paid for
        </Txt>
        <Chips
          values={[...list.filter((p) => !p.archived || p.id === person).map((p) => p.id), NEW]}
          labels={{ ...Object.fromEntries(list.map((p) => [p.id, p.name])), [NEW]: "Add someone" }}
          value={person}
          onChange={setPerson}
        />
        {person === NEW && <Input value={name} onChangeText={setName} placeholder="Name, e.g. Madeline" autoCapitalize="words" />}
      </View>
      <View style={{ gap: 8 }}>
        <Txt muted size={13} bold>
          They owe
        </Txt>
        <ShareInput mode={mode} value={value} onMode={setMode} onValue={setValue} />
        {owed !== null && (
          <Txt muted size={12}>
            {money(owed)} owed
          </Txt>
        )}
      </View>
      <Input label="Note" value={note} onChangeText={setNote} placeholder="Optional" />
    </Sheet>
  );
}

/** The flag in a transaction's details, for money out. */
export function ReimbursableSection({ transaction, onChanged }: { transaction: any; onChanged: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const flag = flagFromRow(transaction);
  return (
    <Section title="Reimbursable">
      <Card style={{ gap: 10 }}>
        {flag ? (
          <>
            <KeyValue label="Paid for" value={flag.person || "Someone"} />
            <KeyValue label="They owe" mono value={`${money(flag.owed, transaction.currency)} · ${describeShare(flag.share)}`} />
            {!!flag.note && <KeyValue label="Note" value={flag.note} />}
          </>
        ) : (
          <Txt muted size={13}>
            Paid for someone who pays you back? Mark it; it keeps its category.
          </Txt>
        )}
        <Button
          title={flag ? "Edit" : "Mark reimbursable"}
          compact
          secondary
          icon="cash-outline"
          style={{ alignSelf: "flex-start" }}
          onPress={() => setOpen(true)}
        />
      </Card>
      <ReimbursableSheet
        visible={open}
        ids={[transaction.id]}
        current={flag}
        amountOut={Number(transaction.amountOut || 0)}
        onClose={() => setOpen(false)}
        onSaved={onChanged}
      />
    </Section>
  );
}

/** Money in that looks like a repayment, with the items it would pay back and Confirm. */
export function RepaymentProposalCard({
  proposal,
  markReviewed = true,
  onConfirmed,
}: {
  proposal: RepaymentProposal;
  markReviewed?: boolean;
  onConfirmed: () => void | Promise<void>;
}) {
  const { call } = useApi();
  const [saving, setSaving] = useState(false);
  const total = proposal.links.reduce((sum, link) => sum + link.amount, 0);
  const notes = [
    proposal.remainingOnItems > 0.005 ? `${money(proposal.remainingOnItems)} stays outstanding` : null,
    proposal.unallocated > 0.005 ? `${money(proposal.unallocated)} isn't linked` : null,
    proposal.marksReimbursement ? "It will be marked a Reimbursement" : null,
  ].filter(Boolean);
  return (
    <Card style={{ gap: 8 }}>
      <Txt size={14}>
        Looks like a repayment from <Txt bold size={14}>{proposal.person.name}</Txt>
      </Txt>
      <Txt muted size={12}>
        {MATCH_LABELS[proposal.match]} · {money(total)} to {plural(proposal.links.length, "item")}
      </Txt>
      {proposal.links.map((link) => (
        <View key={link.transactionId} style={styles.between}>
          <Txt muted size={12} numberOfLines={1} style={{ flex: 1 }}>
            {fmtDate(link.date, false)} · {link.label || link.description}
          </Txt>
          <Txt mono size={12}>
            {money(link.amount)}
          </Txt>
        </View>
      ))}
      {!!notes.length && (
        <Txt muted size={12}>
          {notes.join(" · ")}
        </Txt>
      )}
      <Button
        title="Confirm links"
        compact
        loading={saving}
        onPress={async () => {
          setSaving(true);
          try {
            await call(
              "confirmRepaymentLinks",
              proposal.transactionId,
              proposal.links.map((link) => ({ transactionId: link.transactionId, amount: link.amount })),
              markReviewed,
            );
            toast(`Linked ${money(total)} for ${proposal.person.name}`);
            await onConfirmed();
          } catch (error) {
            notice(error);
          } finally {
            setSaving(false);
          }
        }}
      />
    </Card>
  );
}

/** Analytics: what was spent for others in the period, apart from (or inside) the totals. */
export function SpentForOthers({ summary }: { summary?: ReimbursableSummary | null }) {
  if (!summary || !(summary.spentFor > 0)) return null;
  return (
    <Section title="Spent for others" hint={summary.countsAsOwn ? "Counted in your spending until repaid." : "Not in your spending above."}>
      <Group>
        {summary.people.map((person) => (
          <ListItem
            key={person.personId}
            icon="cash-outline"
            title={`Spent for ${person.name}`}
            subtitle={`Repaid ${money(person.repaid)}${person.outstanding > 0.005 ? ` · ${money(person.outstanding)} outstanding` : ""}`}
            value={money(person.spentFor)}
          />
        ))}
      </Group>
    </Section>
  );
}

/** Everyone the user pays for, with what each owes. */
export function ReimbursementsScreen({ navigation }: any) {
  const { call } = useApi();
  const data = useResource<OutstandingReimbursements>("getOutstandingReimbursements", { items: "none" });
  const [name, setName] = useState("");
  const add = async () => {
    if (!name.trim()) return;
    try {
      const result: any = await call("createReimbursementPerson", name.trim());
      setName("");
      await data.reload();
      navigation.navigate("ReimbursementPerson", { id: result.person.id, name: result.person.name });
    } catch (error) {
      notice(error);
    }
  };
  return (
    <Screen refreshControl={<RefreshControl refreshing={data.loading && !!data.data} onRefresh={data.reload} />}>
      <State {...data} />
      {data.data && (
        <>
          <StatGrid>
            <Stat label="Owed to you" value={money(data.data.outstanding)} tone={data.data.outstanding > 0 ? "purple" : undefined} />
          </StatGrid>
          <Section title="People" action="Review past items" onAction={() => navigation.navigate("ReimbursableBackfill", { person: data.data?.people[0]?.person.name || "" })}>
            {data.data.people.length ? (
              <Group>
                {data.data.people.map((entry) => (
                  <ListItem
                    key={entry.person.id}
                    icon="person-outline"
                    title={entry.person.name}
                    subtitle={`${plural(entry.openItems, "open item")} · ${money(entry.owed)} spent for them`}
                    value={money(entry.outstanding)}
                    chevron
                    onPress={() => navigation.navigate("ReimbursementPerson", { id: entry.person.id, name: entry.person.name })}
                  />
                ))}
              </Group>
            ) : (
              <Card>
                <Empty icon="people-outline" title="No one yet" />
                <Txt muted size={13} style={{ textAlign: "center" }}>
                  Add the people you pay for, then mark their items from a transaction or review your past items.
                </Txt>
              </Card>
            )}
          </Section>
          <Section title="Add someone">
            <Input value={name} onChangeText={setName} placeholder="Name, e.g. Madeline" autoCapitalize="words" onSubmitEditing={() => void add()} />
            <Button title="Add" compact secondary disabled={!name.trim()} style={{ alignSelf: "flex-start" }} onPress={() => void add()} />
          </Section>
        </>
      )}
    </Screen>
  );
}

/** One person: what they owe by month, their items, possible repayments and their names. */
export function ReimbursementPersonScreen({ navigation, route }: any) {
  const { call } = useApi();
  const id = route.params.id;
  const [show, setShow] = useState<"open" | "all">("open");
  const data = useResource<OutstandingReimbursements>("getOutstandingReimbursements", { person: id, items: show });
  const proposals = useResource<{ proposals: RepaymentProposalWithRepayment[] }>("getRepaymentProposals", { person: id });
  const balance = data.data?.people[0];
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  useEffect(() => {
    if (!balance) return;
    setName(balance.person.name);
    setAliases(balance.person.aliases.join(", "));
  }, [balance?.person.id, balance?.person.name, balance?.person.aliases.join(",")]);
  const reload = async () => {
    await Promise.all([data.reload(), proposals.reload()]);
  };
  if (!balance)
    return (
      <Screen>
        <State {...data} />
      </Screen>
    );
  const person = balance.person;
  return (
    <Screen refreshControl={<RefreshControl refreshing={data.loading} onRefresh={reload} />}>
      <StatGrid>
        <Stat label={`${person.name} owes`} value={money(balance.outstanding)} tone={balance.outstanding > 0 ? "purple" : undefined} detail={plural(balance.openItems, "open item")} />
        <Stat label="Repaid" value={money(balance.repaid)} tone="green" detail={`of ${money(balance.owed)} spent for them`} />
      </StatGrid>
      {!!proposals.data?.proposals.length && (
        <Section title="Possible repayments">
          {proposals.data.proposals.map((proposal) => (
            <View key={proposal.transactionId} style={{ gap: 6 }}>
              <View style={[styles.between, { paddingHorizontal: 4 }]}>
                <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>
                  {fmtDate(proposal.repayment.date)} · {proposal.repayment.label || proposal.repayment.description}
                </Txt>
                <Txt mono size={13} tone="green">
                  +{money(proposal.repayment.amountIn)}
                </Txt>
              </View>
              <RepaymentProposalCard proposal={proposal} markReviewed={proposal.repayment.reviewStatus === "to_review"} onConfirmed={reload} />
            </View>
          ))}
        </Section>
      )}
      <Section title="By month">
        {balance.months.length ? (
          <Group>
            {[...balance.months].reverse().map((month) => (
              <ListItem
                key={month.month}
                icon="calendar-outline"
                title={fmtMonth(month.month)}
                subtitle={`${money(month.owed)} spent · ${money(month.repaid)} repaid`}
                value={money(month.outstanding)}
                valueTone={month.outstanding > 0.005 ? "purple" : undefined}
              />
            ))}
          </Group>
        ) : (
          <Card>
            <Empty icon="receipt-outline" title={`Nothing marked for ${person.name} yet`} />
          </Card>
        )}
      </Section>
      <Section title={show === "open" ? "Open items" : "All items"}>
        <Segmented values={["open", "all"]} labels={{ open: "Open", all: "All" }} value={show} onChange={(v) => setShow(v as "open" | "all")} />
        {balance.items?.length ? (
          <Group>
            {[...balance.items].reverse().map((item) => (
              <ListItem
                key={item.id}
                color={item.category?.color}
                icon="ellipse"
                title={item.label || item.description}
                subtitle={`${fmtDate(item.date)} · ${money(item.amountOut)}, owes ${describeShare(item.share)}${item.repaid > 0.005 ? ` · ${money(item.repaid)} repaid` : ""}`}
                value={money(item.outstanding)}
                chevron
                onPress={() => navigation.navigate("Transaction", { id: item.id })}
              />
            ))}
          </Group>
        ) : (
          <Card>
            <Empty icon="checkmark-done-outline" title={show === "open" ? `${person.name} owes nothing right now` : "No items"} />
          </Card>
        )}
      </Section>
      <Section title="Names" hint="Money in naming them, or one of these other names (e.g. the full name on a PayNow transfer), is offered as their repayment.">
        <Input label="Name" value={name} onChangeText={setName} />
        <Input label="Other names" value={aliases} onChangeText={setAliases} placeholder="Separated by commas" autoCapitalize="characters" />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Save"
              compact
              disabled={!name.trim()}
              onPress={async () => {
                try {
                  await call("updateReimbursementPerson", person.id, {
                    name: name.trim(),
                    aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
                  });
                  toast("Saved");
                  await data.reload();
                } catch (error) {
                  notice(error);
                }
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={balance.itemCount ? (person.archived ? "Restore" : "Archive") : "Remove"}
              compact
              secondary
              danger={!balance.itemCount}
              onPress={() =>
                balance.itemCount
                  ? void call("updateReimbursementPerson", person.id, { archived: !person.archived })
                      .then(() => {
                        toast(person.archived ? "Restored" : "Archived; their items stay marked");
                        navigation.goBack();
                      })
                      .catch(notice)
                  : confirm(`Remove ${person.name}?`, "They have no items.", async () => {
                      await call("deleteReimbursementPerson", person.id);
                      navigation.goBack();
                    }, "Remove")
              }
            />
          </View>
        </View>
      </Section>
    </Screen>
  );
}

type Row = BackfillItem & { tick: boolean; mode: ShareMode; value: string };

const rowOwed = (row: Row) => {
  const share = shareFromFields(row.mode, row.value);
  return isShareError(share) ? null : owedFor(row.amountOut, shareOf(share));
};

/**
 * Marking a person's past items, reviewed first: suggestions with their
 * reasons, ticked or not, with editable shares. Apply writes what is ticked.
 */
export function ReimbursableBackfillScreen({ route }: any) {
  const { call } = useApi();
  const people = useResource<{ people: PersonBalance[] }>("getReimbursementPeople");
  const [name, setName] = useState(route.params?.person || "");
  const [query, setQuery] = useState(route.params?.person || "");
  const data = useResource<BackfillProposal>(query ? "getReimbursableBackfill" : "", query);
  const [rows, setRows] = useState<Row[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (!data.data) return;
    setRows(data.data.items.map((item) => ({ ...item, tick: item.selected, ...shareFields(item.share) })));
    setLinks(data.data.links.filter((g) => g.selected).map((g) => g.repayment.id));
  }, [data.data]);
  const update = (id: string, patch: Partial<Row>) => setRows((now) => now.map((r) => (r.transactionId === id ? { ...r, ...patch } : r)));
  const totals = useMemo(() => {
    const ticked = rows.filter((r) => r.tick);
    return {
      count: ticked.length,
      owed: ticked.reduce((s, r) => s + (rowOwed(r) ?? 0), 0),
      outstanding: ticked.reduce((s, r) => s + Math.max((rowOwed(r) ?? 0) - r.repaid, 0), 0),
      invalid: ticked.some((r) => rowOwed(r) === null),
    };
  }, [rows]);
  const apply = () =>
    confirm(
      "Apply?",
      `Marks ${plural(totals.count, "item")} for ${data.data?.person.name}${links.length ? ` and links ${plural(links.length, "repayment")}` : ""}.`,
      async () => {
        if (!data.data) return;
        setApplying(true);
        try {
          const items = rows
            .filter((r) => r.tick)
            .map((r) => {
              const share = shareFromFields(r.mode, r.value);
              if (isShareError(share)) throw new Error(`${r.label || r.description}: ${share.error}`);
              return { transactionId: r.transactionId, share: shareInput(shareOf(share)) };
            });
          const groups = data.data.links
            .filter((g) => links.includes(g.repayment.id))
            .map((g) => ({ repaymentId: g.repayment.id, links: g.links.map((l) => ({ transactionId: l.transactionId, amount: l.amount })) }));
          const result: any = await call("applyReimbursableBackfill", { person: data.data.person.name, items, links: groups });
          toast(`Marked ${result.marked} · linked ${result.linked}`);
          await data.reload();
        } catch (error) {
          notice(error);
        } finally {
          setApplying(false);
        }
      },
      "Apply",
    );
  const names = (people.data?.people || []).map((p) => p.person.name);
  const proposal = data.data;
  return (
    <Screen
      footer={
        proposal && (rows.length || proposal.links.length) ? (
          <>
            <Txt bold size={14}>
              {totals.count} ticked · {money(totals.owed)} owed · {money(totals.outstanding)} outstanding
            </Txt>
            <Button title="Apply" loading={applying} disabled={totals.invalid || (!totals.count && !links.length)} onPress={apply} />
          </>
        ) : undefined
      }
    >
      <Banner tone="purple" title="Nothing changes until you press Apply." />
      {!!names.length && <Chips values={names} value={query} onChange={(v) => { setName(v); setQuery(v); }} />}
      <Input value={name} onChangeText={setName} placeholder="Name in your labels, e.g. Madeline" autoCapitalize="words" onSubmitEditing={() => setQuery(name.trim())} />
      <Button title="Find items" compact secondary disabled={!name.trim()} style={{ alignSelf: "flex-start" }} onPress={() => setQuery(name.trim())} />
      {!!query && <State {...data} />}
      {proposal && (
        <>
          {!!proposal.alreadyMarked && (
            <Txt muted size={13}>
              {plural(proposal.alreadyMarked, "item")} already marked for {proposal.person.name}.
            </Txt>
          )}
          {!rows.length && !proposal.links.length && (
            <Card>
              <Empty icon="checkmark-done-outline" title={`No unmarked items name ${proposal.person.name}`} />
            </Card>
          )}
          {(["labelled", "linked"] as const).map((source) => {
            const list = rows.filter((r) => r.source === source);
            if (!list.length) return null;
            const all = list.every((r) => r.tick);
            return (
              <Section
                key={source}
                title={`${source === "labelled" ? "Labelled for them" : "Already paid back"} (${list.length})`}
                action={all ? "Untick all" : "Tick all"}
                onAction={() => setRows((now) => now.map((r) => (r.source === source ? { ...r, tick: !all } : r)))}
              >
                <Group>
                  {[...list].reverse().map((row) => {
                    const owed = rowOwed(row);
                    const fields = shareFromFields(row.mode, row.value);
                    const shareText = isShareError(fields) ? "share?" : describeShare(shareOf(fields));
                    return (
                      <ListItem
                        key={row.transactionId}
                        left={<Checkbox checked={row.tick} onChange={(on) => update(row.transactionId, { tick: on })} label={row.label || row.description} />}
                        title={row.label || row.description}
                        subtitle={`${fmtDate(row.date)} · ${money(row.amountOut)} · ${shareText}${row.repaid > 0.005 ? ` · ${money(row.repaid)} repaid` : ""}\n${row.confidence === "low" ? "Check: " : ""}${row.reason}`}
                        value={owed === null ? "—" : money(owed)}
                        valueTone={row.confidence === "low" ? "amber" : undefined}
                        onPress={() => setEditing(row)}
                      />
                    );
                  })}
                </Group>
              </Section>
            );
          })}
          {!!proposal.links.length && (
            <Section title="Repayments to link">
              <Group>
                {proposal.links.map((group) => (
                  <ListItem
                    key={group.repayment.id}
                    left={
                      <Checkbox
                        checked={links.includes(group.repayment.id)}
                        onChange={(on) => setLinks((now) => (on ? [...now, group.repayment.id] : now.filter((x) => x !== group.repayment.id)))}
                        label={group.repayment.label || group.repayment.description}
                      />
                    }
                    title={group.repayment.label || group.repayment.description}
                    subtitle={`${fmtDate(group.repayment.date)} · ${MATCH_LABELS[group.match]} · ${group.links
                      .map((l) => `${l.label || l.description} ${money(l.amount)}`)
                      .join(", ")}`}
                    value={`+${money(group.repayment.amountIn)}`}
                    valueTone="green"
                  />
                ))}
              </Group>
            </Section>
          )}
        </>
      )}
      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? editing.label || editing.description : undefined}
        subtitle={editing ? `${fmtDate(editing.date)} · ${money(editing.amountOut)}` : undefined}
        footer={<Button title="Done" onPress={() => setEditing(null)} />}
      >
        {editing && (
          <>
            <Txt muted size={13}>
              {editing.reason}
            </Txt>
            <ShareInput
              mode={rows.find((r) => r.transactionId === editing.transactionId)?.mode || "full"}
              value={rows.find((r) => r.transactionId === editing.transactionId)?.value || ""}
              onMode={(mode) => update(editing.transactionId, { mode, tick: true })}
              onValue={(value) => update(editing.transactionId, { value, tick: true })}
            />
            {(() => {
              const row = rows.find((r) => r.transactionId === editing.transactionId);
              const owed = row ? rowOwed(row) : null;
              return owed !== null ? <Pill label={`${money(owed)} owed`} tone="purple" /> : null;
            })()}
          </>
        )}
      </Sheet>
    </Screen>
  );
}
