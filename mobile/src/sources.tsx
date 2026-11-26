import React, { useState } from "react";
import { RefreshControl, Switch, View } from "react-native";
import { useApi, useResource } from "./api";
import { ActionMenu, Button, Card, confirm, Empty, Form, Group, Heading, ListItem, notice, Pill, Screen, Section, Sheet, State, toast, Txt } from "./ui";
import { cardDisplay, type Account } from "../../frontend/shared/accountTypes";
import {
  SOURCE_CHANNELS,
  SOURCE_KINDS,
  joinList,
  sendersLabel,
  sendersPlaceholder,
  sourceKindLabel,
  sourceTarget,
  sourceTitle,
  splitList,
  type SourceSuggestion,
  type TransactionSource,
} from "../../frontend/shared/sourceTypes";

const KIND_ICONS = { notification: "notifications-outline", email: "mail-outline" } as const;

type Editing = { source?: TransactionSource; suggestion?: SourceSuggestion } | null;

/** The form's starting values: the source's, a suggestion's (never enabled), or blank. */
function initialOf(editing: NonNullable<Editing>, accounts: Account[]) {
  const from = editing.source ?? editing.suggestion;
  if (!from)
    return {
      kind: "notification",
      target: accounts[0] ? `account:${accounts[0].id}` : null,
      name: "",
      senders: "",
      subjectPatterns: "",
      textPatterns: "",
      identifiers: "",
      channel: "main",
      enabled: false,
      notes: "",
    };
  return {
    kind: from.kind,
    target: from.cardId ? `card:${from.cardId}` : `account:${from.accountId}`,
    name: from.name || "",
    senders: joinList(from.senders),
    subjectPatterns: joinList(from.subjectPatterns),
    textPatterns: joinList(from.textPatterns),
    identifiers: joinList(from.identifiers),
    channel: from.channel,
    enabled: editing.source ? editing.source.enabled : false,
    notes: from.notes || "",
  };
}

function SourceForm({ editing, accounts, onSaved }: { editing: NonNullable<Editing>; accounts: Account[]; onSaved: () => Promise<any> }) {
  const { call } = useApi();
  const initial = initialOf(editing, accounts);
  const [kind, setKind] = useState<string>(initial.kind);
  const targets = accounts.flatMap((account) => [
    { label: account.name, value: `account:${account.id}`, color: account.color },
    ...account.cards.map((card) => ({ label: `${account.name} · ${cardDisplay(card)}`, value: `card:${card.id}`, color: account.color })),
  ]);
  return (
    <Form
      initial={initial}
      onChange={(value) => setKind(value.kind)}
      fields={[
        { key: "kind", label: "Kind", options: SOURCE_KINDS.map((k) => ({ label: k.label, value: k.value })) },
        { key: "target", label: "Reports", options: targets, required: true, hint: "The account, or one of its cards." },
        { key: "name", label: "Name", placeholder: kind === "email" ? "e.g. UOB alert emails" : "e.g. UOB TMRW app" },
        {
          key: "senders",
          label: sendersLabel(kind as "email" | "notification"),
          required: true,
          placeholder: sendersPlaceholder(kind as "email" | "notification"),
          hint: "Separate several with commas.",
        },
        { key: "subjectPatterns", label: "Subject contains", hidden: kind !== "email", placeholder: "e.g. Transaction Alerts", hint: "Optional." },
        { key: "textPatterns", label: "Text contains", placeholder: "e.g. You made a payment", hint: "Optional." },
        { key: "identifiers", label: "Identifiers", placeholder: "e.g. card ending 1234", hint: "What in a message ties it to this account or card." },
        {
          key: "channel",
          label: "Channel",
          options: SOURCE_CHANNELS.map((c) => ({ label: c.label, value: c.value })),
          hint: "When the main and backup channels report the same purchase, it is saved once.",
        },
        { key: "enabled", label: "Enabled", type: "boolean", hint: "The assistant watches it." },
        { key: "notes", label: "Notes", type: "multiline" },
      ]}
      submit={editing.source ? "Save changes" : "Add source"}
      onSave={async (v) => {
        const [type, id] = String(v.target || "").split(":");
        if (!id) throw new Error("Pick the account or card it reports");
        const senders = splitList(v.senders);
        if (!senders.length) throw new Error(`${sendersLabel(v.kind)} is required`);
        const input = {
          kind: v.kind,
          ...(type === "card" ? { cardId: id } : { accountId: id, cardId: null }),
          name: v.name.trim() || null,
          senders,
          subjectPatterns: v.kind === "email" ? splitList(v.subjectPatterns) : [],
          textPatterns: splitList(v.textPatterns),
          identifiers: splitList(v.identifiers),
          channel: v.channel,
          enabled: !!v.enabled,
          notes: v.notes.trim() || null,
        };
        if (editing.source) await call("updateSource", editing.source.id, input);
        else await call("createSource", input);
        toast("Source saved");
        await onSaved();
      }}
    />
  );
}

export function SourcesScreen() {
  const { call } = useApi();
  const sources = useResource<TransactionSource[]>("getSources");
  const suggestions = useResource<SourceSuggestion[]>("getSourceSuggestions");
  const accounts = useResource<Account[]>("getAccounts", { includeArchived: false });
  const [editing, setEditing] = useState<Editing>(null);
  const all = sources.data || [];
  const reload = async () => {
    await Promise.all([sources.reload(), suggestions.reload()]);
  };
  const run = async (fn: () => Promise<any>, message: string) => {
    try {
      await fn();
      toast(message);
      await reload();
    } catch (e) {
      notice(e);
    }
  };
  const groups = [...new Set(all.map((s) => s.accountId))].map((accountId) => all.filter((s) => s.accountId === accountId));
  return (
    <Screen refreshControl={<RefreshControl refreshing={sources.loading && !!sources.data} onRefresh={reload} />}>
      <Heading
        title="Sources"
        right={<Button title="Add" compact icon="add" disabled={!accounts.data?.length} onPress={() => setEditing({})} />}
      />
      <Txt muted size={13} style={{ paddingHorizontal: 4 }}>
        Bank app notifications and alert emails the assistant watches for each account or card. Only enabled sources are watched.
      </Txt>
      <State {...sources} />
      {!!suggestions.data?.length && (
        <Section title="Suggested">
          <Group>
            {suggestions.data.map((s) => (
              <ListItem
                key={s.key}
                icon={KIND_ICONS[s.kind]}
                title={`${s.name} · ${s.accountName}`}
                subtitle={`${s.senders.join(", ")} · ${s.why}`}
                right={<Button title="Add…" compact secondary onPress={() => setEditing({ suggestion: s })} />}
                chevron={false}
              />
            ))}
          </Group>
        </Section>
      )}
      {sources.data && !all.length && (
        <Card>
          <Empty icon="notifications-outline" title="No sources yet" action="Add source" onAction={() => setEditing({})} />
        </Card>
      )}
      {groups.map((group) => (
        <Section key={group[0].accountId} title={group[0].account.name}>
          <Group>
            {group.map((s) => (
              <ListItem
                key={s.id}
                icon={KIND_ICONS[s.kind]}
                tone={s.enabled ? "purple" : "neutral"}
                title={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Txt bold numberOfLines={1}>
                      {sourceTitle(s)}
                    </Txt>
                    {s.channel === "backup" && <Pill label="Backup" />}
                  </View>
                }
                subtitle={[sourceKindLabel(s.kind), sourceTarget(s), s.senders.join(", ")].join(" · ")}
                onPress={() => setEditing({ source: s })}
                chevron={false}
                right={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Switch
                      accessibilityLabel={`${sourceTitle(s)} enabled`}
                      value={s.enabled}
                      onValueChange={(enabled) => void run(() => call("updateSource", s.id, { enabled }), enabled ? "Source on" : "Source off")}
                    />
                    <ActionMenu
                      title={sourceTitle(s)}
                      actions={[
                        { label: "Edit", icon: "create-outline", onPress: () => setEditing({ source: s }) },
                        {
                          label: "Delete",
                          icon: "trash-outline",
                          danger: true,
                          onPress: () =>
                            confirm("Delete this source?", "The assistant stops watching it; transactions it reported stay.", async () => {
                              await call("deleteSource", s.id);
                              toast("Source deleted");
                              await reload();
                            }, "Delete"),
                        },
                      ]}
                    />
                  </View>
                }
              />
            ))}
          </Group>
        </Section>
      ))}
      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.source ? "Edit source" : "New source"}
        subtitle={editing?.suggestion?.why}
      >
        {!!editing && (
          <SourceForm
            key={editing.source?.id ?? editing.suggestion?.key ?? "new"}
            editing={editing}
            accounts={accounts.data || []}
            onSaved={async () => {
              setEditing(null);
              await reload();
            }}
          />
        )}
      </Sheet>
    </Screen>
  );
}
