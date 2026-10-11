import React, { useEffect, useState } from "react";
import { Platform, RefreshControl, Switch, View } from "react-native";
import Constants from "expo-constants";
import { useApi, useResource } from "./api";
import {
  ActionMenu,
  Banner,
  Button,
  Card,
  Chips,
  confirm,
  Empty,
  Field,
  fmtDate,
  Form,
  Group,
  Heading,
  humanize,
  IconBubble,
  Input,
  ListItem,
  MultiSelect,
  notice,
  Pill,
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
  useTheme,
} from "./ui";
import { accountDisplay } from "../../frontend/shared/accounts";

const SCOPES = [
  "statements:write",
  "drafts:read",
  "drafts:write",
  "classification:write",
  "trips:read",
  "trips:write",
  "rules:read",
  "rules:write",
  "imports:commit",
  "parser:develop",
  "parser:approve",
  "accounts:read",
  "accounts:write",
];
const DEFAULT_SCOPES = [
  "statements:write",
  "drafts:read",
  "drafts:write",
  "classification:write",
  "trips:read",
  "rules:read",
  "accounts:read",
  "accounts:write",
];
const TRIP_CATEGORY_NAMES = ["Flights", "Accommodation", "Attractions", "Fees"];
export function SettingsScreen({ navigation }: any) {
  const { signOut, session } = useApi();
  const { mode, setMode } = useTheme();
  const user = useResource("getCurrentUser");
  const patterns = useResource("getClassificationPatterns");
  const u = user.data;
  return (
    <Screen>
      <Card onPress={() => navigation.navigate("Profile")} accessibilityLabel="Edit profile" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <IconBubble text={(u?.name || "?").slice(0, 1).toUpperCase()} size={56} />
        <View style={{ flex: 1 }}>
          <Txt bold size={19}>
            {u?.name || "Your profile"}
          </Txt>
          <Txt muted size={13}>
            @{u?.username} · {u?.baseCurrency}
          </Txt>
        </View>
        <Pill label="Edit" tone="purple" />
      </Card>
      <Section title="Appearance">
        <Segmented values={["system", "light", "dark"]} labels={{ system: "System", light: "Light", dark: "Dark" }} value={mode} onChange={setMode} />
      </Section>
      <Section title="Organize">
        <Group>
          <ListItem icon="pricetags-outline" title="Categories" subtitle="Names and colors" onPress={() => navigation.navigate("Manage", { kind: "categories" })} />
          <ListItem icon="card-outline" title="Accounts" subtitle="Friendly names for account numbers" onPress={() => navigation.navigate("Manage", { kind: "accounts" })} />
          <ListItem icon="git-branch-outline" title="Import rules" subtitle="Label and categorize rows as they import" onPress={() => navigation.navigate("Manage", { kind: "rules" })} />
          <ListItem
            icon="bulb-outline"
            title="Learned rules"
            subtitle={patterns.data ? `${patterns.data.length} learned · ${patterns.data.filter((p: any) => p.status === "auto_apply").length} auto-apply` : "Patterns learned from your labels"}
            onPress={() => navigation.navigate("Patterns")}
          />
        </Group>
      </Section>
      <Section title="Preferences">
        <Group>
          <ListItem icon="sparkles-outline" title="Auto-labeling & analytics" subtitle={u ? (u.autoLabelEnabled ? `Auto-apply at ${Math.round(u.autoLabelThreshold * 100)}% confidence` : "Suggestions only") : undefined} onPress={() => navigation.navigate("Preferences")} />
          <ListItem icon="chatbubbles-outline" title="AI connection" subtitle="Assistant provider and memory" onPress={() => navigation.navigate("AIConnection")} />
        </Group>
      </Section>
      <Section title="Security">
        <Group>
          <ListItem icon="key-outline" title="Change password" onPress={() => navigation.navigate("Password")} />
          <ListItem icon="phone-portrait-outline" title="API tokens & sessions" subtitle="Integrations and signed-in devices" onPress={() => navigation.navigate("Tokens")} />
        </Group>
      </Section>
      <Button
        title="Sign out"
        danger
        secondary
        icon="log-out-outline"
        onPress={() => confirm("Sign out?", "Revoke this device’s session and remove its saved credentials.", signOut, "Sign out")}
      />
      <Txt muted size={12} style={{ textAlign: "center" }}>
        {session?.server}
        {"\n"}Fortuna {Constants.expoConfig?.version || ""}
      </Txt>
    </Screen>
  );
}
export function ProfileScreen({ navigation }: any) {
  const { call } = useApi();
  const user = useResource("getCurrentUser");
  return (
    <Screen>
      <Heading title="Your profile" />
      <State {...user} />
      {user.data && (
        <Card>
          <Form
            initial={{ name: user.data.name, username: user.data.username, email: user.data.email || "" }}
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "username", label: "Username", required: true },
              { key: "email", label: "Email" },
            ]}
            onSave={async (v) => {
              await call("updateUserProfile", { ...v, email: v.email || null });
              toast("Profile saved");
              navigation.goBack();
            }}
          />
          <Txt muted size={12}>
            Base currency: {user.data.baseCurrency}
          </Txt>
        </Card>
      )}
    </Screen>
  );
}
export function PasswordScreen({ navigation }: any) {
  const { call } = useApi();
  return (
    <Screen>
      <Heading title="Change password" subtitle="Use at least 8 characters." />
      <Card>
        <Form
          submit="Change password"
          fields={[
            { key: "current", label: "Current password", type: "password", required: true },
            { key: "next", label: "New password", type: "password", required: true },
            { key: "confirm", label: "Confirm new password", type: "password", required: true },
          ]}
          onSave={async (v) => {
            if (v.next.length < 8) throw new Error("Use at least 8 characters");
            if (v.next !== v.confirm) throw new Error("New passwords do not match");
            await call("changePassword", v.current, v.next);
            toast("Password changed");
            navigation.goBack();
          }}
        />
      </Card>
    </Screen>
  );
}
export function PreferencesScreen() {
  const { call } = useApi();
  const user = useResource("getCurrentUser");
  const cats = useResource("getCategories", { scope: "settings" });
  const paylah = useResource("getPaylahInternalPreferenceState");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [threshold, setThreshold] = useState("");
  const [excluded, setExcluded] = useState<string[] | null>(null);
  useEffect(() => {
    if (user.data && enabled === null) {
      setEnabled(user.data.autoLabelEnabled);
      setThreshold(String(user.data.autoLabelThreshold));
    }
  }, [user.data, enabled]);
  const values = excluded ?? user.data?.analyticsExcludedCategoryIds ?? [];
  return (
    <Screen>
      <Heading title="Preferences" />
      <State {...user} />
      {user.data && (
        <>
          <Section title="Auto-labeling" hint="Fortuna suggests labels and categories from patterns it has learned. Auto-apply fills them in when it's confident enough.">
            <Card>
              <View style={styles.between}>
                <Txt style={{ flex: 1 }}>Automatically apply suggestions</Txt>
                <Switch accessibilityLabel="Automatically apply suggestions" value={!!enabled} onValueChange={setEnabled} />
              </View>
              <Input label="Minimum confidence (0 to 1)" value={threshold} keyboardType="decimal-pad" onChangeText={setThreshold} />
              <Chips values={["0.5", "0.7", "0.8", "0.9"]} value={threshold} onChange={setThreshold} />
              <Button
                title="Save auto-labeling"
                compact
                onPress={() => {
                  const n = Number(threshold);
                  if (!(n >= 0 && n <= 1)) return notice(new Error("Confidence must be between 0 and 1"));
                  void call("updateAutoLabelSettings", !!enabled, n)
                    .then(() => toast("Auto-labeling saved"))
                    .catch(notice);
                }}
              />
            </Card>
          </Section>
          <Section title="Leave out of analytics" hint="Spending in these categories is ignored by reports and insights.">
            <MultiSelect
              options={(cats.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color }))}
              value={values}
              onChange={setExcluded}
            />
            <Button
              title="Save exclusions"
              compact
              disabled={excluded === null}
              onPress={() =>
                void call("updateAnalyticsExcludedCategories", values)
                  .then(() => {
                    toast("Analytics exclusions saved");
                    setExcluded(null);
                    return user.reload();
                  })
                  .catch(notice)
              }
            />
          </Section>
        </>
      )}
      {paylah.data && (
        <Section title="PayLah">
          <Card>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Txt>Treat PayLah transfers as internal</Txt>
                <Txt muted size={12}>
                  Turning this on also updates earlier DBS statements.
                </Txt>
              </View>
              <Switch
                accessibilityLabel="Treat PayLah transfers as internal"
                value={!!paylah.data.enabled}
                onValueChange={(v) =>
                  void call("setPaylahInternalPreference", v)
                    .then((r: any) => {
                      toast(v && r?.updatedCount ? `Marked ${r.updatedCount} earlier rows internal` : "PayLah preference saved");
                      return paylah.reload();
                    })
                    .catch(notice)
                }
              />
            </View>
          </Card>
        </Section>
      )}
    </Screen>
  );
}
const configs: Record<string, { title: string; get: string; noun: string; subtitle: string }> = {
  categories: { title: "Categories", get: "getCategories", noun: "category", subtitle: "Trip category names are fixed; you can change their color." },
  accounts: { title: "Accounts", get: "getAccountNumbers", noun: "account", subtitle: "Give account numbers a name you'll recognize." },
  rules: { title: "Import rules", get: "getImportRules", noun: "rule", subtitle: "Applied in priority order to rows as statements import." },
};
export function ManageScreen({ route, navigation }: any) {
  const { kind } = route.params;
  const config = configs[kind];
  const { call } = useApi();
  const result = useResource(config.get, ...(kind === "categories" ? [{ scope: "settings" }] : []));
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => {
    if (kind !== "rules" || bootstrapped) return;
    setBootstrapped(true);
    void call("bootstrapDefaultImportRules")
      .then(() => result.reload())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const rows = [...(result.data || [])].sort((a: any, b: any) =>
    kind === "rules" ? Number(a.sortOrder) - Number(b.sortOrder) : 0,
  );
  return (
    <Screen refreshControl={<RefreshControl refreshing={result.loading && !!result.data} onRefresh={result.reload} />}>
      <Heading
        title={config.title}
        subtitle={config.subtitle}
        right={<Button title="Add" compact icon="add" onPress={() => navigation.navigate("ManageEditor", { kind })} />}
      />
      <State {...result} />
      {result.data?.length === 0 && (
        <Card>
          <Empty title={`No ${config.title.toLowerCase()} yet`} action={`Add ${config.noun}`} onAction={() => navigation.navigate("ManageEditor", { kind })} />
        </Card>
      )}
      <Group>
        {rows.map((item: any) =>
          kind === "categories" ? (
            <ListItem
              key={item.id}
              icon="pricetag-outline"
              color={item.color}
              title={item.name}
              right={TRIP_CATEGORY_NAMES.includes(item.name) ? <Pill label="Trip" tone="blue" /> : undefined}
              onPress={() => navigation.navigate("ManageEditor", { kind, item })}
            />
          ) : kind === "accounts" ? (
            <ListItem
              key={item.id}
              icon="card-outline"
              color={item.color}
              title={item.label || item.accountIdentifier}
              subtitle={item.label ? item.accountIdentifier : undefined}
              onPress={() => navigation.navigate("ManageEditor", { kind, item })}
            />
          ) : (
            <ListItem
              key={item.id}
              icon={item.markInternal ? "swap-horizontal-outline" : "git-branch-outline"}
              tone={item.enabled ? "purple" : "neutral"}
              title={item.name}
              subtitle={`${item.matchType === "always" ? "Always" : `“${item.matchValue}”`} → ${[
                item.setLabel && `label ${item.setLabel}`,
                item.setCategoryName,
                item.markInternal && "internal",
              ]
                .filter(Boolean)
                .join(", ") || "no change"}${item.parserId ? ` · ${item.parserId}` : ""}`}
              right={!item.enabled ? <Pill label="Off" /> : undefined}
              onPress={() => navigation.navigate("ManageEditor", { kind, item })}
            />
          ),
        )}
      </Group>
    </Screen>
  );
}
export function ManageEditorScreen({ route, navigation }: any) {
  const { kind, item } = route.params;
  const { call } = useApi();
  const cats = useResource("getCategories", { scope: "settings" });
  const parsers = useResource(kind === "rules" ? "getAvailableParsers" : "", "bank");
  const accounts = useResource(kind === "rules" ? "getAccountNumbers" : "");
  const parserRows = Array.isArray(parsers.data) ? parsers.data : parsers.data?.parsers || [];
  const tripCategory = kind === "categories" && item && TRIP_CATEGORY_NAMES.includes(item.name);
  const fieldMap: Record<string, Field[]> = {
    categories: [
      { key: "name", label: "Name", required: true, hidden: tripCategory },
      { key: "color", label: "Color", type: "color", required: true },
    ],
    accounts: [
      { key: "label", label: "Friendly name", placeholder: "e.g. UOB One credit card" },
      { key: "accountIdentifier", label: "Account identifier", required: true },
      { key: "color", label: "Color", type: "color", required: true },
    ],
    rules: [
      { key: "name", label: "Rule name", required: true },
      {
        key: "parserId",
        label: "Parser",
        options: [{ label: "All parsers", value: null }, ...parserRows.map((p: any) => ({ label: p.name || p.id, value: p.id }))],
      },
      {
        key: "accountIdentifier",
        label: "Account",
        options: [{ label: "All accounts", value: null }, ...(accounts.data || []).map((a: any) => ({ label: accountDisplay(a), value: a.accountIdentifier }))],
      },
      {
        key: "matchType",
        label: "When to apply",
        options: [
          { label: "Description contains", value: "description_contains" },
          { label: "Always", value: "always" },
        ],
      },
      { key: "matchValue", label: "Description text" },
      { key: "caseSensitive", label: "Case sensitive", type: "boolean" },
      { key: "setLabel", label: "Set label" },
      {
        key: "setCategoryName",
        label: "Set category",
        options: [{ label: "Keep category", value: null }, ...(cats.data || []).map((c: any) => ({ label: c.name, value: c.name, color: c.color }))],
      },
      { key: "markInternal", label: "Mark as internal transfer", type: "boolean" },
      { key: "enabled", label: "Enabled", type: "boolean" },
      { key: "sortOrder", label: "Priority (lower runs first)", type: "number" },
    ],
    patterns: [
      {
        key: "status",
        label: "Status",
        options: [
          { label: "Auto-apply", value: "auto_apply" },
          { label: "Disabled", value: "disabled" },
          { label: "Unresolved", value: "unresolved" },
        ],
      },
      { key: "label", label: "Label" },
      {
        key: "categoryId",
        label: "Category",
        options: [{ label: "No category", value: null }, ...(cats.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color }))],
      },
      { key: "markInternal", label: "Mark as internal transfer", type: "boolean" },
    ],
  };
  const fields = fieldMap[kind];
  const defaults: any = { color: "#5750F1", enabled: true, matchType: "description_contains", caseSensitive: false, markInternal: false, sortOrder: 0 };
  const initial = Object.fromEntries(fields.map((f) => [f.key, item?.[f.key] ?? defaults[f.key] ?? ""]));
  const noun = kind === "categories" ? "category" : kind === "accounts" ? "account" : kind === "rules" ? "rule" : "learned rule";
  return (
    <Screen>
      <Heading title={`${item ? "Edit" : "New"} ${noun}`} subtitle={kind === "patterns" ? `“${item.patternValue}”` : tripCategory ? `${item.name} is a trip category; only its color can change.` : undefined} />
      <Card>
        <Form
          initial={initial}
          fields={fields}
          onSave={async (v) => {
            if (v.color && !/^#[\da-f]{6}$/i.test(v.color)) throw new Error("Use a six-digit hex color, such as #5750F1");
            if (kind === "rules" && v.matchType === "description_contains" && !String(v.matchValue || "").trim())
              throw new Error("Enter the description text to match");
            if (kind === "categories")
              await call(item ? "updateCategory" : "createCategory", ...(item ? [item.id, tripCategory ? item.name : v.name, v.color] : [v.name, v.color]));
            else if (kind === "accounts")
              await call(
                item ? "updateAccountIdentifier" : "upsertAccountNumber",
                ...(item ? [item.id, v.accountIdentifier, v.color, v.label || null] : [v.accountIdentifier, v.color, v.label || null]),
              );
            else if (kind === "rules")
              await call(item ? "updateImportRule" : "createImportRule", ...(item ? [item.id, v] : [v]));
            else await call("updateClassificationPattern", item.id, v);
            toast(`${noun[0].toUpperCase()}${noun.slice(1)} saved`);
            navigation.goBack();
          }}
        />
      </Card>
      {item && kind !== "patterns" && !tripCategory && (
        <Button
          title={`Delete ${noun}`}
          danger
          secondary
          icon="trash-outline"
          onPress={() =>
            confirm(`Delete this ${noun}?`, "Existing records and system-defined items may prevent deletion.", async () => {
              await call(kind === "categories" ? "deleteCategory" : kind === "accounts" ? "deleteAccountIdentifier" : "deleteImportRule", item.id);
              toast(`${noun[0].toUpperCase()}${noun.slice(1)} deleted`);
              navigation.goBack();
            }, "Delete")
          }
        />
      )}
    </Screen>
  );
}
const STATUS_TONE: Record<string, any> = { auto_apply: "green", disabled: "neutral", unresolved: "amber" };
export function PatternsScreen({ navigation }: any) {
  const { call } = useApi();
  const patterns = useResource("getClassificationPatterns");
  const applied = useResource("getAppliedClassificationSummary");
  const cats = useResource("getCategories", { scope: "settings" });
  const [filter, setFilter] = useState("All");
  const all: any[] = patterns.data || [];
  const groups: Record<string, any[]> = {
    All: all,
    "Auto-apply": all.filter((p) => p.status === "auto_apply"),
    Disabled: all.filter((p) => p.status === "disabled"),
    Unresolved: all.filter((p) => p.status === "unresolved"),
    Ambiguous: all.filter((p) => p.status !== "unresolved" && p.conflictCount > 0),
  };
  const catName = (id: string) => (cats.data || []).find((c: any) => c.id === id)?.name;
  const setStatus = (p: any, status: string) =>
    void call("updateClassificationPattern", p.id, { status })
      .then(() => {
        toast(status === "auto_apply" ? "Auto-apply on" : "Rule disabled");
        return patterns.reload();
      })
      .catch(notice);
  return (
    <Screen refreshControl={<RefreshControl refreshing={patterns.loading && !!patterns.data} onRefresh={patterns.reload} />}>
      <Heading
        title="Learned rules"
        subtitle="Patterns Fortuna learned from the labels and categories you've used."
        right={
          <ActionMenu
            actions={[
              {
                label: "Rebuild from my transactions",
                icon: "refresh",
                onPress: () =>
                  confirm("Rebuild learned rules?", "Learn classification patterns again from your existing transactions.", async () => {
                    const r = await call("rebuildClassificationPatterns");
                    toast(`Rebuilt ${r?.rebuiltCount ?? ""} rules`.replace("  ", " "));
                    await patterns.reload();
                  }),
              },
            ]}
          />
        }
      />
      <StatGrid>
        <Stat icon="bulb-outline" label="Learned" value={String(all.length)} />
        <Stat icon="flash-outline" tone="green" label="Auto-apply" value={String(groups["Auto-apply"].length)} />
        <Stat icon="pause-outline" tone="neutral" label="Disabled" value={String(groups.Disabled.length)} />
        <Stat icon="help-outline" tone="amber" label="Unresolved" value={String(groups.Unresolved.length)} />
      </StatGrid>
      <Chips values={Object.keys(groups)} value={filter} onChange={setFilter} counts={Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))} />
      <State {...patterns} />
      {patterns.data && groups[filter].length === 0 && (
        <Card>
          <Empty icon="bulb-outline" title="Nothing here" message="Label a few transactions, then rebuild to learn rules." />
        </Card>
      )}
      {groups[filter].map((p: any) => {
        const outcome = [p.label, catName(p.categoryId) || p.category?.name, p.markInternal && "Internal"].filter(Boolean).join(" · ");
        return (
          <Card key={p.id} style={{ gap: 8 }}>
            <View style={styles.between}>
              <Txt bold numberOfLines={1} style={{ flex: 1 }}>
                {p.patternValue}
              </Txt>
              <Pill label={humanize(p.status)} tone={STATUS_TONE[p.status]} />
            </View>
            <Txt muted size={12}>
              {humanize(p.patternType)} · {p.parserId || "any parser"} · {p.direction === "in" ? "money in" : p.direction === "out" ? "money out" : "either"}
            </Txt>
            <Txt size={14}>→ {outcome || "No outcome yet"}</Txt>
            <Txt muted size={12}>
              {Math.round(Number(p.confidence) * 100)}% confident · {p.supportCount} seen{p.conflictCount ? ` · ${p.conflictCount} conflicts` : ""} · {p.appliedCount} applied
            </Txt>
            <View style={styles.row}>
              {p.status !== "auto_apply" && <Button title="Auto-apply" compact secondary icon="flash-outline" style={{ flex: 1 }} onPress={() => setStatus(p, "auto_apply")} />}
              {p.status !== "disabled" && <Button title="Disable" compact secondary icon="pause-outline" style={{ flex: 1 }} onPress={() => setStatus(p, "disabled")} />}
              <Button title="Edit" compact ghost icon="create-outline" style={{ flex: 1 }} onPress={() => navigation.navigate("ManageEditor", { kind: "patterns", item: p })} />
            </View>
          </Card>
        );
      })}
      {applied.data?.length > 0 && (
        <Section title="Recently applied">
          <Group>
            {applied.data.map((a: any) => (
              <ListItem key={a.id} icon="checkmark-done-outline" tone="green" title={a.name} subtitle={a.exampleDescription} value={`${a.appliedCount}×`} />
            ))}
          </Group>
        </Section>
      )}
    </Screen>
  );
}
export function TokensScreen() {
  const { call } = useApi();
  const result = useResource("getApiTokens");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState("365");
  const [selected, setSelected] = useState<string[]>(DEFAULT_SCOPES);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>, message: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.token) setToken(r.token);
      toast(message);
      await result.reload();
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  const status = (t: any) =>
    t.revokedAt ? "Revoked" : t.expiresAt && new Date(t.expiresAt) < new Date() ? "Expired" : "Active";
  const sessions = (result.data || []).filter((t: any) => t.scopes.includes("mobile:session"));
  const tokens = (result.data || []).filter((t: any) => !t.scopes.includes("mobile:session"));
  const row = (t: any) => (
    <ListItem
      key={t.id}
      icon={t.scopes.includes("mobile:session") ? "phone-portrait-outline" : "key-outline"}
      tone={status(t) === "Active" ? "purple" : "neutral"}
      title={t.name}
      subtitle={`${status(t)} · ${t.expiresAt ? `expires ${fmtDate(t.expiresAt)}` : "no expiry"}${t.lastUsedAt ? ` · used ${fmtDate(t.lastUsedAt)}` : " · never used"}${t.scopes.includes("mobile:session") ? "" : `\n${t.scopes.join(", ")}`}`}
      right={
        !t.revokedAt ? (
          <ActionMenu
            title={t.name}
            actions={[
              !t.scopes.includes("mobile:session") && {
                label: "Rotate token",
                icon: "refresh",
                hint: "The current token stops working immediately",
                onPress: () => confirm("Rotate token?", "The existing token will stop working immediately.", () => run(() => call("rotateApiToken", t.id), "Token rotated")),
              },
              {
                label: "Revoke access",
                icon: "close-circle-outline",
                danger: true,
                onPress: () => confirm("Revoke access?", "This token or device session will stop working.", () => run(() => call("revokeApiToken", t.id), "Access revoked"), "Revoke"),
              },
            ]}
          />
        ) : undefined
      }
    />
  );
  return (
    <Screen refreshControl={<RefreshControl refreshing={result.loading && !!result.data} onRefresh={result.reload} />}>
      <Heading
        title="Tokens & sessions"
        subtitle="Control which integrations and devices can reach your account."
        right={<Button title="New token" compact icon="add" onPress={() => setCreating(true)} />}
      />
      {!!token && (
        <Banner
          tone="green"
          icon="key-outline"
          title="Copy this token now"
          message={`It is shown only once. Keep it private.\n\n${token}`}
          action="I’ve saved it"
          onAction={() => setToken("")}
        />
      )}
      {!!token && (
        <Card>
          <Txt selectable mono size={13}>
            {token}
          </Txt>
        </Card>
      )}
      <State {...result} />
      <Section title="API tokens">
        {tokens.length ? <Group>{tokens.map(row)}</Group> : <Card><Empty icon="key-outline" title="No API tokens" message="Create one to connect an assistant such as Hermes." /></Card>}
      </Section>
      <Section title="Signed-in devices">
        <Group>{sessions.map(row)}</Group>
      </Section>
      <Sheet
        visible={creating}
        onClose={() => setCreating(false)}
        title="New API token"
        footer={
          <Button
            title="Create token"
            loading={busy}
            disabled={busy || !name.trim() || !selected.length}
            onPress={() => {
              const d = days.trim();
              if (d && !(Number(d) > 0)) return notice(new Error("Expiry must be a number of days, or blank for none"));
              setCreating(false);
              void run(() => call("createApiToken", { name: name.trim(), scopes: selected, expiresInDays: d ? Number(d) : null }), "Token created");
              setName("");
            }}
          />
        }
      >
        <Input label="Token name" value={name} onChangeText={setName} placeholder="e.g. Hermes" />
        <Input label="Expires in days" value={days} keyboardType="number-pad" hint="Leave blank for a token that never expires." onChangeText={setDays} />
        <Section title="Allowed actions" action="Defaults" onAction={() => setSelected(DEFAULT_SCOPES)}>
          <MultiSelect options={SCOPES.map((s) => ({ label: s, value: s }))} value={selected} onChange={setSelected} />
        </Section>
      </Sheet>
    </Screen>
  );
}
