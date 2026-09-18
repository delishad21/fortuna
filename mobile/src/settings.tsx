import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useApi, useResource } from "./api";
import {
  Button,
  Card,
  Chips,
  Choice,
  confirm,
  Field,
  Form,
  Heading,
  Input,
  notice,
  Screen,
  State,
  styles,
  Txt,
  useTheme,
} from "./ui";
const scopes = [
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
export function SettingsScreen({ navigation }: any) {
  const { signOut, session } = useApi();
  const { mode, setMode } = useTheme();
  const user = useResource("getCurrentUser");
  return (
    <Screen>
      <Heading
        title="Make it yours"
        subtitle="A little organization goes a long way."
      />
      <Card>
        <Txt bold size={22}>
          {user.data?.name || "Your profile"}
        </Txt>
        <Txt muted>
          @{user.data?.username} · {user.data?.baseCurrency}
        </Txt>
        <Button
          title="Edit profile"
          secondary
          onPress={() => navigation.navigate("Profile")}
        />
      </Card>
      <Card>
        <Txt bold>Appearance</Txt>
        <Chips
          values={["system", "light", "dark"]}
          value={mode}
          onChange={setMode}
        />
      </Card>
      <Card>
        <Txt bold size={18}>
          Organize
        </Txt>
        {[
          ["Categories", "categories"],
          ["Accounts", "accounts"],
          ["Import rules", "rules"],
          ["Learned patterns", "patterns"],
        ].map(([title, kind]) => (
          <Button
            key={kind}
            title={title}
            secondary
            onPress={() => navigation.navigate("Manage", { kind })}
          />
        ))}
      </Card>
      <Card>
        <Txt bold size={18}>
          Preferences & security
        </Txt>
        <Button
          title="Auto-labeling & analytics"
          secondary
          onPress={() => navigation.navigate("Preferences")}
        />
        <Button
          title="Change password"
          secondary
          onPress={() => navigation.navigate("Password")}
        />
        <Button
          title="API tokens & mobile sessions"
          secondary
          onPress={() => navigation.navigate("Tokens")}
        />
      </Card>
      <Txt muted size={12}>
        {session?.server}
      </Txt>
      <Button
        title="Sign out"
        danger
        secondary
        onPress={() =>
          confirm(
            "Sign out?",
            "Revoke this device’s session and remove its saved credentials.",
            signOut,
          )
        }
      />
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
        <Form
          initial={{
            name: user.data.name,
            username: user.data.username,
            email: user.data.email || "",
          }}
          fields={[
            { key: "name", label: "Name", required: true },
            { key: "username", label: "Username", required: true },
            { key: "email", label: "Email" },
          ]}
          onSave={async (v) => {
            await call("updateUserProfile", { ...v, email: v.email || null });
            navigation.goBack();
          }}
        />
      )}
    </Screen>
  );
}
export function PasswordScreen({ navigation }: any) {
  const { call } = useApi();
  return (
    <Screen>
      <Heading title="Change password" />
      <Form
        fields={[
          {
            key: "current",
            label: "Current password",
            type: "password",
            required: true,
          },
          {
            key: "next",
            label: "New password",
            type: "password",
            required: true,
          },
          {
            key: "confirm",
            label: "Confirm new password",
            type: "password",
            required: true,
          },
        ]}
        onSave={async (v) => {
          if (v.next.length < 8) throw new Error("Use at least 8 characters");
          if (v.next !== v.confirm)
            throw new Error("New passwords do not match");
          await call("changePassword", v.current, v.next);
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
export function PreferencesScreen() {
  const { call } = useApi();
  const user = useResource("getCurrentUser");
  const cats = useResource("getCategories", { scope: "settings" });
  const paylah = useResource("getPaylahInternalPreferenceState");
  const [excluded, setExcluded] = useState<string[] | null>(null);
  return (
    <Screen>
      <Heading title="Your preferences" />
      <State {...user} />
      {user.data && (
        <>
          <Card>
            <Txt bold size={18}>
              Auto-labeling
            </Txt>
            <Form
              initial={{
                enabled: user.data.autoLabelEnabled,
                threshold: user.data.autoLabelThreshold,
              }}
              fields={[
                {
                  key: "enabled",
                  label: "Automatically apply suggestions",
                  type: "boolean",
                },
                {
                  key: "threshold",
                  label: "Minimum confidence (0 to 1)",
                  type: "number",
                  required: true,
                },
              ]}
              onSave={async (v) => {
                if (v.threshold < 0 || v.threshold > 1)
                  throw new Error("Confidence must be between 0 and 1");
                await call("updateAutoLabelSettings", v.enabled, v.threshold);
                Alert.alert("Saved", "Auto-label preferences updated.");
              }}
            />
          </Card>
          <Card>
            <Txt bold size={18}>
              Exclude from analytics
            </Txt>
            <Txt muted>
              Select the categories to leave out of your spending reports.
            </Txt>
            {cats.data?.map((c: any) => {
              const values = excluded ?? user.data.analyticsExcludedCategoryIds;
              const selected = values.includes(c.id);
              return (
                <Button
                  key={c.id}
                  title={`${selected ? "✓ " : ""}${c.name}`}
                  secondary={!selected}
                  onPress={() =>
                    setExcluded(
                      selected
                        ? values.filter((id: string) => id !== c.id)
                        : [...values, c.id],
                    )
                  }
                />
              );
            })}
            <Button
              title="Save exclusions"
              onPress={() =>
                void call(
                  "updateAnalyticsExcludedCategories",
                  excluded ?? user.data.analyticsExcludedCategoryIds,
                )
                  .then(() =>
                    Alert.alert("Saved", "Analytics exclusions updated."),
                  )
                  .catch(notice)
              }
            />
          </Card>
        </>
      )}
      {paylah.data && (
        <Card>
          <Txt bold>PayLah transfers</Txt>
          <Form
            initial={{ enabled: paylah.data.enabled }}
            fields={[
              {
                key: "enabled",
                label: "Treat PayLah transfers as internal",
                type: "boolean",
              },
            ]}
            onSave={async (v) => {
              await call("setPaylahInternalPreference", v.enabled);
              Alert.alert("Saved", "PayLah preference updated.");
            }}
          />
        </Card>
      )}
    </Screen>
  );
}
const configs: Record<string, { title: string; get: string }> = {
  categories: { title: "Categories", get: "getCategories" },
  accounts: { title: "Accounts", get: "getAccountNumbers" },
  rules: { title: "Import rules", get: "getImportRules" },
  patterns: { title: "Learned patterns", get: "getClassificationPatterns" },
};
export function ManageScreen({ route, navigation }: any) {
  const { kind } = route.params;
  const config = configs[kind];
  const { call } = useApi();
  const result = useResource(
    config.get,
    ...(kind === "categories" ? [{ scope: "settings" }] : []),
  );
  const applied = useResource("getAppliedClassificationSummary");
  return (
    <Screen>
      <Heading title={config.title} />
      {kind !== "patterns" && (
        <Button
          title={`Add ${kind === "categories" ? "category" : kind === "accounts" ? "account" : "rule"}`}
          icon="add"
          onPress={() => navigation.navigate("ManageEditor", { kind })}
        />
      )}
      {kind === "patterns" && (
        <Button
          title="Rebuild learned patterns"
          secondary
          onPress={() =>
            confirm(
              "Rebuild patterns?",
              "Learn classification patterns from your existing transactions.",
              async () => {
                await call("rebuildClassificationPatterns");
                await result.reload();
              },
            )
          }
        />
      )}
      <State {...result} />
      {result.data?.map((item: any) => (
        <Card key={item.id}>
          <Txt bold size={18}>
            {item.name || item.accountIdentifier || item.patternValue}
          </Txt>
          {kind === "rules" && (
            <Txt muted>
              {item.enabled ? "Enabled" : "Disabled"} ·{" "}
              {item.matchValue || "Always"} →{" "}
              {item.setLabel || item.setCategoryName || "Internal transfer"}
            </Txt>
          )}
          {kind === "patterns" && (
            <Txt muted>
              {item.status} · {Math.round(Number(item.confidence) * 100)}%
              confidence · {item.appliedCount} applied
            </Txt>
          )}
          <Button
            title="Edit"
            secondary
            onPress={() => navigation.navigate("ManageEditor", { kind, item })}
          />
        </Card>
      ))}
      {kind === "patterns" && applied.data && (
        <Card>
          <Txt bold>Applied classification summary</Txt>
          {applied.data.map((a: any) => (
            <View key={a.id}>
              <Txt>
                {a.name} · {a.appliedCount} applied
              </Txt>
              <Txt muted>{a.exampleDescription}</Txt>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
export function ManageEditorScreen({ route, navigation }: any) {
  const { kind, item } = route.params;
  const { call } = useApi();
  const cats = useResource("getCategories", { scope: "settings" });
  const parsers = useResource("getAvailableParsers", "bank");
  const parserRows = Array.isArray(parsers.data)
    ? parsers.data
    : parsers.data?.parsers || [];
  const fieldMap: Record<string, Field[]> = {
    categories: [
      { key: "name", label: "Name", required: true },
      { key: "color", label: "Color (hex)", required: true },
    ],
    accounts: [
      { key: "accountIdentifier", label: "Account identifier", required: true },
      { key: "color", label: "Color (hex)", required: true },
    ],
    rules: [
      { key: "name", label: "Rule name", required: true },
      {
        key: "parserId",
        label: "Parser",
        options: [
          { label: "All parsers", value: null },
          ...parserRows.map((p: any) => ({
            label: p.name || p.id,
            value: p.id,
          })),
        ],
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
        options: [
          { label: "Keep category", value: null },
          ...(cats.data || []).map((c: any) => ({
            label: c.name,
            value: c.name,
          })),
        ],
      },
      { key: "markInternal", label: "Mark internal transfer", type: "boolean" },
      { key: "enabled", label: "Enabled", type: "boolean" },
      { key: "sortOrder", label: "Priority order", type: "number" },
    ],
    patterns: [
      {
        key: "status",
        label: "Status",
        options: ["auto_apply", "disabled", "unresolved"].map((value) => ({
          label: value.replace("_", " "),
          value,
        })),
      },
      { key: "label", label: "Label" },
      {
        key: "categoryId",
        label: "Category",
        options: [
          { label: "No category", value: null },
          ...(cats.data || []).map((c: any) => ({
            label: c.name,
            value: c.id,
          })),
        ],
      },
      { key: "markInternal", label: "Mark internal transfer", type: "boolean" },
    ],
  };
  const fields = fieldMap[kind];
  const defaults: any = {
    color: "#5750F1",
    enabled: true,
    matchType: "description_contains",
    caseSensitive: false,
    markInternal: false,
    sortOrder: 0,
  };
  const initial = Object.fromEntries(
    fields.map((f) => [f.key, item?.[f.key] ?? defaults[f.key] ?? ""]),
  );
  return (
    <Screen>
      <Heading
        title={`${item ? "Edit" : "Add"} ${kind === "categories" ? "category" : kind === "accounts" ? "account" : kind === "rules" ? "rule" : "pattern"}`}
      />
      <Form
        initial={initial}
        fields={fields}
        onSave={async (v) => {
          if (v.color && !/^#[\da-f]{6}$/i.test(v.color))
            throw new Error("Use a six-digit hex color, such as #5750F1");
          if (kind === "categories")
            await call(
              item ? "updateCategory" : "createCategory",
              ...(item ? [item.id, v.name, v.color] : [v.name, v.color]),
            );
          else if (kind === "accounts")
            await call(
              item ? "updateAccountIdentifier" : "upsertAccountNumber",
              ...(item
                ? [item.id, v.accountIdentifier, v.color]
                : [v.accountIdentifier, v.color]),
            );
          else if (kind === "rules")
            await call(
              item ? "updateImportRule" : "createImportRule",
              ...(item ? [item.id, v] : [v]),
            );
          else await call("updateClassificationPattern", item.id, v);
          navigation.goBack();
        }}
      />
      {item && kind !== "patterns" && (
        <Button
          title="Delete"
          danger
          secondary
          onPress={() =>
            confirm(
              "Delete this item?",
              "Existing records and system-defined items may prevent deletion.",
              async () => {
                await call(
                  kind === "categories"
                    ? "deleteCategory"
                    : kind === "accounts"
                      ? "deleteAccountIdentifier"
                      : "deleteImportRule",
                  item.id,
                );
                navigation.goBack();
              },
            )
          }
        />
      )}
    </Screen>
  );
}
export function TokensScreen() {
  const { call } = useApi();
  const result = useResource("getApiTokens");
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [selected, setSelected] = useState<string[]>([]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.token) setToken(r.token);
      await result.reload();
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen>
      <Heading
        title="Tokens & sessions"
        subtitle="Control which integrations can access your account."
      />
      {token && (
        <Card>
          <Txt bold>Copy this token now</Txt>
          <Txt muted>It is shown only once. Keep it private.</Txt>
          <Txt selectable style={styles.money}>
            {token}
          </Txt>
          <Button
            title="I’ve saved it"
            secondary
            onPress={() => setToken("")}
          />
        </Card>
      )}
      <Card>
        <Input label="Token name" value={name} onChangeText={setName} />
        <Input
          label="Expires in days"
          value={days}
          onChangeText={setDays}
          keyboardType="number-pad"
        />
        <Txt bold>Allowed actions</Txt>
        {scopes.map((scope) => (
          <Button
            key={scope}
            title={`${selected.includes(scope) ? "✓ " : ""}${scope}`}
            secondary={!selected.includes(scope)}
            onPress={() =>
              setSelected((old) =>
                old.includes(scope)
                  ? old.filter((s) => s !== scope)
                  : [...old, scope],
              )
            }
          />
        ))}
        <Button
          title="Create token"
          disabled={busy || !name.trim() || !selected.length}
          onPress={() =>
            void run(() =>
              call("createApiToken", {
                name,
                scopes: selected,
                expiresInDays: Number(days),
              }),
            )
          }
        />
      </Card>
      <State {...result} />
      {result.data?.map((t: any) => (
        <Card key={t.id}>
          <Txt bold>{t.name}</Txt>
          <Txt muted>
            {t.revokedAt
              ? "Revoked"
              : t.expiresAt && new Date(t.expiresAt) < new Date()
                ? "Expired"
                : "Active"}{" "}
            ·{" "}
            {t.expiresAt ? `Expires ${t.expiresAt.slice(0, 10)}` : "No expiry"}
          </Txt>
          <Txt size={12} muted>
            {t.scopes.join(", ")}
          </Txt>
          {!t.revokedAt && (
            <>
              {!t.scopes.includes("mobile:session") && (
                <Button
                  title="Rotate token"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    confirm(
                      "Rotate token?",
                      "The existing token will stop working immediately.",
                      () => run(() => call("rotateApiToken", t.id)),
                    )
                  }
                />
              )}
              <Button
                title="Revoke access"
                danger
                secondary
                disabled={busy}
                onPress={() =>
                  confirm(
                    "Revoke access?",
                    "This token or device session will stop working.",
                    () => run(() => call("revokeApiToken", t.id)),
                  )
                }
              />
            </>
          )}
        </Card>
      ))}
    </Screen>
  );
}
