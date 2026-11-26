import React, { useState } from "react";
import { Platform, RefreshControl, View } from "react-native";
import { useApi, useResource } from "./api";
import {
  ActionMenu,
  Banner,
  Button,
  Card,
  confirm,
  Empty,
  Form,
  Group,
  Heading,
  IconBubble,
  IconButton,
  Input,
  ListItem,
  notice,
  Pill,
  plural,
  Screen,
  Section,
  Sheet,
  State,
  styles,
  toast,
  Txt,
} from "./ui";
import { pickImage, RemoteImage } from "./images";
import {
  ACCOUNT_TYPES,
  autoCreatedFromDisplay,
  CARD_NETWORKS,
  cardDisplay,
  type Account,
  type AccountCard,
} from "../../frontend/shared/accountTypes";

const TYPE_ICONS: Record<string, string> = {
  savings: "wallet-outline",
  current: "business-outline",
  credit_card: "card-outline",
  other: "ellipsis-horizontal-circle-outline",
};
const typeLabel = (type: string) => ACCOUNT_TYPES.find((t) => t.value === type)?.label || "Other";
const checkColor = (color: string) => {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error("Use a six-digit hex color, such as #5750F1");
};

function AccountThumb({ account, size = 36 }: { account: Account; size?: number }) {
  return (
    <RemoteImage
      path={account.imageUrl}
      size={size}
      fallback={<IconBubble icon={TYPE_ICONS[account.type] || TYPE_ICONS.other} color={account.color} size={size} />}
    />
  );
}

const useAccounts = () => useResource<Account[]>("getAccounts", { includeArchived: true });

/** Pick an account to merge `source` into; its cards, identifiers and transactions move there. */
function MergeSheet({
  source,
  accounts,
  onClose,
  onMerged,
}: {
  source: Account | null;
  accounts: Account[];
  onClose: () => void;
  onMerged: () => Promise<any> | void;
}) {
  const { call } = useApi();
  const targets = accounts.filter((a) => a.id !== source?.id && !a.archived);
  return (
    <Sheet visible={!!source} onClose={onClose} title={source ? `Merge ${source.name} into` : undefined}>
      {targets.length ? (
        <Group>
          {targets.map((a) => (
            <ListItem
              key={a.id}
              left={<AccountThumb account={a} size={32} />}
              title={a.name}
              subtitle={[a.institution, typeLabel(a.type)].filter(Boolean).join(" · ")}
              onPress={() => {
                if (!source) return;
                onClose();
                // Let the sheet close before the alert (iOS drops alerts over a closing modal).
                setTimeout(() => confirm(
                  `Merge into ${a.name}?`,
                  `${source.name}'s cards, statement identifiers and transactions move to ${a.name}, and ${source.name} is deleted.`,
                  async () => {
                    await call("mergeAccount", source.id, a.id);
                    toast(`Merged into ${a.name}`);
                    await onMerged();
                  },
                  "Merge",
                ), Platform.OS === "ios" ? 350 : 0);
              }}
            />
          ))}
        </Group>
      ) : (
        <Txt muted>No other accounts.</Txt>
      )}
    </Sheet>
  );
}

function AccountForm({ account, onSaved }: { account?: Account; onSaved: (saved: Account) => Promise<any> | void }) {
  const { call } = useApi();
  return (
    <Form
      initial={{
        name: account?.name || "",
        institution: account?.institution || "",
        type: account?.type || "savings",
        color: account?.color || "#5750F1",
        ...(account ? {} : { identifier: "" }),
      }}
      fields={[
        { key: "name", label: "Name", required: true, placeholder: "e.g. UOB One" },
        { key: "institution", label: "Bank or provider", placeholder: "e.g. UOB" },
        { key: "type", label: "Type", options: ACCOUNT_TYPES.map((t) => ({ label: t.label, value: t.value })) },
        { key: "color", label: "Color", type: "color", required: true },
        { key: "identifier", label: "Statement identifier", hidden: !!account, hint: "The account number as statements show it. Optional." },
      ]}
      onSave={async (v) => {
        checkColor(v.color);
        const input = { name: v.name.trim(), institution: v.institution.trim() || null, type: v.type, color: v.color };
        const saved = account
          ? await call<Account>("updateAccount", account.id, input)
          : await call<Account>("createAccount", { ...input, ...(v.identifier?.trim() ? { identifiers: [v.identifier.trim()] } : {}) });
        toast("Account saved");
        await onSaved(saved);
      }}
    />
  );
}

export function AccountsScreen({ navigation }: any) {
  const { call } = useApi();
  const result = useAccounts();
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState<Account | null>(null);
  const all = result.data || [];
  const review = all.filter((a) => a.autoCreated && !a.archived);
  const active = all.filter((a) => !a.autoCreated && !a.archived);
  const archived = all.filter((a) => a.archived);
  const row = (a: Account) => (
    <ListItem
      key={a.id}
      left={<AccountThumb account={a} />}
      title={a.name}
      subtitle={[a.institution, typeLabel(a.type), a.cards.length ? plural(a.cards.length, "card") : null].filter(Boolean).join(" · ")}
      onPress={() => navigation.navigate("Account", { id: a.id })}
    />
  );
  return (
    <Screen refreshControl={<RefreshControl refreshing={result.loading && !!result.data} onRefresh={result.reload} />}>
      <Heading title="Accounts" right={<Button title="Add" compact icon="add" onPress={() => setCreating(true)} />} />
      <State {...result} />
      {review.length > 0 && (
        <Section title="To review">
          {review.map((a) => (
            <Card key={a.id} style={{ gap: 10 }}>
              <View style={styles.row}>
                <AccountThumb account={a} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt bold numberOfLines={1}>
                    {a.name}
                  </Txt>
                  <Txt muted size={12}>
                    {autoCreatedFromDisplay(a.autoCreatedFrom)}
                    {a.transactionCount ? ` · ${plural(a.transactionCount, "transaction")}` : ""}
                  </Txt>
                </View>
              </View>
              <View style={styles.row}>
                <Button
                  title="Keep"
                  compact
                  secondary
                  icon="checkmark"
                  style={{ flex: 1 }}
                  onPress={() =>
                    void call("confirmAccount", a.id)
                      .then(() => {
                        toast("Account kept");
                        return result.reload();
                      })
                      .catch(notice)
                  }
                />
                <Button title="Merge into…" compact secondary icon="git-merge-outline" style={{ flex: 1 }} onPress={() => setMerging(a)} />
                <IconButton icon="create-outline" label={`Edit ${a.name}`} onPress={() => navigation.navigate("Account", { id: a.id })} />
              </View>
            </Card>
          ))}
        </Section>
      )}
      {result.data && !active.length && !review.length && (
        <Card>
          <Empty icon="card-outline" title="No accounts yet" action="Add account" onAction={() => setCreating(true)} />
        </Card>
      )}
      {active.length > 0 && <Group>{active.map(row)}</Group>}
      {archived.length > 0 && (
        <Section title="Archived">
          <Group>{archived.map(row)}</Group>
        </Section>
      )}
      <Sheet visible={creating} onClose={() => setCreating(false)} title="New account">
        <AccountForm
          onSaved={async () => {
            setCreating(false);
            await result.reload();
          }}
        />
      </Sheet>
      <MergeSheet source={merging} accounts={all} onClose={() => setMerging(null)} onMerged={result.reload} />
    </Screen>
  );
}

export function AccountScreen({ route, navigation }: any) {
  const { call } = useApi();
  const result = useAccounts();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState<Account | null>(null);
  const [card, setCard] = useState<AccountCard | "new" | null>(null);
  const [addingIdentifier, setAddingIdentifier] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const all = result.data || [];
  const account = all.find((a) => a.id === route.params.id);
  if (!account)
    return (
      <Screen>
        <State {...result} empty={result.data ? "This account no longer exists" : undefined} />
      </Screen>
    );
  const run = async (fn: () => Promise<any>, message: string) => {
    try {
      await fn();
      toast(message);
      await result.reload();
    } catch (e) {
      notice(e);
    }
  };
  const chooseImage = (target: "account" | AccountCard) =>
    void pickImage({ square: true })
      .then((base64) =>
        base64
          ? run(
              () => (target === "account" ? call("setAccountImage", account.id, base64) : call("setCardImage", target.id, base64)),
              "Image saved",
            )
          : undefined,
      )
      .catch(notice);
  return (
    <Screen refreshControl={<RefreshControl refreshing={result.loading && !!result.data} onRefresh={result.reload} />}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <AccountThumb account={account} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt bold size={18}>
            {account.name}
          </Txt>
          <Txt muted size={13}>
            {[account.institution, typeLabel(account.type), plural(account.transactionCount, "transaction")].filter(Boolean).join(" · ")}
          </Txt>
        </View>
        {account.archived && <Pill label="Archived" />}
        <ActionMenu
          title={account.name}
          actions={[
            { label: "Edit", icon: "create-outline", onPress: () => setEditing(true) },
            { label: account.imageId ? "Replace image" : "Add image", icon: "image-outline", onPress: () => chooseImage("account") },
            !!account.imageId && {
              label: "Remove image",
              icon: "close-circle-outline",
              onPress: () => void run(() => call("setAccountImage", account.id, null), "Image removed"),
            },
            {
              label: account.archived ? "Unarchive" : "Archive",
              icon: account.archived ? "arrow-undo-outline" : "archive-outline",
              hint: account.archived ? undefined : "Hidden from pickers; its transactions stay",
              onPress: () => void run(() => call("updateAccount", account.id, { archived: !account.archived }), account.archived ? "Account unarchived" : "Account archived"),
            },
            { label: "Merge into…", icon: "git-merge-outline", onPress: () => setMerging(account) },
            {
              label: "Delete",
              icon: "trash-outline",
              danger: true,
              onPress: () =>
                confirm("Delete this account?", "Accounts with transactions can’t be deleted; merge or archive them instead.", async () => {
                  await call("deleteAccount", account.id);
                  toast("Account deleted");
                  navigation.goBack();
                }, "Delete"),
            },
          ]}
        />
      </Card>
      {account.autoCreated && (
        <Banner
          tone="amber"
          icon="help-circle-outline"
          title="Needs review"
          message={autoCreatedFromDisplay(account.autoCreatedFrom)}
          action="Keep this account"
          onAction={() => void run(() => call("confirmAccount", account.id), "Account kept")}
        />
      )}
      <Section title="Cards" action="Add" onAction={() => setCard("new")}>
        {account.cards.length ? (
          <Group>
            {account.cards.map((c) => (
              <ListItem
                key={c.id}
                left={<RemoteImage path={c.imageUrl} size={32} fallback={<IconBubble icon="card-outline" color={account.color} size={32} />} />}
                title={cardDisplay(c)}
                subtitle={c.nickname ? CARD_NETWORKS.find((n) => n.value === c.network)?.label : undefined}
                chevron={false}
                onPress={() => setCard(c)}
                right={
                  <ActionMenu
                    title={cardDisplay(c)}
                    actions={[
                      { label: "Edit", icon: "create-outline", onPress: () => setCard(c) },
                      { label: c.imageId ? "Replace image" : "Add image", icon: "image-outline", onPress: () => chooseImage(c) },
                      !!c.imageId && {
                        label: "Remove image",
                        icon: "close-circle-outline",
                        hint: "Shows the account’s image instead",
                        onPress: () => void run(() => call("setCardImage", c.id, null), "Image removed"),
                      },
                      {
                        label: "Delete card",
                        icon: "trash-outline",
                        danger: true,
                        onPress: () =>
                          confirm("Delete this card?", "Its transactions stay on the account.", async () => {
                            await call("deleteCard", c.id);
                            toast("Card deleted");
                            await result.reload();
                          }, "Delete"),
                      },
                    ]}
                  />
                }
              />
            ))}
          </Group>
        ) : (
          <Txt muted size={13} style={{ paddingHorizontal: 4 }}>
            No cards.
          </Txt>
        )}
      </Section>
      <Section
        title="Statement identifiers"
        action="Add"
        onAction={() => setAddingIdentifier(true)}
        hint="Statements with these account numbers import into this account."
      >
        {account.identifiers.length ? (
          <Group>
            {account.identifiers.map((i) => (
              <ListItem
                key={i.id}
                icon="document-text-outline"
                title={i.identifier}
                right={
                  <IconButton
                    icon="close"
                    label={`Remove ${i.identifier}`}
                    size={32}
                    filled={false}
                    onPress={() =>
                      confirm("Remove this identifier?", "Statements with it will no longer import into this account.", async () => {
                        await call("removeAccountIdentifier", i.id);
                        toast("Identifier removed");
                        await result.reload();
                      }, "Remove")
                    }
                  />
                }
              />
            ))}
          </Group>
        ) : (
          <Txt muted size={13} style={{ paddingHorizontal: 4 }}>
            No identifiers.
          </Txt>
        )}
      </Section>
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit account">
        <AccountForm
          key={`${account.id}:${account.name}:${account.color}`}
          account={account}
          onSaved={async () => {
            setEditing(false);
            await result.reload();
          }}
        />
      </Sheet>
      <Sheet visible={!!card} onClose={() => setCard(null)} title={card === "new" ? "New card" : "Edit card"}>
        {!!card && (
          <Form
            key={card === "new" ? "new" : card.id}
            initial={{
              last4: card === "new" ? "" : card.last4,
              network: card === "new" ? null : card.network,
              nickname: card === "new" ? "" : card.nickname || "",
            }}
            fields={[
              { key: "last4", label: "Last 4 digits", type: "number", required: true },
              { key: "network", label: "Network", options: [{ label: "None", value: null }, ...CARD_NETWORKS.map((n) => ({ label: n.label, value: n.value }))] },
              { key: "nickname", label: "Nickname", placeholder: "e.g. Travel card" },
            ]}
            onSave={async (v) => {
              const last4 = String(v.last4 ?? "").trim().padStart(4, "0");
              if (!/^\d{4}$/.test(last4)) throw new Error("Enter the last 4 digits");
              const input = { last4, network: v.network || null, nickname: v.nickname.trim() || null };
              if (card === "new") await call("addCard", account.id, input);
              else await call("updateCard", card.id, input);
              setCard(null);
              toast("Card saved");
              await result.reload();
            }}
          />
        )}
      </Sheet>
      <Sheet
        visible={addingIdentifier}
        onClose={() => setAddingIdentifier(false)}
        title="Add statement identifier"
        footer={
          <Button
            title="Add identifier"
            loading={busy}
            disabled={busy || !identifier.trim()}
            onPress={async () => {
              setBusy(true);
              try {
                await call("addAccountIdentifier", account.id, identifier.trim());
                setAddingIdentifier(false);
                setIdentifier("");
                toast("Identifier added");
                await result.reload();
              } catch (e) {
                notice(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        }
      >
        <Input
          label="Identifier"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          placeholder="e.g. 123-45678-9"
          hint="If another account has it, it moves here with its transactions."
        />
      </Sheet>
      <MergeSheet
        source={merging}
        accounts={all}
        onClose={() => setMerging(null)}
        onMerged={() => navigation.goBack()}
      />
    </Screen>
  );
}
