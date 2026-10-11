import React, { useEffect, useState } from "react";
import { RefreshControl, View } from "react-native";
import { useApi, useResource } from "../api";
import {
  ActionMenu,
  Banner,
  Button,
  Card,
  Checkbox,
  Choice,
  confirm,
  Empty,
  fmtDate,
  Group,
  Heading,
  IconBubble,
  Input,
  KeyValue,
  money,
  notice,
  Screen,
  Section,
  Sheet,
  State,
  styles,
  toast,
  Txt,
} from "../ui";
import { isViewer, ViewerBanner } from "./common";

function PersonCard({ person, base, viewer, onSettle, onRename, onRemove }: any) {
  const open = person.currencies.filter((c: any) => c.open > 0.005);
  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.row}>
        <IconBubble text={person.name.slice(0, 1).toUpperCase()} size={42} tone={person.openBase > 0 ? "amber" : "green"} />
        <View style={{ flex: 1 }}>
          <Txt bold size={16}>
            {person.name}
          </Txt>
          <Txt muted size={13}>
            {open.length === 1
              ? `You owe ${money(open[0].open, open[0].currency)}${open[0].currency !== base ? ` ≈ ${money(person.openBase, base)}` : ""}`
              : open.length > 1
                ? `You owe ≈ ${money(person.openBase, base)} in total`
                : person.paidBase > 0
                  ? "Settled up"
                  : "Nothing owed"}
          </Txt>
          {person.paidBase > 0 && (
            <Txt muted size={12}>
              Paid back {money(person.paidBase, base)}
            </Txt>
          )}
        </View>
        {!viewer && (
          <ActionMenu
            title={person.name}
            actions={[
              { label: "Settle up", icon: "checkmark-done-outline", onPress: onSettle },
              { label: "Rename", icon: "create-outline", onPress: onRename },
              { label: "Remove", icon: "trash-outline", danger: true, onPress: onRemove },
            ]}
          />
        )}
      </View>
      {open.length > 1 &&
        open.map((c: any) => <KeyValue key={c.currency} label={c.currency} mono value={money(c.open, c.currency)} />)}
      {!viewer && open.length > 0 && <Button title="Settle up" compact secondary icon="checkmark-done-outline" onPress={onSettle} />}
    </Card>
  );
}
export function PeopleScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { call } = useApi();
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const viewer = isViewer(t);
  const balances = useResource("getTripBalances", tripId);
  const [editing, setEditing] = useState<any>(null);
  const [name, setName] = useState("");
  const base = balances.data?.baseCurrency || t?.baseCurrency || "SGD";
  const save = async () => {
    try {
      if (editing.participantId) await call("renameTripParticipant", tripId, editing.participantId, name.trim());
      else await call("createTripParticipant", tripId, name.trim());
      toast(editing.participantId ? "Renamed" : `${name.trim()} added`);
      setEditing(null);
      await balances.reload();
    } catch (e) {
      notice(e);
    }
  };
  return (
    <Screen refreshControl={<RefreshControl refreshing={balances.loading && !!balances.data} onRefresh={balances.reload} />}>
      <Heading
        title="People"
        subtitle="Who paid for what, and what you still owe."
        right={!viewer ? <Button title="Add" compact icon="person-add-outline" onPress={() => { setName(""); setEditing({}); }} /> : undefined}
      />
      <ViewerBanner trip={t} />
      <Banner
        tone="purple"
        icon="information-circle-outline"
        message="Add an entry paid by someone else to record an IOU. Record a Settle up entry, or a bank payment as a settlement, when you pay them back."
      />
      <State {...balances} />
      {balances.data?.people?.length === 0 && (
        <Card>
          <Empty icon="people-outline" title="Nobody here yet" message="Add the people you travel with to track IOUs." />
        </Card>
      )}
      {(balances.data?.people || []).map((p: any) => (
        <PersonCard
          key={p.participantId}
          person={p}
          base={base}
          viewer={viewer}
          onSettle={() => navigation.navigate("Settle", { tripId, trip: t, participantId: p.participantId })}
          onRename={() => {
            setName(p.name);
            setEditing(p);
          }}
          onRemove={() =>
            confirm(
              `Remove ${p.name}?`,
              "People with IOUs or settlements can't be removed. Delete those entries first.",
              async () => {
                await call("deleteTripParticipant", tripId, p.participantId);
                toast(`${p.name} removed`);
                await balances.reload();
              },
              "Remove",
            )
          }
        />
      ))}
      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.participantId ? "Rename person" : "Add a person"}
        footer={<Button title="Save" disabled={!name.trim()} onPress={() => void save()} />}
      >
        <Input label="Name" value={name} onChangeText={setName} autoFocus />
      </Sheet>
    </Screen>
  );
}
export function SettleScreen({ route, navigation }: any) {
  const { tripId, settlementEntryId } = route.params;
  const { call } = useApi();
  const trip = useResource("getTrip", tripId);
  const base = trip.data?.baseCurrency || "SGD";
  const entries = useResource("getTripPeopleEntries", tripId);
  const people = useResource("getTripParticipants", tripId);
  const all: any[] = entries.data || [];
  const fromSettlement = all.find((e) => e.id === settlementEntryId);
  const [personId, setPersonId] = useState(route.params.participantId || "");
  const [settlementId, setSettlementId] = useState(settlementEntryId || "");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!personId && fromSettlement?.counterparty?.id) setPersonId(fromSettlement.counterparty.id);
  }, [fromSettlement, personId]);
  const settlements = all.filter((e) => e.type === "settlement" && e.counterparty?.id === personId);
  const ious = all
    .filter((e) => e.isIou && e.counterparty?.id === personId)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  useEffect(() => {
    if (!settlementId && settlements[0]) setSettlementId(settlements[0].id);
  }, [settlements, settlementId]);
  const person = (people.data || []).find((p: any) => p.id === personId);
  const save = async () => {
    setError("");
    const items = Object.entries(alloc)
      .filter(([, v]) => v !== "")
      .map(([iouEntryId, v]) => ({ iouEntryId, localAmount: Number(v) }));
    if (!items.length) return setError("Choose at least one IOU");
    if (items.some((i) => !(i.localAmount > 0))) return setError("Amounts must be above 0");
    setBusy(true);
    try {
      await call("setTripSettlementAllocations", tripId, settlementId, items);
      toast("Settlement saved");
      navigation.goBack();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      footer={
        <>
          {!!error && <Txt tone="red" size={13}>{error}</Txt>}
          <Button title="Save settlement" icon="checkmark" loading={busy} disabled={busy || !settlementId} onPress={() => void save()} />
        </>
      }
    >
      <Heading title="Settle up" subtitle={person ? `With ${person.name}` : "Choose who you paid back."} />
      <State {...entries} />
      <Card>
        <Choice
          label="Person"
          value={personId}
          options={(people.data || []).map((p: any) => ({ label: p.name, value: p.id }))}
          onChange={(id) => {
            setPersonId(id);
            setSettlementId("");
            setAlloc({});
          }}
        />
        {personId && settlements.length === 0 && (
          <Txt muted size={13}>
            No settlements with {person?.name || "them"} yet. Add a "Settle up" entry from a wallet, or add the bank payment as a settlement from Add from bank.
          </Txt>
        )}
        {settlements.length > 0 && (
          <Choice
            label="Settlement"
            value={settlementId}
            options={settlements.map((s) => ({
              label: `${fmtDate(s.date)} · ${money(s.localAmount, s.localCurrency)}`,
              value: s.id,
              hint: s.localCurrency !== base ? `≈ ${money(s.baseAmount, base)} · ${s.description}` : s.description,
            }))}
            onChange={setSettlementId}
          />
        )}
      </Card>
      {personId && (
        <Section title="What it pays off">
          {ious.length === 0 ? (
            <Card>
              <Empty icon="receipt-outline" title={`You have no IOUs with ${person?.name || "them"}`} />
            </Card>
          ) : (
            ious.map((iou) => {
              const remaining = Math.max(0, Number(iou.localAmount) - Number(iou.iouSettledLocal || 0));
              const on = alloc[iou.id] !== undefined;
              return (
                <Card key={iou.id} style={{ gap: 8, opacity: on || remaining > 0 ? 1 : 0.55 }}>
                  <View style={styles.row}>
                    <Checkbox
                      checked={on}
                      label={`Settle ${iou.label || iou.description}`}
                      onChange={(c) =>
                        setAlloc((o) => {
                          const next = { ...o };
                          if (c) next[iou.id] = String(Math.round(remaining * 100) / 100);
                          else delete next[iou.id];
                          return next;
                        })
                      }
                    />
                    <View style={{ flex: 1 }}>
                      <Txt bold numberOfLines={1}>
                        {iou.label || iou.description}
                      </Txt>
                      <Txt muted size={12}>
                        {fmtDate(iou.date)} · {money(iou.localAmount, iou.localCurrency)} · {money(remaining, iou.localCurrency)} open
                      </Txt>
                    </View>
                  </View>
                  {on && (
                    <Input
                      label={`Amount (${iou.localCurrency})`}
                      value={alloc[iou.id]}
                      keyboardType="decimal-pad"
                      onChangeText={(v: string) => setAlloc((o) => ({ ...o, [iou.id]: v }))}
                    />
                  )}
                </Card>
              );
            })
          )}
        </Section>
      )}
    </Screen>
  );
}
export function ShareCostScreen({ route, navigation }: any) {
  const { tripId, item } = route.params;
  const { call } = useApi();
  const members = useResource("getTripMembers", tripId);
  const overview = useResource("getTripSharedOverview", tripId);
  const eligible = (members.data || []).filter((m: any) => !m.isMe && m.status === "active" && m.role !== "viewer");
  const total = Number(item.localAmount);
  const ratio = Number(item.baseAmount) ? total / Number(item.baseAmount) : 1;
  const [shares, setShares] = useState<Record<string, { on: boolean; amount: string }>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const splitEvenly = () => {
    const each = Math.floor((total / (eligible.length + 1)) * 100) / 100;
    setShares(Object.fromEntries(eligible.map((m: any) => [m.userId, { on: true, amount: String(each) }])));
  };
  useEffect(() => {
    if (ready || !members.data || !overview.data) return;
    const existing = overview.data.entries?.find((e: any) => e.id === item.id)?.shares || [];
    if (existing.length)
      setShares(
        Object.fromEntries(
          eligible.map((m: any) => {
            const s = existing.find((x: any) => x.userId === m.userId);
            return [m.userId, { on: !!s, amount: s ? String(Math.round(s.baseAmount * ratio * 100) / 100) : "" }];
          }),
        ),
      );
    else splitEvenly();
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.data, overview.data]);
  const given = Object.values(shares).reduce((s, v) => s + (v.on ? Number(v.amount) || 0 : 0), 0);
  const mine = Math.round((total - given) * 100) / 100;
  const save = async () => {
    setError("");
    const list = eligible
      .map((m: any) => ({ memberUserId: m.userId, localAmount: shares[m.userId]?.on ? Number(shares[m.userId].amount) || 0 : 0 }))
      .filter((s: any) => s.localAmount > 0);
    if (Object.values(shares).some((s) => s.on && Number(s.amount) < 0)) return setError("Amounts can't be negative");
    if (mine < -0.005) return setError("Shares can't add up to more than the total");
    setBusy(true);
    try {
      await call("setTripEntryMemberShares", tripId, item.id, list);
      toast("Shares saved. They show up as IOUs for the others.");
      navigation.goBack();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      footer={
        <>
          {!!error && <Txt tone="red" size={13}>{error}</Txt>}
          <Button title="Save shares" icon="checkmark" loading={busy} disabled={busy} onPress={() => void save()} />
        </>
      }
    >
      <Heading title="Share cost" subtitle={`${item.label || item.description} · ${money(total, item.localCurrency)}`} />
      <State {...members} />
      {members.data && eligible.length === 0 && (
        <Banner tone="amber" icon="people-outline" message="No other active editors on this trip to share with." />
      )}
      <Card style={{ gap: 8 }}>
        <KeyValue label="Total" mono value={money(total, item.localCurrency)} />
        <KeyValue label="Your part" mono tone={mine < 0 ? "red" : "purple"} value={money(mine, item.localCurrency)} />
        <Button title="Split evenly" compact secondary icon="git-branch-outline" onPress={splitEvenly} />
      </Card>
      <Group>
        {eligible.map((m: any) => {
          const s = shares[m.userId] || { on: false, amount: "" };
          return (
            <View key={m.userId} style={{ padding: 14, gap: 8 }}>
              <View style={styles.row}>
                <Checkbox checked={s.on} label={`Share with ${m.name}`} onChange={(on) => setShares((o) => ({ ...o, [m.userId]: { ...s, on } }))} />
                <Txt bold style={{ flex: 1 }}>
                  {m.name}
                </Txt>
              </View>
              {s.on && (
                <Input
                  label={`Their share (${item.localCurrency})`}
                  value={s.amount}
                  keyboardType="decimal-pad"
                  onChangeText={(amount: string) => setShares((o) => ({ ...o, [m.userId]: { ...s, amount } }))}
                />
              )}
            </View>
          );
        })}
      </Group>
    </Screen>
  );
}
