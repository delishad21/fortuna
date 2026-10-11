import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useApi, useResource } from "./api";
import {
  ActionMenu,
  Banner,
  BRAND,
  Button,
  Card,
  Checkbox,
  Chips,
  Choice,
  ColorField,
  confirm,
  DateField,
  Empty,
  fmtDate,
  Footer,
  Form,
  Group,
  Heading,
  humanize,
  IconBubble,
  IconButton,
  Input,
  KeyValue,
  ListItem,
  money,
  MultiSelect,
  notice,
  PALETTE,
  Pill,
  Screen,
  SearchBar,
  Section,
  Segmented,
  Sheet,
  Stat,
  StatGrid,
  State,
  styles,
  toast,
  TransactionRow,
  Txt,
  useTheme,
} from "./ui";
import { ImportSummaryCard, Summary } from "./home";
import { ColumnChart, Donut, RankBars } from "./charts";
import { accountDisplay } from "../../frontend/shared/accounts";

export const FILE_TYPES = [
  "application/pdf",
  "text/csv",
  "text/comma-separated-values",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
];
export function appendFile(
  form: FormData,
  key: string,
  file: DocumentPicker.DocumentPickerAsset,
) {
  if (Platform.OS === "web" && file.file) form.append(key, file.file);
  else
    form.append(key, {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || "application/octet-stream",
    } as any);
}
const CLOSED = ["committed", "discarded", "expired"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
type PendingFile = {
  asset: DocumentPicker.DocumentPickerAsset;
  parserId?: string;
  status: "pending" | "staging" | "staged" | "error";
  error?: string;
};
function UploadTab({ navigation, onStaged }: any) {
  const { stage, call } = useApi();
  const { colors } = useTheme();
  const parsers = useResource("getAvailableParsers", "bank");
  const accounts = useResource("getAccountNumbers");
  const list: any[] = Array.isArray(parsers.data) ? parsers.data : parsers.data?.parsers || [];
  const [parser, setParser] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newAccounts, setNewAccounts] = useState<{ id: string; label: string; color: string }[]>([]);
  const [staged, setStaged] = useState<any[]>([]);
  useEffect(() => {
    if (!parser && list[0]) setParser(list[0].id);
  }, [list, parser]);
  const options = list.map((p: any) => ({ label: p.name || p.id, value: p.id, hint: p.description }));
  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: FILE_TYPES,
    });
    if (!result.canceled)
      setFiles((old) => [
        ...old.filter((f) => f.status !== "staged"),
        ...result.assets.map((asset) => ({ asset, status: "pending" as const })),
      ]);
  };
  const finish = (drafts: any[]) => {
    setFiles([]);
    setStaged([]);
    setNewAccounts([]);
    onStaged?.();
    navigation.navigate("Draft", { ids: drafts.map((d) => d.id) });
  };
  const upload = async () => {
    const pending = files.filter((f) => f.status === "pending" || f.status === "error");
    if (!pending.length) return;
    setBusy(true);
    setMessage("");
    const drafts: any[] = [];
    let failures = 0;
    for (const file of pending) {
      setFiles((old) => old.map((f) => (f === file ? { ...f, status: "staging", error: undefined } : f)));
      try {
        if ((file.asset.size || 0) > 25 * 1024 * 1024) throw new Error("Statements must be under 25 MB");
        const form = new FormData();
        appendFile(form, "file", file.asset);
        form.append("parserId", file.parserId || parser);
        const { draft } = await stage(form);
        drafts.push(draft);
        setFiles((old) => old.map((f) => (f.asset === file.asset ? { ...f, status: "staged" } : f)));
      } catch (e: any) {
        failures++;
        setFiles((old) =>
          old.map((f) => (f.asset === file.asset ? { ...f, status: "error", error: e.message } : f)),
        );
      }
    }
    setBusy(false);
    if (!drafts.length) {
      setMessage("No statements could be staged. Check the parser and try again.");
      return;
    }
    if (failures)
      setMessage(`${failures} file${failures === 1 ? "" : "s"} failed. The rest are staged under the Staged tab.`);
    const saved = new Set((accounts.data || []).map((a: any) => a.accountIdentifier));
    const unknown = [
      ...new Set(
        drafts.flatMap((d) =>
          (d.rows || [])
            .map((r: any) => String(r.currentPayload?.accountIdentifier || "").trim())
            .filter((id: string) => id && !saved.has(id)),
        ),
      ),
    ];
    if (unknown.length) {
      setStaged(drafts);
      setNewAccounts(unknown.map((id, i) => ({ id, label: "", color: PALETTE[i % PALETTE.length] })));
      return;
    }
    if (!failures) finish(drafts);
    else setStaged(drafts);
  };
  const start = async () => {
    const usesPaylah = files.some((f) => (f.parserId || parser).startsWith("dbs_paylah_statement"));
    if (usesPaylah) {
      try {
        const state = await call("getPaylahInternalPreferenceState");
        if (state?.shouldPrompt) {
          const decide = async (enabled: boolean) => {
            try {
              const result = await call("setPaylahInternalPreference", enabled);
              if (enabled && result?.updatedCount)
                toast(`Marked ${result.updatedCount} earlier PayLah rows as internal`);
            } catch (e) {
              notice(e);
            }
            await upload();
          };
          if (Platform.OS === "web") {
            await decide(window.confirm("Auto-mark PayLah transfers as internal?\n\nEarlier DBS statements are updated too."));
            return;
          }
          Alert.alert(
            "Auto-mark PayLah transactions as internal?",
            "Future PayLah transfer rows are marked internal, and earlier DBS statements are updated too.",
            [
              { text: "Skip and continue", onPress: () => void decide(false) },
              { text: "Enable and continue", onPress: () => void decide(true) },
            ],
          );
          return;
        }
      } catch (e) {
        notice(e);
        return;
      }
    }
    await upload();
  };
  const ready = files.filter((f) => f.status === "pending" || f.status === "error").length;
  return (
    <>
      <Card>
        <View style={styles.row}>
          <IconBubble icon="document-text-outline" />
          <View style={{ flex: 1 }}>
            <Txt bold size={16}>
              Statement type
            </Txt>
            <Txt muted size={13}>
              Each file can use its own parser.
            </Txt>
          </View>
        </View>
        <State {...parsers} />
        <Choice label="Statement parser" value={parser} options={options} onChange={setParser} />
      </Card>
      <Card>
        <View style={styles.between}>
          <View style={{ flex: 1 }}>
            <Txt bold size={16}>
              Files
            </Txt>
            <Txt muted size={13}>
              PDF, CSV or spreadsheet · up to 25 MB each
            </Txt>
          </View>
          <Button title="Choose statements" compact icon="add" onPress={() => void pick().catch(notice)} />
        </View>
        {files.length === 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose statement files"
            onPress={() => void pick().catch(notice)}
            style={{
              borderWidth: 2,
              borderStyle: "dashed",
              borderColor: colors.line,
              borderRadius: 18,
              padding: 26,
              alignItems: "center",
              gap: 8,
            }}
          >
            <IconBubble icon="cloud-upload-outline" size={48} />
            <Txt muted>Tap to add one or more statements</Txt>
          </Pressable>
        )}
        {files.map((f, i) => (
          <View key={f.asset.uri + i} style={{ gap: 8, paddingVertical: 6 }}>
            <View style={styles.row}>
              <IconBubble
                icon={
                  f.status === "staged"
                    ? "checkmark"
                    : f.status === "error"
                      ? "alert"
                      : f.asset.name.toLowerCase().endsWith(".pdf")
                        ? "document-outline"
                        : "grid-outline"
                }
                tone={f.status === "staged" ? "green" : f.status === "error" ? "red" : "purple"}
                size={36}
              />
              <View style={{ flex: 1 }}>
                <Txt bold numberOfLines={1}>
                  {f.asset.name}
                </Txt>
                <Txt muted size={12} tone={f.status === "error" ? "red" : undefined}>
                  {f.status === "staging"
                    ? "Reading statement…"
                    : f.status === "staged"
                      ? "Staged for review"
                      : f.error || `${Math.max(1, Math.round((f.asset.size || 0) / 1024))} KB`}
                </Txt>
              </View>
              {f.status === "staging" ? (
                <ActivityIndicator color={BRAND} />
              ) : (
                <IconButton
                  icon="close"
                  size={32}
                  label={`Remove ${f.asset.name}`}
                  onPress={() => setFiles((old) => old.filter((x) => x !== f))}
                />
              )}
            </View>
            {f.status !== "staged" && list.length > 1 && (
              <Choice
                compact
                label="Parser for this file"
                value={f.parserId || parser}
                options={options}
                onChange={(parserId) =>
                  setFiles((old) => old.map((x) => (x === f ? { ...x, parserId } : x)))
                }
              />
            )}
          </View>
        ))}
      </Card>
      {!!message && <Banner tone="amber" icon="alert-circle-outline" message={message} />}
      <Button
        title={busy ? "Staging statements…" : `Upload & review${ready ? ` (${ready})` : ""}`}
        icon="sparkles-outline"
        loading={busy}
        disabled={busy || !parser || !ready}
        onPress={() => void start()}
      />
      {staged.length > 0 && newAccounts.length === 0 && (
        <Button title={`Review ${staged.length} staged statement${staged.length === 1 ? "" : "s"}`} secondary onPress={() => finish(staged)} />
      )}
      <Txt muted size={12} style={{ textAlign: "center" }}>
        Statements are staged first. Nothing is saved until you review and commit.
      </Txt>
      <Sheet
        visible={newAccounts.length > 0}
        onClose={() => finish(staged)}
        title="New accounts found"
        subtitle="Give them a name and a color. You can change these later."
        footer={
          <>
            <Button
              title="Save accounts & review"
              onPress={async () => {
                try {
                  await Promise.all(
                    newAccounts.map((a) => call("upsertAccountNumber", a.id, a.color, a.label.trim() || null)),
                  );
                  toast("Accounts saved");
                  finish(staged);
                } catch (e) {
                  notice(e);
                }
              }}
            />
            <Button title="Skip for now" ghost onPress={() => finish(staged)} />
          </>
        }
      >
        {newAccounts.map((a, i) => (
          <Card key={a.id}>
            <Txt bold mono>
              {a.id}
            </Txt>
            <Input
              label="Friendly name"
              placeholder="e.g. UOB One credit card"
              value={a.label}
              onChangeText={(label: string) =>
                setNewAccounts((old) => old.map((x, n) => (n === i ? { ...x, label } : x)))
              }
            />
            <ColorField
              label="Color"
              value={a.color}
              onChange={(color) => setNewAccounts((old) => old.map((x, n) => (n === i ? { ...x, color } : x)))}
            />
          </Card>
        ))}
      </Sheet>
    </>
  );
}
function StagedTab({ navigation, drafts, reload }: any) {
  const { call } = useApi();
  const [selected, setSelected] = useState<string[]>([]);
  const staged = (drafts.data?.drafts || []).filter((d: any) => !CLOSED.includes(d.status));
  const byId = new Map(staged.map((d: any) => [d.id, d]));
  const missing = selected.flatMap((id) =>
    ((byId.get(id) as any)?.linkedDraftIds || [])
      .filter((other: string) => !selected.includes(other) && byId.has(other))
      .map((other: string) => ({ id, other })),
  );
  const discard = (ids: string[]) =>
    confirm(
      ids.length === 1 ? "Delete staged import?" : `Delete ${ids.length} staged imports?`,
      "Unsaved edits are lost. Reimbursement links to these rows are removed.",
      async () => {
        for (const id of ids) await call("discardAgentDraft", id);
        setSelected((old) => old.filter((id) => !ids.includes(id)));
        toast(ids.length === 1 ? "Staged import deleted" : `${ids.length} staged imports deleted`);
        await reload();
      },
      "Delete",
    );
  return (
    <>
      <State {...drafts} />
      {drafts.data && staged.length === 0 && (
        <Card>
          <Empty
            icon="layers-outline"
            title="No staged statements"
            message="Statements you upload, or that your agent stages, wait here until you commit them."
          />
        </Card>
      )}
      {staged.length > 0 && (
        <View style={styles.between}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Select all staged imports"
            accessibilityState={{ checked: selected.length === staged.length }}
            onPress={() => setSelected(selected.length === staged.length ? [] : staged.map((d: any) => d.id))}
            style={[styles.row, { gap: 10 }]}
          >
            <Checkbox checked={selected.length === staged.length && staged.length > 0} />
            <Txt bold>Select all</Txt>
          </Pressable>
          {selected.length > 0 && (
            <Button title={`Delete ${selected.length}`} compact secondary danger icon="trash-outline" onPress={() => discard(selected)} />
          )}
        </View>
      )}
      {missing.length > 0 && (
        <Banner
          tone="amber"
          icon="link-outline"
          title="Linked imports belong together"
          message={missing
            .map(({ id, other }: any) => `${(byId.get(id) as any)?.sourceFilename} is linked to ${(byId.get(other) as any)?.sourceFilename}.`)
            .join("\n")}
          action={`Select ${missing.length === 1 ? (byId.get(missing[0].other) as any)?.sourceFilename : "them"} too`}
          onAction={() => setSelected((old) => [...new Set([...old, ...missing.map((m: any) => m.other)])])}
        />
      )}
      {staged.map((d: any) => {
        const s = d.reviewSummary || {};
        const on = selected.includes(d.id);
        return (
          <Card key={d.id}>
            <View style={styles.row}>
              <Checkbox
                checked={on}
                label={`Select ${d.sourceFilename}`}
                onChange={(c) => setSelected((old) => (c ? [...old, d.id] : old.filter((x) => x !== d.id)))}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={d.sourceFilename}
                onPress={() => navigation.navigate("Draft", { ids: [d.id] })}
                style={{ flex: 1 }}
              >
                <Txt bold numberOfLines={1}>
                  {d.sourceFilename || "Statement"}
                </Txt>
                <Txt muted size={12}>
                  {plural(s.total ?? d._count?.rows ?? 0, "row")} · {d.mode === "trip" ? "Trip" : "Bank"} · staged {fmtDate(d.createdAt, false)}
                </Txt>
              </Pressable>
              <ActionMenu
                title={d.sourceFilename}
                actions={[
                  { label: "Review", icon: "eye-outline", onPress: () => navigation.navigate("Draft", { ids: [d.id] }) },
                  { label: "Delete staged import", icon: "trash-outline", danger: true, onPress: () => discard([d.id]) },
                ]}
              />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {s.labelling > 0 && <Pill tone="amber" icon="pricetag-outline" label={`${s.labelling} to label`} />}
              {s.reconciliation > 0 && <Pill tone="blue" icon="git-compare-outline" label={`${s.reconciliation} to reconcile`} />}
              {s.ready > 0 && <Pill tone="green" icon="checkmark" label={`${s.ready} ready`} />}
              {d._count?.proposals > 0 && <Pill tone="purple" icon="sparkles-outline" label={`${d._count.proposals} suggestions`} />}
              {d.linkedDraftIds?.length > 0 && <Pill icon="link-outline" label="Linked" />}
            </View>
          </Card>
        );
      })}
      {selected.length > 0 && (
        <Button
          title={`Review ${selected.length} together`}
          icon="albums-outline"
          onPress={() => navigation.navigate("Draft", { ids: selected })}
        />
      )}
    </>
  );
}
function HistoryTab({ navigation, history }: any) {
  const rows = Array.isArray(history.data) ? history.data : history.data?.imports || [];
  return (
    <>
      <State {...history} />
      {history.data && rows.length === 0 && (
        <Card>
          <Empty icon="time-outline" title="No imported statements yet" message="Saved statements appear here after you commit them." />
        </Card>
      )}
      {rows.map((b: any) => (
        <ImportSummaryCard key={b.key} item={b} onPress={() => navigation.navigate("ImportDetail", { key: b.key })} />
      ))}
    </>
  );
}
export function ImportsScreen({ navigation, route }: any) {
  const [tab, setTab] = useState("Upload");
  const drafts = useResource("getAgentDrafts");
  const history = useResource("getImportSummaries");
  useEffect(() => {
    const open = route?.params?.openTab;
    if (open) setTab(open === "Staged" ? "Staged" : open === "History" ? "History" : "Upload");
  }, [route?.params?.refreshKey, route?.params?.openTab]);
  const count = (drafts.data?.drafts || []).filter((d: any) => !CLOSED.includes(d.status)).length;
  useEffect(() => {
    navigation.setOptions({ tabBarBadge: count || undefined });
  }, [count, navigation]);
  const resource = tab === "Staged" ? drafts : history;
  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={tab !== "Upload" && resource.loading && !!resource.data} onRefresh={resource.reload} />
      }
    >
      <Heading title="Imports" subtitle="Bring statements in. Review every detail before saving." />
      <Segmented
        values={["Upload", "Staged", "History"]}
        labels={{ Upload: "Upload", Staged: count ? `Staged · ${count}` : "Staged", History: "History" }}
        value={tab}
        onChange={setTab}
      />
      {tab === "Upload" && <UploadTab navigation={navigation} onStaged={drafts.reload} />}
      {tab === "Staged" && <StagedTab navigation={navigation} drafts={drafts} reload={drafts.reload} />}
      {tab === "History" && <HistoryTab navigation={navigation} history={history} />}
    </Screen>
  );
}
type Item = { draft: any; row: any };
const FILTERS = ["Needs review", "Labelling", "Reconciliation", "Ready", "Selected", "All"];
const matchesFilter = (row: any, filter: string) => {
  const r = row.review || {};
  return (
    filter === "All" ||
    (filter === "Needs review" && r.needsReview) ||
    (filter === "Labelling" && r.labelling) ||
    (filter === "Reconciliation" && r.reconciliation) ||
    (filter === "Ready" && !r.needsReview) ||
    (filter === "Selected" && row.selected)
  );
};
const nameOf = (row: any) => String(row.currentPayload?.label || row.currentPayload?.description || "row");
/** Review one or more staged imports together, then commit them in one go. */
export function DraftReviewScreen({ route, navigation }: any) {
  const ids: string[] = route.params.ids || (route.params.id ? [route.params.id] : []);
  const fromChat = !!route.params.fromChat;
  const { call } = useApi();
  const { colors } = useTheme();
  const [drafts, setDrafts] = useState<any[]>([]);
  const draftsRef = useRef<any[]>([]);
  const queues = useRef(new Map<string, Promise<void>>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("Needs review");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date");
  const [editing, setEditing] = useState<{ draftId: string; rowId: string } | null>(null);
  const [pendingCommit, setPendingCommit] = useState<any>(null);
  const [accountSheet, setAccountSheet] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [columns, setColumns] = useState<any>({ categoryIds: [], direction: "all" });
  const [accountChoice, setAccountChoice] = useState("");
  const [newAccount, setNewAccount] = useState({ id: "", label: "", color: PALETTE[2] });
  const categories = useResource("getCategories", { scope: "settings" });
  const accounts = useResource("getAccountNumbers");
  const setAll = (next: any[]) => {
    draftsRef.current = next;
    setDrafts(next);
  };
  const refresh = useCallback(async () => {
    setError("");
    try {
      setAll(await Promise.all(ids.map((id) => call("getAgentDraft", id).then((r: any) => r.draft))));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, ids.join(",")]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  const replaceDraft = (draft: any) =>
    setAll(draftsRef.current.map((d) => (d.id === draft.id ? draft : d)));
  /** Serialized row update with one retry when the row changed underneath us. */
  const updateRow = (draftId: string, rowId: string, input: (row: any) => any) => {
    const key = `${draftId}:${rowId}`;
    const previous = queues.current.get(key) || Promise.resolve();
    setBusy(true);
    setMessage("");
    setPendingCommit(null);
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const row = () => draftsRef.current.find((d) => d.id === draftId)?.rows.find((r: any) => r.id === rowId);
        const save = (r: any) => {
          const patch = input(r);
          return call("updateAgentDraftRow", draftId, rowId, {
            expectedVersion: r.version,
            ...patch,
            ...(patch.currentPayload ? { reviewStatus: "edited" } : {}),
          });
        };
        const current = row();
        if (!current) return;
        try {
          await save(current);
        } catch (e: any) {
          if (e.message !== "Draft row is stale") throw e;
          replaceDraft((await call("getAgentDraft", draftId)).draft);
          const latest = row();
          if (!latest) return;
          await save(latest);
        }
        replaceDraft((await call("getAgentDraft", draftId)).draft);
      })
      .catch((e) => setMessage(e.message || "Could not update row"))
      .finally(() => {
        if (queues.current.get(key) === run) queues.current.delete(key);
        if (!queues.current.size) setBusy(false);
      });
    queues.current.set(key, run);
    return run;
  };
  const items: Item[] = useMemo(
    () =>
      drafts
        .flatMap((draft) => (draft.rows || []).map((row: any) => ({ draft, row })))
        .sort((a, b) => {
          if (sort === "amount")
            return (
              Number(b.row.currentPayload?.amountOut || b.row.currentPayload?.amountIn || 0) -
              Number(a.row.currentPayload?.amountOut || a.row.currentPayload?.amountIn || 0)
            );
          const order = String(a.row.currentPayload?.date || "").localeCompare(String(b.row.currentPayload?.date || ""));
          if (order) return sort === "recent" ? -order : order;
          const file = String(a.draft.sourceFilename || "").localeCompare(String(b.draft.sourceFilename || ""));
          return file || Number(a.row.rowIndex || 0) - Number(b.row.rowIndex || 0);
        }),
    [drafts, sort],
  );
  const counts = Object.fromEntries(FILTERS.map((f) => [f, items.filter((i) => matchesFilter(i.row, f)).length]));
  const columnCount =
    (columns.dateFrom ? 1 : 0) + (columns.dateTo ? 1 : 0) + (columns.categoryIds.length ? 1 : 0) +
    (columns.direction !== "all" ? 1 : 0) + (columns.min ? 1 : 0) + (columns.max ? 1 : 0);
  const matchesColumns = (row: any) => {
    const p = row.currentPayload || {};
    const date = String(p.date || "").slice(0, 10);
    const amount = Number(p.amountOut || p.amountIn || 0);
    const key = p.categoryId || "__none__";
    return (
      (!columns.dateFrom || date >= columns.dateFrom) &&
      (!columns.dateTo || date <= columns.dateTo) &&
      (!columns.categoryIds.length || columns.categoryIds.includes(key)) &&
      (columns.direction === "all" ||
        (columns.direction === "in" ? Number(p.amountIn || 0) > 0 : Number(p.amountOut || 0) > 0)) &&
      (!columns.min || amount >= Number(columns.min)) &&
      (!columns.max || amount <= Number(columns.max))
    );
  };
  const visible = items.filter(
    (i) =>
      matchesFilter(i.row, filter) &&
      matchesColumns(i.row) &&
      `${i.row.currentPayload?.label || ""} ${i.row.currentPayload?.description || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selectedCount = items.filter((i) => i.row.selected).length;
  const closed = drafts.length > 0 && drafts.every((d) => CLOSED.includes(d.status));
  const multiple = drafts.length > 1;
  const categoryName = (id: string) => (categories.data || []).find((c: any) => c.id === id)?.name;
  const linkProblems = useMemo(() => {
    const byRow = new Map(items.map((i) => [String(i.row.id), i]));
    const seen = new Set<string>();
    const problems: { key: string; message: string; select?: Item }[] = [];
    for (const item of items) {
      for (const view of [...(item.row.links?.asReimbursement || []), ...(item.row.links?.asExpense || [])]) {
        if (!view.stagedRowId) continue;
        const pair = [String(item.row.id), String(view.stagedRowId)].sort().join(":");
        if (seen.has(pair)) continue;
        seen.add(pair);
        const partner = byRow.get(String(view.stagedRowId));
        if (!partner) {
          if (item.row.selected)
            problems.push({
              key: pair,
              message: `${item.draft.sourceFilename} row ${item.row.rowIndex + 1} (${nameOf(item.row)}) is linked to row ${(view.rowIndex ?? 0) + 1} of ${view.filename || "another staged import"}, which isn't in this review. Review both imports together, or remove the link.`,
            });
          continue;
        }
        if (!!item.row.selected === !!partner.row.selected) continue;
        const [on, off] = item.row.selected ? [item, partner] : [partner, item];
        problems.push({
          key: pair,
          message: `${on.draft.sourceFilename} row ${on.row.rowIndex + 1} (${nameOf(on.row)}) is linked to ${off.draft.sourceFilename} row ${off.row.rowIndex + 1} (${nameOf(off.row)}), which isn't selected.`,
          select: off,
        });
      }
    }
    return problems;
  }, [items]);
  const setAllSelected = async (selected: boolean) => {
    setBusy(true);
    try {
      await Promise.all(
        items
          .filter((i) => !!i.row.selected !== selected)
          .map((i) => call("updateAgentDraftRow", i.draft.id, i.row.id, { expectedVersion: i.row.version, selected })),
      );
      await refresh();
    } catch (e: any) {
      setMessage(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  /** Give every selected bank row the same account, creating the account first if needed. */
  const applyAccount = async () => {
    setBusy(true);
    try {
      let id = accountChoice;
      if (accountChoice === "__new__") {
        if (!newAccount.id.trim()) throw new Error("Enter the account number or identifier");
        const saved = await call("upsertAccountNumber", newAccount.id.trim(), newAccount.color, newAccount.label.trim() || null);
        id = saved.accountIdentifier;
        await accounts.reload();
      }
      if (!id) throw new Error("Choose an account");
      const targets = items.filter((i) => i.row.selected && i.draft.mode !== "trip");
      for (const i of targets) {
        const row = draftsRef.current.find((d) => d.id === i.draft.id)?.rows.find((r: any) => r.id === i.row.id) || i.row;
        await call("updateAgentDraftRow", i.draft.id, i.row.id, {
          expectedVersion: row.version,
          currentPayload: { ...row.currentPayload, accountIdentifier: id },
          reviewStatus: "edited",
        });
      }
      setAccountSheet(false);
      setMessage("");
      toast(`Account set on ${plural(targets.length, "row")}`);
      await refresh();
    } catch (e: any) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  const commitValidated = async (selection: any) => {
    setBusy(true);
    setMessage("");
    try {
      // One commit for every file keeps links between them; nothing saves if any fails.
      await call(
        "commitAgentDraftSelection",
        selection.validations.map(({ draftId, validation }: any) => ({
          draftId,
          confirmationToken: validation.confirmationToken,
        })),
      );
      setPendingCommit(null);
      toast("Import saved");
      if (fromChat) navigation.goBack();
      else navigation.navigate("Main", { screen: "Import", params: { openTab: "History", refreshKey: Date.now() } });
    } catch (e: any) {
      setMessage(e.message || "Commit failed");
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    setBusy(true);
    setMessage("");
    setPendingCommit(null);
    try {
      const candidates = drafts.filter((d) => d.rows.some((r: any) => r.selected)).map((d) => d.id);
      if (!candidates.length) return;
      const selection = await call("validateAgentDraftSelection", candidates);
      const invalid = selection.validations.filter((v: any) => !v.validation.valid);
      if (invalid.length || selection.valid === false) {
        setMessage(
          (invalid.length ? invalid : selection.validations)
            .flatMap(({ filename, validation }: any) =>
              [...(validation.errors || []), ...(validation.warnings || [])].map(
                (issue: any) => `${filename}${issue.rowIndex !== undefined ? ` row ${issue.rowIndex + 1}` : ""}: ${issue.message}`,
              ),
            )
            .join("\n") || "Resolve the flagged rows before committing.",
        );
        await refresh();
        return;
      }
      if (selection.duplicates?.length) {
        setPendingCommit(selection);
        return;
      }
      const n = selection.validations.reduce((s: number, v: any) => s + Number(v.validation.summary?.selected || 0), 0);
      confirm(
        "Save this import?",
        `Commit ${n} selected rows${selection.validations.length > 1 ? ` across ${selection.validations.length} statements` : ""}.`,
        () => commitValidated(selection),
        "Commit",
      );
    } catch (e: any) {
      setMessage(e.message || "Could not validate this import");
    } finally {
      setBusy(false);
    }
  };
  const editingItem = editing
    ? items.find((i) => i.draft.id === editing.draftId && i.row.id === editing.rowId)
    : undefined;
  const header = (
    <View style={styles.stack}>
      <Heading
        title={multiple ? "Staged imports" : drafts[0]?.sourceFilename || "Review import"}
        subtitle={
          drafts.length
            ? `${plural(items.length, "row")} · ${selectedCount} selected${multiple ? ` · ${drafts.length} statements` : ""}`
            : undefined
        }
        right={
          <ActionMenu
            actions={[
              { label: "Select all rows", icon: "checkmark-done-outline", onPress: () => void setAllSelected(true), disabled: closed },
              {
                label: `Select the ${visible.length} rows shown`,
                icon: "filter-outline",
                disabled: closed,
                onPress: () =>
                  visible.filter((i) => !i.row.selected).forEach((i) => void updateRow(i.draft.id, i.row.id, () => ({ selected: true }))),
              },
              { label: "Deselect all rows", icon: "remove-circle-outline", onPress: () => void setAllSelected(false), disabled: closed },
              { label: "Set account for selected rows", icon: "card-outline", onPress: () => setAccountSheet(true), disabled: closed },
              { label: "Refresh", icon: "refresh", onPress: () => void refresh() },
              {
                label: multiple ? "Delete these staged imports" : "Delete staged import",
                icon: "trash-outline",
                danger: true,
                disabled: closed,
                onPress: () =>
                  confirm("Delete staged import?", "Unsaved edits are lost. Links to these rows are removed.", async () => {
                    for (const d of drafts) await call("discardAgentDraft", d.id);
                    toast("Staged import deleted");
                    navigation.goBack();
                  }, "Delete"),
              },
            ]}
          />
        }
      />
      {loading && <ActivityIndicator color={BRAND} style={{ padding: 20 }} />}
      {!!error && <Banner tone="red" title="Couldn’t load this import" message={error} action="Try again" onAction={() => void refresh()} />}
      {closed && <Banner tone="green" icon="checkmark-circle-outline" message={`This import is ${drafts[0]?.status}.`} />}
      {drafts.length > 0 && (
        <StatGrid>
          <Stat icon="alert-circle-outline" tone="amber" label="Needs review" value={String(counts["Needs review"])} />
          <Stat icon="checkmark-circle-outline" tone="green" label="Ready" value={String(counts.Ready)} />
        </StatGrid>
      )}
      {!!message && (
        <Banner
          tone="red"
          icon="alert-circle-outline"
          message={message}
          action={/accountIdentifier|account/i.test(message) ? "Set an account for these rows" : undefined}
          onAction={() => setAccountSheet(true)}
        />
      )}
      {linkProblems.length > 0 && (
        <Card style={{ backgroundColor: colors.amberTint, borderColor: colors.amberTint, gap: 10 }}>
          <Txt bold tone="amber">
            Linked rows must be committed together
          </Txt>
          {linkProblems.map((p) => (
            <View key={p.key} style={{ gap: 6 }}>
              <Txt size={13}>{p.message}</Txt>
              {p.select && (
                <Button
                  title="Select it"
                  compact
                  secondary
                  disabled={busy}
                  onPress={() => void updateRow(p.select!.draft.id, p.select!.row.id, () => ({ selected: true }))}
                />
              )}
            </View>
          ))}
        </Card>
      )}
      <Chips
        values={FILTERS}
        value={filter}
        onChange={setFilter}
        counts={Object.fromEntries(FILTERS.map((f) => [f, counts[f]]))}
      />
      <View style={[styles.row, { gap: 8 }]}>
        <View style={{ flex: 1 }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Description or label" label="Search staged transactions" />
        </View>
        <IconButton
          icon="options-outline"
          label="Filter rows"
          tone={columnCount ? "purple" : "neutral"}
          onPress={() => setShowFilters(true)}
        />
        <ActionMenu
          title="Sort rows"
          icon="swap-vertical"
          label="Sort"
          actions={[
            { label: "Oldest first", icon: sort === "date" ? "checkmark" : "calendar-outline", onPress: () => setSort("date") },
            { label: "Newest first", icon: sort === "recent" ? "checkmark" : "calendar-outline", onPress: () => setSort("recent") },
            { label: "Largest amount", icon: sort === "amount" ? "checkmark" : "cash-outline", onPress: () => setSort("amount") },
          ]}
        />
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={visible}
        keyExtractor={(i) => i.row.id}
        contentContainerStyle={[styles.content, { gap: 8 }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          drafts.length ? (
            <Card>
              <Empty icon="filter-outline" title="No rows in this view" message="Choose All to see every row." />
            </Card>
          ) : null
        }
        renderItem={({ item }) => (
          <DraftRowCard
            item={item}
            multiple={multiple}
            disabled={closed}
            categoryName={categoryName}
            onToggle={() => void updateRow(item.draft.id, item.row.id, (r) => ({ selected: !r.selected }))}
            onOpen={() => setEditing({ draftId: item.draft.id, rowId: item.row.id })}
          />
        )}
      />
      {!closed && drafts.length > 0 && (
        <Footer>
          <Button
            title={busy ? "Checking…" : `Validate & commit (${selectedCount})`}
            icon="shield-checkmark-outline"
            loading={busy}
            disabled={busy || !selectedCount}
            onPress={() => void validate()}
          />
        </Footer>
      )}
      <Sheet
        visible={!!editingItem}
        onClose={() => setEditing(null)}
        title="Staged transaction"
        subtitle={editingItem ? `${editingItem.draft.sourceFilename} · row ${editingItem.row.rowIndex + 1}` : undefined}
      >
        {editingItem && (
          <RowEditor
            item={editingItem}
            busy={busy}
            closed={closed}
            categories={categories.data || []}
            accounts={accounts.data || []}
            contextDraftIds={drafts.map((d) => d.id)}
            navigation={navigation}
            close={() => setEditing(null)}
            update={(input: (row: any) => any) => updateRow(editingItem.draft.id, editingItem.row.id, input)}
            decide={async (proposalId: string, decision: string) => {
              try {
                await call("decideAgentProposal", proposalId, decision);
                await refresh();
              } catch (e) {
                notice(e);
              }
            }}
          />
        )}
      </Sheet>
      <Sheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filter rows"
        subtitle={`${visible.length} of ${items.length} rows shown`}
        footer={
          <View style={styles.row}>
            <Button title="Reset" secondary style={{ flex: 1 }} onPress={() => setColumns({ categoryIds: [], direction: "all" })} />
            <Button title="Done" style={{ flex: 2 }} onPress={() => setShowFilters(false)} />
          </View>
        }
      >
        <Segmented
          values={["all", "in", "out"]}
          labels={{ all: "All", in: "Money in", out: "Money out" }}
          value={columns.direction}
          onChange={(direction) => setColumns((c: any) => ({ ...c, direction }))}
        />
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={columns.dateFrom || ""} onChange={(dateFrom) => setColumns((c: any) => ({ ...c, dateFrom }))} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={columns.dateTo || ""} onChange={(dateTo) => setColumns((c: any) => ({ ...c, dateTo }))} />
          </View>
        </View>
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1 }}>
            <Input label="Min amount" value={columns.min || ""} keyboardType="decimal-pad" onChangeText={(min: string) => setColumns((c: any) => ({ ...c, min }))} />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Max amount" value={columns.max || ""} keyboardType="decimal-pad" onChangeText={(max: string) => setColumns((c: any) => ({ ...c, max }))} />
          </View>
        </View>
        <Section title="Categories" hint="Leave all unticked to show every category.">
          <MultiSelect
            options={[
              { label: "Uncategorized", value: "__none__" },
              ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
            ]}
            value={columns.categoryIds}
            onChange={(categoryIds) => setColumns((c: any) => ({ ...c, categoryIds }))}
          />
        </Section>
      </Sheet>
      <Sheet
        visible={accountSheet}
        onClose={() => setAccountSheet(false)}
        title="Set account"
        subtitle={`Applies to the ${selectedCount} selected rows.`}
        footer={<Button title="Apply account" loading={busy} disabled={busy || !accountChoice} onPress={() => void applyAccount()} />}
      >
        <Choice
          label="Account"
          value={accountChoice}
          options={[
            ...(accounts.data || []).map((a: any) => ({ label: accountDisplay(a), value: a.accountIdentifier, color: a.color })),
            { label: "New account…", value: "__new__" },
          ]}
          onChange={setAccountChoice}
        />
        {accountChoice === "__new__" && (
          <Card>
            <Input label="Account number or identifier" value={newAccount.id} autoCapitalize="none" onChangeText={(id: string) => setNewAccount((a) => ({ ...a, id }))} />
            <Input label="Friendly name" value={newAccount.label} placeholder="e.g. DBS Multiplier" onChangeText={(label: string) => setNewAccount((a) => ({ ...a, label }))} />
            <ColorField label="Color" value={newAccount.color} onChange={(color) => setNewAccount((a) => ({ ...a, color }))} />
          </Card>
        )}
      </Sheet>
      <Sheet
        visible={!!pendingCommit}
        onClose={() => setPendingCommit(null)}
        title={`Review ${pendingCommit?.duplicates?.length || 0} possible duplicate${pendingCommit?.duplicates?.length === 1 ? "" : "s"}`}
        subtitle="These rows look like transactions already saved or selected elsewhere. Exclude any you don't want to import."
        footer={
          <View style={styles.row}>
            <Button title="Back to review" secondary style={{ flex: 1 }} disabled={busy} onPress={() => setPendingCommit(null)} />
            <Button title="Commit anyway" style={{ flex: 1 }} loading={busy} disabled={busy} onPress={() => void commitValidated(pendingCommit)} />
          </View>
        }
      >
        {(pendingCommit?.duplicates || []).map((f: any, i: number) => (
          <Card key={`${f.row.rowId}:${f.match.rowId}:${i}`} style={{ gap: 6 }}>
            <Txt bold>
              {f.row.filename} · row {f.row.rowIndex + 1}
            </Txt>
            <Txt size={14}>
              {fmtDate(f.row.date)} · {f.row.description} · {f.row.amountIn ? "+" : "−"}
              {money(f.row.amountIn || f.row.amountOut || 0)}
            </Txt>
            <Txt muted size={13}>
              Matches {f.match.source === "saved" ? "a saved transaction" : `${f.match.filename} row ${f.match.rowIndex + 1}`}: {fmtDate(f.match.date)} · {f.match.description}
              {f.reasons?.length ? ` · ${f.reasons.join(", ")}` : ""}
            </Txt>
          </Card>
        ))}
      </Sheet>
    </View>
  );
}
function DraftRowCard({ item, multiple, disabled, categoryName, onToggle, onOpen }: any) {
  const { colors } = useTheme();
  const p = item.row.currentPayload || {};
  const r = item.row.review || {};
  const income = Number(p.amountIn || 0) > 0;
  const proposals = (item.row.proposals || []).filter((x: any) => x.status === "proposed");
  const internal = p.linkage?.type === "internal";
  return (
    <Card style={{ padding: 12, gap: 8, opacity: item.row.selected ? 1 : 0.6 }}>
      <View style={[styles.row, { alignItems: "flex-start" }]}>
        <Checkbox checked={!!item.row.selected} label={`Include ${nameOf(item.row)}`} onChange={disabled ? undefined : onToggle} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${nameOf(item.row)}`}
          onPress={onOpen}
          style={{ flex: 1, gap: 2 }}
        >
          <View style={[styles.between, { alignItems: "flex-start" }]}>
            <Txt bold numberOfLines={2} style={{ flex: 1 }}>
              {p.label || p.description}
            </Txt>
            <Txt mono size={14} style={{ color: internal ? colors.muted : income ? colors.green : colors.text }}>
              {income ? "+" : "−"}
              {money(p.amountIn || p.amountOut)}
            </Txt>
          </View>
          {!!p.label && (
            <Txt muted size={12} numberOfLines={1}>
              {p.description}
            </Txt>
          )}
          <Txt muted size={12} numberOfLines={1}>
            {fmtDate(p.date)} · {categoryName(p.categoryId) || "Uncategorized"}
            {multiple ? ` · ${item.draft.sourceFilename}` : ""}
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {r.labelling && <Pill tone="amber" label="Needs label" />}
            {r.reconciliation && <Pill tone="blue" label="Reconcile" />}
            {!r.needsReview && <Pill tone="green" label="Ready" />}
            {internal && <Pill tone="blue" label="Internal" />}
            {p.linkage?.type === "reimbursement" && <Pill tone="green" label="Reimbursement" />}
            {item.row.links?.linkedAmount > 0 && <Pill icon="link-outline" label={`${money(item.row.links.linkedAmount)} linked`} />}
            {proposals.length > 0 && <Pill tone="purple" icon="sparkles-outline" label="Suggestion" />}
            {item.row.reviewStatus === "edited" && <Pill label="Edited" />}
          </View>
        </Pressable>
      </View>
    </Card>
  );
}
function RowEditor({ item, busy, closed, categories, accounts, contextDraftIds, navigation, close, update, decide }: any) {
  const { call } = useApi();
  const p = item.row.currentPayload || {};
  const main = item.draft.mode !== "trip";
  const income = Number(p.amountIn || 0) > 0;
  const kind = p.linkage?.type === "internal" ? "internal" : p.linkage?.type === "reimbursement" ? "reimbursement" : "none";
  const linkedViews = [...(item.row.links?.asReimbursement || []), ...(item.row.links?.asExpense || [])];
  const openPicker = (mode: "expenses" | "reimbursements") => {
    close();
    navigation.navigate("LinkPicker", {
      subject: { draftRowId: item.row.id },
      mode,
      title: p.label || p.description,
      currentDraftId: item.draft.id,
      contextDraftIds,
      leftoverCategoryId: p.linkage?.leftoverCategoryId ?? null,
    });
  };
  const setKind = async (next: string) => {
    if (next === kind) return;
    await update((row: any) => ({
      currentPayload: {
        ...row.currentPayload,
        linkage:
          next === "internal"
            ? { type: "internal" }
            : next === "reimbursement"
              ? { type: "reimbursement", leftoverCategoryId: null }
              : null,
      },
    }));
    if (next === "reimbursement") openPicker("expenses");
  };
  const categoryName = (id: string) => categories.find((c: any) => c.id === id)?.name;
  return (
    <>
      {(item.row.review?.reasons || []).length > 0 && (
        <Banner tone="amber" icon="alert-circle-outline" title="Why it needs review" message={item.row.review.reasons.join("\n")} />
      )}
      {(item.row.proposals || []).map((proposal: any) => (
        <Card key={proposal.id} style={{ gap: 8 }}>
          <View style={styles.row}>
            <IconBubble icon="sparkles-outline" size={32} />
            <View style={{ flex: 1 }}>
              <Txt bold>Agent suggestion</Txt>
              <Txt muted size={12}>
                {Math.round(Number(proposal.confidence) * 100)}% confident · {humanize(proposal.status)}
              </Txt>
            </View>
          </View>
          {!!proposal.reason && <Txt size={14}>{proposal.reason}</Txt>}
          {!!proposal.proposedLabel && <KeyValue label="Label" value={proposal.proposedLabel} />}
          {!!proposal.proposedCategoryId && <KeyValue label="Category" value={categoryName(proposal.proposedCategoryId) || "—"} />}
          {!!proposal.proposedTripEntryType && <KeyValue label="Entry" value={humanize(proposal.proposedTripEntryType)} />}
          {!!proposal.proposedLinkage && (
            <Txt size={13} muted>
              {proposal.proposedLinkage.type === "internal"
                ? "Mark as an internal transfer"
                : `Reimbursement for ${(proposal.proposedLinkage.reimbursesAllocations || []).length} expense(s)`}
            </Txt>
          )}
          {proposal.status === "proposed" && !closed && (
            <View style={styles.row}>
              <Button title="Accept" compact icon="checkmark" style={{ flex: 1 }} disabled={busy} onPress={() => void decide(proposal.id, "accept")} />
              <Button title="Reject" compact secondary icon="close" style={{ flex: 1 }} disabled={busy} onPress={() => void decide(proposal.id, "reject")} />
            </View>
          )}
        </Card>
      ))}
      {main && !closed && (
        <Section title="Reconciliation">
          <Segmented
            values={income ? ["none", "internal", "reimbursement"] : ["none", "internal"]}
            labels={{ none: "None", internal: "Internal", reimbursement: "Reimbursement" }}
            value={kind}
            onChange={(v) => void setKind(v)}
          />
          {kind === "reimbursement" && (
            <Button title="What does this pay back?" compact secondary icon="link-outline" onPress={() => openPicker("expenses")} />
          )}
          {!income && (
            <Button title="Reimbursed by…" compact secondary icon="link-outline" onPress={() => openPicker("reimbursements")} />
          )}
          {linkedViews.length > 0 && (
            <Group>
              {linkedViews.map((v: any, i: number) => (
                <ListItem
                  key={i}
                  icon="link-outline"
                  tone="green"
                  title={v.label || v.description || "Linked row"}
                  subtitle={v.filename ? `${v.filename} row ${(v.rowIndex ?? 0) + 1}` : fmtDate(v.date)}
                  value={money(v.amount)}
                />
              ))}
            </Group>
          )}
        </Section>
      )}
      {!closed && (
        <Form
          key={`${item.row.id}:${item.row.version}`}
          submit="Save row"
          initial={{
            date: String(p.date || "").slice(0, 10),
            description: p.description || "",
            label: p.label || "",
            amountIn: p.amountIn || "",
            amountOut: p.amountOut || "",
            categoryId: p.categoryId || "",
            accountIdentifier: p.accountIdentifier || "",
          }}
          fields={[
            { key: "date", label: "Date", type: "date", required: true },
            { key: "description", label: "Description", required: true },
            { key: "label", label: "Label", placeholder: "A friendlier name" },
            { key: "amountIn", label: "Money in", type: "number" },
            { key: "amountOut", label: "Money out", type: "number" },
            {
              key: "categoryId",
              label: "Category",
              options: [
                { label: "Unassigned", value: "" },
                ...categories.map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
              ],
            },
            {
              key: "accountIdentifier",
              label: "Account",
              hidden: !main,
              options: [
                { label: "No account", value: "" },
                ...accounts.map((a: any) => ({ label: accountDisplay(a), value: a.accountIdentifier, color: a.color })),
              ],
            },
          ]}
          onSave={async (v) => {
            const inV = v.amountIn === "" ? 0 : Number(v.amountIn);
            const outV = v.amountOut === "" ? 0 : Number(v.amountOut);
            if (inV < 0 || outV < 0 || (inV > 0 && outV > 0))
              throw new Error("Enter one positive money-in or money-out amount");
            await update((row: any) => ({
              currentPayload: {
                ...row.currentPayload,
                date: v.date,
                description: v.description,
                label: v.label || null,
                amountIn: inV || null,
                amountOut: outV || null,
                categoryId: v.categoryId || null,
                ...(main ? { accountIdentifier: v.accountIdentifier || null } : {}),
                ...(outV > 0 && row.currentPayload?.linkage?.type === "reimbursement" ? { linkage: null } : {}),
              },
            }));
            toast("Row saved");
            close();
          }}
        />
      )}
      {!!p.metadata && Object.keys(p.metadata).length > 0 && (
        <Section title="Source data">
          <Card style={{ gap: 8 }}>
            {Object.entries(p.metadata)
              .filter(([, v]) => v != null && typeof v !== "object")
              .map(([k, v]) => (
                <KeyValue key={k} label={humanize(k.replace(/([A-Z])/g, " $1").toLowerCase())} value={String(v)} />
              ))}
          </Card>
        </Section>
      )}
    </>
  );
}
export function ImportDetailScreen({ navigation, route }: any) {
  const result = useResource("getImportDetail", route.params.key);
  const d = result.data?.import;
  const accounts = useResource("getAccountNumbers");
  return (
    <Screen>
      <State {...result} />
      {d && (
        <>
          <Heading eyebrow="Statement" title={d.filename} subtitle={`${d.transactionCount} transactions`} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Pill icon="calendar-outline" label={`${fmtDate(d.startDate, false)} – ${fmtDate(d.endDate)}`} />
            {d.parserId && <Pill icon="document-text-outline" tone="purple" label={d.parserId} />}
            {d.importedAt && <Pill icon="time-outline" label={`Imported ${fmtDate(d.importedAt)}`} />}
          </View>
          <Summary summary={d} title="Net for this statement" />
          {d.dailySeries?.length > 0 && (
            <Section title="Daily cash flow">
              <Card>
                <ColumnChart
                  primaryLabel="Out"
                  secondaryLabel="In"
                  data={d.dailySeries.map((p: any) => ({
                    key: p.date,
                    label: fmtDate(p.date, false),
                    value: p.totalOut,
                    secondary: p.totalIn,
                  }))}
                />
              </Card>
            </Section>
          )}
          <Section title="Categories">
            <Card>
              <Donut
                centerLabel="Spent"
                data={(d.categoryBreakdown || []).map((c: any) => ({
                  key: c.key,
                  label: c.name,
                  value: c.totalOut,
                  color: c.color,
                }))}
              />
            </Card>
          </Section>
          <Section title="Accounts">
            <Group>
              {(d.accountBreakdown || []).map((a: any) => {
                const account = (accounts.data || []).find((x: any) => x.accountIdentifier === a.name);
                return (
                  <ListItem
                    key={a.key}
                    icon="card-outline"
                    color={account?.color}
                    title={account ? accountDisplay(account) : a.name}
                    subtitle={`${a.transactionCount} transactions`}
                    value={money(a.net)}
                    valueTone={a.net >= 0 ? "green" : undefined}
                  />
                );
              })}
            </Group>
          </Section>
          <Section
            title="Transactions"
            action="Open in Activity"
            onAction={() => navigation.navigate("Main", { screen: "Transactions", params: { search: d.filename } })}
          >
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {d.transactions.map((item: any) => (
                <TransactionRow
                  key={item.id}
                  item={item}
                  onPress={() => navigation.navigate("Transaction", { id: item.id, item })}
                />
              ))}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
