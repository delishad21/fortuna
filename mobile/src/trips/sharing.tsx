import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { useApi, useResource } from "../api";
import {
  ActionMenu,
  Banner,
  Button,
  Card,
  Choice,
  confirm,
  Empty,
  fmtDate,
  Group,
  Heading,
  IconBubble,
  Input,
  ListItem,
  money,
  notice,
  Pill,
  Screen,
  Section,
  Segmented,
  Stat,
  StatGrid,
  State,
  styles,
  toast,
  Txt,
  useTheme,
} from "../ui";
import { roleOf } from "./common";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
export function MembersScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { call } = useApi();
  const trip = useResource("getTrip", tripId);
  const t = trip.data || route.params.trip;
  const role = roleOf(t);
  const shared = !!t?.sharing;
  const members = useResource(shared ? "getTripMembers" : "", tripId);
  const [who, setWho] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [busy, setBusy] = useState(false);
  const invite = async () => {
    setBusy(true);
    try {
      await call("inviteTripMember", tripId, { usernameOrEmail: who.trim(), role: inviteRole });
      toast(`Invited ${who.trim()}. They'll see it on their trips page.`);
      setWho("");
      await Promise.all([trip.reload(), members.reload()]);
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void trip.reload(); void members.reload(); }} />}>
      <Heading
        title="Members"
        subtitle={shared ? "Each member keeps their own copy of the trip and adds their own spending." : "Share this trip with other Fortuna users."}
      />
      {shared && role !== "owner" && (
        <Banner
          tone="amber"
          icon="lock-closed-outline"
          message={`Trip details are managed by the owner.${role === "viewer" ? " You can view this trip but not change it." : ""}`}
        />
      )}
      {shared && (
        <Button title="Shared overview" secondary icon="globe-outline" onPress={() => navigation.navigate("SharedOverview", { tripId, trip: t })} />
      )}
      {shared && <State {...members} />}
      <Group>
        {!shared && <ListItem icon="person" title="You" subtitle="Owner" />}
        {(members.data || []).map((m: any) => (
          <ListItem
            key={m.memberId}
            left={<IconBubble text={m.name.slice(0, 1).toUpperCase()} size={36} tone={m.status === "invited" ? "amber" : "purple"} />}
            title={`${m.name}${m.isMe ? " (you)" : ""}`}
            subtitle={`${ROLE_LABEL[m.role]}${m.status === "invited" ? " · Invited" : ""}`}
            right={
              role === "owner" && m.role !== "owner" ? (
                <ActionMenu
                  title={m.name}
                  actions={[
                    m.role !== "editor" && {
                      label: "Make editor",
                      hint: "Adds their own spending",
                      icon: "create-outline",
                      onPress: () =>
                        void call("updateTripMemberRole", tripId, m.userId, "editor").then(members.reload).catch(notice),
                    },
                    m.role !== "viewer" && {
                      label: "Make viewer",
                      hint: "Can only look",
                      icon: "eye-outline",
                      onPress: () =>
                        void call("updateTripMemberRole", tripId, m.userId, "viewer").then(members.reload).catch(notice),
                    },
                    {
                      label: "Remove from trip",
                      icon: "person-remove-outline",
                      danger: true,
                      onPress: () =>
                        confirm(
                          `Remove ${m.name}?`,
                          "Their entries stay in their own copy of the trip. Shares between you become plain IOUs.",
                          async () => {
                            await call("removeTripMember", tripId, m.userId);
                            toast(`${m.name} removed`);
                            await Promise.all([members.reload(), trip.reload()]);
                          },
                          "Remove",
                        ),
                    },
                  ]}
                />
              ) : undefined
            }
          />
        ))}
      </Group>
      {role === "owner" && (
        <Section title="Invite someone">
          <Card>
            <Input
              label="Username or email"
              value={who}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setWho}
              returnKeyType="send"
              onSubmitEditing={() => who.trim() && void invite()}
            />
            <Segmented values={["editor", "viewer"]} labels={{ editor: "Editor", viewer: "Viewer" }} value={inviteRole} onChange={setInviteRole} />
            <Txt muted size={12}>
              {inviteRole === "editor" ? "Editors add their own spending and can share costs with you." : "Viewers can only look."}
            </Txt>
            <Button title="Send invite" icon="paper-plane-outline" loading={busy} disabled={busy || !who.trim()} onPress={() => void invite()} />
          </Card>
        </Section>
      )}
      {shared && role !== "owner" && (
        <Button
          title="Leave trip"
          danger
          secondary
          icon="exit-outline"
          onPress={() =>
            confirm("Leave this shared trip?", "Your entries stay in your own copy of the trip.", async () => {
              await call("leaveSharedTrip", tripId);
              toast("You left the shared trip. This is now your own trip.");
              await trip.reload();
            }, "Leave")
          }
        />
      )}
    </Screen>
  );
}
export function SharedOverviewScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { colors } = useTheme();
  const overview = useResource("getTripSharedOverview", tripId);
  const o = overview.data;
  const base = o?.baseCurrency || "SGD";
  return (
    <Screen refreshControl={<RefreshControl refreshing={overview.loading && !!o} onRefresh={overview.reload} />}>
      <Heading title="Together" subtitle="Everyone's spending on this shared trip." />
      {overview.error ? (
        <Card>
          <Empty icon="people-outline" title="This trip isn't shared" message={overview.error} action="Members" onAction={() => navigation.navigate("Members", { tripId })} />
        </Card>
      ) : (
        <State {...overview} />
      )}
      {o && (
        <>
          <StatGrid>
            <Stat icon="cart-outline" label="Spent together" value={money(o.totals.combinedSpent, base)} />
            <Stat icon="return-down-back-outline" tone="green" label="Reimbursed" value={money(o.totals.combinedReimbursed, base)} />
            <Stat icon="airplane-outline" tone="purple" label="Net trip cost" value={money(o.totals.combinedNet, base)} />
          </StatGrid>
          <Section title="Settle up" hint="Whoever pays records it as a settlement in their own transactions.">
            {o.settleUp.length === 0 ? (
              <Card>
                <Empty icon="checkmark-done-outline" title="Nobody owes anyone" />
              </Card>
            ) : (
              <Group>
                {o.settleUp.map((s: any, i: number) => (
                  <ListItem key={i} icon="swap-horizontal-outline" tone="amber" title={`${s.from.name} owes ${s.to.name}`} value={money(s.amountBase, base)} />
                ))}
              </Group>
            )}
          </Section>
          <Section title="Members">
            {o.totals.members.map((m: any) => (
              <Card key={m.userId} style={{ gap: 6 }}>
                <View style={styles.between}>
                  <Txt bold>{m.name}</Txt>
                  <Txt mono tone={m.net >= 0 ? undefined : "green"}>
                    {money(m.net, base)}
                  </Txt>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <Pill label={`Paid ${money(m.paid, base)}`} />
                  {m.sharesGiven > 0 && <Pill tone="green" label={`Shared out −${money(m.sharesGiven, base)}`} />}
                  {m.sharesReceived > 0 && <Pill tone="amber" label={`Shares in +${money(m.sharesReceived, base)}`} />}
                  {m.reimbursed > 0 && <Pill tone="blue" label={`Reimbursed −${money(m.reimbursed, base)}`} />}
                </View>
              </Card>
            ))}
            {o.members.some((m: any) => m.status === "invited") && (
              <Txt muted size={12} style={{ paddingHorizontal: 4 }}>
                Invited, not joined yet: {o.members.filter((m: any) => m.status === "invited").map((m: any) => m.name).join(", ")}
              </Txt>
            )}
          </Section>
          <Section title="All entries">
            <Group>
              {o.entries.map((e: any) => (
                <ListItem
                  key={e.id}
                  left={<IconBubble text={e.member.name.slice(0, 1).toUpperCase()} color={e.category?.color || undefined} size={36} />}
                  title={e.title}
                  subtitle={`${fmtDate(e.date, false)} · ${e.member.name}${e.type === "reimbursement" ? " · Reimbursement" : e.category ? ` · ${e.category.name}` : ""}${e.isShare && e.owedTo ? ` · Share, owed to ${e.owedTo}` : !e.isShare && e.owedTo ? ` · Owed to ${e.owedTo}` : ""}${e.shares?.length ? `\nShares: ${e.shares.map((s: any) => `${s.name} ${money(s.baseAmount, base)}`).join(", ")}` : ""}`}
                  value={`${e.type === "reimbursement" ? "+" : ""}${money(e.baseAmount, base)}`}
                  valueTone={e.type === "reimbursement" ? "green" : undefined}
                  detail={e.localCurrency !== base ? money(e.localAmount, e.localCurrency) : undefined}
                />
              ))}
            </Group>
            {o.entries.length === 0 && <Txt muted style={{ color: colors.muted }}>No entries yet.</Txt>}
          </Section>
        </>
      )}
    </Screen>
  );
}
