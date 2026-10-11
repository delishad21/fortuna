import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApi, usePaged, useResource } from "./api";
import {
  ActionMenu,
  Banner,
  BRAND,
  Button,
  Card,
  Checkbox,
  Choice,
  Chips,
  confirm,
  DateField,
  DateHeader,
  Dot,
  Empty,
  fmtDate,
  Footer,
  Form,
  Group,
  Heading,
  humanize,
  IconButton,
  Input,
  KeyValue,
  ListItem,
  money,
  moneyCode,
  MultiSelect,
  notice,
  Pill,
  plural,
  Screen,
  SearchBar,
  Section,
  Segmented,
  Sheet,
  State,
  styles,
  toast,
  TransactionRow,
  Txt,
  useTheme,
} from "./ui";
import { shareCsv } from "./sharing";
import { accountDisplay, accountName } from "../../frontend/shared/accounts";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
/** Filters as the transactions actions expect them (dates are revived on the server). */
const toQuery = (filters: any, search: string) => {
  const q: any = { ...filters, search: search || undefined };
  if (q.dateFrom) q.dateFrom = `${q.dateFrom}T00:00:00`;
  if (q.dateTo) q.dateTo = `${q.dateTo}T23:59:59`;
  if (!q.categoryIds?.length) delete q.categoryIds;
  return Object.fromEntries(
    Object.entries(q).filter(([, v]) => v !== "" && v != null),
  );
};
const filterCount = (f: any) =>
  ["dateFrom", "dateTo", "minAmount", "maxAmount", "accountIdentifier"].filter((k) => f[k] != null && f[k] !== "")
    .length + (f.categoryIds?.length ? 1 : 0) + (f.dateOrder === "asc" ? 1 : 0);

function FilterSheet({ visible, onClose, filters, onApply, categories, accounts }: any) {
  const [draft, setDraft] = useState<any>(filters);
  const years = useResource<number[]>("getTransactionYears");
  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);
  const set = (patch: any) => setDraft((d: any) => ({ ...d, ...patch }));
  const year = Number(String(draft.dateFrom || "").slice(0, 4)) || years.data?.[0] || new Date().getFullYear();
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter activity"
      footer={
        <View style={styles.row}>
          <Button
            title="Reset"
            secondary
            style={{ flex: 1 }}
            onPress={() => {
              onApply({});
              onClose();
            }}
          />
          <Button
            title="Apply filters"
            style={{ flex: 2 }}
            onPress={() => {
              if (draft.minAmount != null && draft.minAmount !== "" && !Number.isFinite(Number(draft.minAmount)))
                return Alert.alert("Minimum amount must be a number");
              if (draft.maxAmount != null && draft.maxAmount !== "" && !Number.isFinite(Number(draft.maxAmount)))
                return Alert.alert("Maximum amount must be a number");
              onApply({
                ...draft,
                minAmount: draft.minAmount === "" || draft.minAmount == null ? undefined : Number(draft.minAmount),
                maxAmount: draft.maxAmount === "" || draft.maxAmount == null ? undefined : Number(draft.maxAmount),
              });
              onClose();
            }}
          />
        </View>
      }
    >
      <Section title="Quick month">
        <Chips
          values={(years.data?.length ? years.data : [year]).map(String)}
          value={String(year)}
          onChange={(y) => {
            const m = Number(String(draft.dateFrom || "").slice(5, 7)) || 1;
            set({
              dateFrom: `${y}-${String(m).padStart(2, "0")}-01`,
              dateTo: `${y}-${String(m).padStart(2, "0")}-${lastDay(Number(y), m)}`,
            });
          }}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {MONTH_NAMES.map((name, i) => {
            const mm = String(i + 1).padStart(2, "0");
            const on =
              draft.dateFrom === `${year}-${mm}-01` &&
              draft.dateTo === `${year}-${mm}-${lastDay(year, i + 1)}`;
            return (
              <Button
                key={name}
                title={name}
                compact
                secondary={!on}
                style={{ width: "22%" }}
                onPress={() =>
                  set({ dateFrom: `${year}-${mm}-01`, dateTo: `${year}-${mm}-${lastDay(year, i + 1)}` })
                }
              />
            );
          })}
        </View>
      </Section>
      <View style={[styles.row, { alignItems: "flex-start" }]}>
        <View style={{ flex: 1 }}>
          <DateField label="From" value={draft.dateFrom || ""} onChange={(dateFrom) => set({ dateFrom })} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="To" value={draft.dateTo || ""} onChange={(dateTo) => set({ dateTo })} />
        </View>
      </View>
      <Section title="Type">
        <Segmented
          values={["", "income", "expense"]}
          labels={{ "": "All", income: "Money in", expense: "Money out" }}
          value={draft.transactionType || ""}
          onChange={(transactionType) => set({ transactionType: transactionType || undefined })}
        />
      </Section>
      <View style={[styles.row, { alignItems: "flex-start" }]}>
        <View style={{ flex: 1 }}>
          <Input
            label="Min amount"
            value={draft.minAmount == null ? "" : String(draft.minAmount)}
            keyboardType="decimal-pad"
            onChangeText={(minAmount: string) => set({ minAmount })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            label="Max amount"
            value={draft.maxAmount == null ? "" : String(draft.maxAmount)}
            keyboardType="decimal-pad"
            onChangeText={(maxAmount: string) => set({ maxAmount })}
          />
        </View>
      </View>
      <Choice
        label="Account"
        value={draft.accountIdentifier || ""}
        options={[
          { label: "All accounts", value: "" },
          ...(accounts || []).map((a: any) => ({
            label: accountDisplay(a),
            value: a.accountIdentifier,
            color: a.color,
          })),
        ]}
        onChange={(accountIdentifier) => set({ accountIdentifier: accountIdentifier || undefined })}
      />
      <Section title="Order">
        <Segmented
          values={["desc", "asc"]}
          labels={{ desc: "Newest first", asc: "Oldest first" }}
          value={draft.dateOrder || "desc"}
          onChange={(dateOrder) => set({ dateOrder })}
        />
      </Section>
      <Section title="Categories" hint="Leave all unticked to include every category.">
        <MultiSelect
          options={(categories || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color }))}
          value={draft.categoryIds || []}
          onChange={(categoryIds) => set({ categoryIds })}
        />
      </Section>
    </Sheet>
  );
}
function BulkSheet({ visible, onClose, kind, categories, onApply, count }: any) {
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState("");
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={kind === "date" ? "Change date" : "Set category"}
      subtitle={plural(count, "transaction")}
      footer={
        <Button
          title="Apply"
          disabled={kind === "date" ? !date : !categoryId}
          onPress={() => {
            onApply(kind === "date" ? { date } : { categoryId });
            onClose();
          }}
        />
      }
    >
      {kind === "date" ? (
        <DateField label="New date" value={date} onChange={setDate} />
      ) : (
        <Choice
          label="Category"
          value={categoryId}
          options={(categories || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color }))}
          onChange={setCategoryId}
        />
      )}
    </Sheet>
  );
}
export function TransactionsScreen({ navigation, route }: any) {
  const { call } = useApi();
  const { colors } = useTheme();
  const [search, setSearch] = useState(route.params?.search || "");
  const [query, setQuery] = useState(search);
  const [filters, setFilters] = useState<any>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [allFiltered, setAllFiltered] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"" | "category" | "date">("");
  useEffect(() => {
    if (route.params?.search != null) setSearch(route.params.search);
  }, [route.params?.search]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const q = toQuery(filters, query);
  const list = usePaged(
    "getTransactions",
    (offset, limit) => [{ ...q, limit, offset }],
    (d) => ({ items: d.transactions || [], total: d.total || 0 }),
    [q],
    50,
  );
  const categories = useResource("getCategories", { scope: "main" });
  const accounts = useResource("getAccountNumbers");
  const names = useMemo(
    () => Object.fromEntries((accounts.data || []).map((a: any) => [a.accountIdentifier, a.label || a.accountIdentifier])),
    [accounts.data],
  );
  const accountColors = useMemo(
    () => Object.fromEntries((accounts.data || []).map((a: any) => [a.accountIdentifier, a.color])),
    [accounts.data],
  );
  const sections = useMemo(() => {
    const out: { key: string; title: string; data: any[] }[] = [];
    for (const row of list.items) {
      const key = String(row.date || "").slice(0, 10);
      let last = out[out.length - 1];
      if (last?.key !== key) {
        last = { key, title: "", data: [] };
        out.push(last);
      }
      last.data.push(row);
    }
    return out;
  }, [list.items]);
  const count = allFiltered ? list.total - excluded.length : selected.length;
  const isSelected = (id: string) => (allFiltered ? !excluded.includes(id) : selected.includes(id));
  const toggle = (id: string) => {
    if (allFiltered)
      setExcluded((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
    else setSelected((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  };
  const endSelection = () => {
    setSelecting(false);
    setSelected([]);
    setAllFiltered(false);
    setExcluded([]);
  };
  const runBulk = async (updates: any) => {
    if (allFiltered) await call("bulkUpdateTransactionsByFilter", q, excluded, updates);
    else await call("bulkUpdateTransactionsByIds", selected, updates);
    toast(`Updated ${plural(count, "transaction")}`);
    endSelection();
    await list.reload();
  };
  const exportCsv = (scope: "selection" | "filtered") =>
    void call<string>(
      "exportTransactionsCsv",
      scope === "selection"
        ? allFiltered
          ? { filters: q, excludeIds: excluded }
          : { ids: selected }
        : { filters: q },
    )
      .then((csv) => shareCsv("fortuna-transactions.csv", csv))
      .catch(notice);
  const active = filterCount(filters);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.content, { gap: 0 }]}
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={list.loading && list.loaded} onRefresh={list.reload} />
        }
        ListHeaderComponent={
          <View style={[styles.stack, { marginBottom: 6 }]}>
            <Heading
              title={plural(list.total, "transaction")}
              right={
                <View style={[styles.row, { gap: 8 }]}>
                  <IconButton
                    icon={selecting ? "close" : "checkmark-circle-outline"}
                    label={selecting ? "Done selecting" : "Select"}
                    onPress={() => (selecting ? endSelection() : setSelecting(true))}
                  />
                  <ActionMenu
                    actions={[
                      { label: "Export filtered CSV", icon: "share-outline", onPress: () => exportCsv("filtered") },
                      { label: "Analytics", icon: "stats-chart-outline", onPress: () => navigation.navigate("Analytics") },
                      { label: "Import a statement", icon: "cloud-upload-outline", onPress: () => navigation.navigate("Import") },
                    ]}
                  />
                </View>
              }
            />
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder="Merchant, label or description"
              label="Search transactions"
            />
            <View style={[styles.row, { gap: 8 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filters"
                onPress={() => setShowFilters(true)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 8,
                  backgroundColor: active ? colors.tint : colors.card,
                  borderWidth: 1,
                  borderColor: active ? colors.purple : colors.line,
                }}
              >
                <Ionicons name="options-outline" size={16} color={active ? colors.purple : colors.muted} />
                <Txt bold size={13} style={{ color: active ? colors.purple : colors.muted }}>
                  Filters{active ? ` · ${active}` : ""}
                </Txt>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Chips
                  values={["", "income", "expense"]}
                  labels={{ "": "All", income: "Money in", expense: "Money out" }}
                  value={filters.transactionType || ""}
                  onChange={(t) => setFilters((f: any) => ({ ...f, transactionType: t || undefined }))}
                />
              </View>
            </View>
            {(filters.dateFrom || filters.dateTo || filters.categoryIds?.length || filters.accountIdentifier) && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {(filters.dateFrom || filters.dateTo) && (
                  <Pill icon="calendar-outline" tone="purple" label={`${fmtDate(filters.dateFrom) || "Start"} – ${fmtDate(filters.dateTo) || "now"}`} />
                )}
                {filters.categoryIds?.length > 0 && (
                  <Pill icon="pricetag-outline" tone="purple" label={`${filters.categoryIds.length} categor${filters.categoryIds.length === 1 ? "y" : "ies"}`} />
                )}
                {filters.accountIdentifier && (
                  <Pill icon="card-outline" tone="purple" label={names[filters.accountIdentifier] || filters.accountIdentifier} />
                )}
                <Pressable accessibilityRole="button" accessibilityLabel="Clear filters" onPress={() => setFilters({})}>
                  <Pill icon="close" tone="red" label="Clear" />
                </Pressable>
              </View>
            )}
            {selecting && (
              <Banner
                tone="purple"
                icon="checkmark-done-outline"
                title={`${count} selected`}
                message={allFiltered ? "Every transaction matching these filters, minus the ones you untick." : "Tap rows to select them, or select everything that matches."}
                action={allFiltered ? "Select none" : `Select all ${list.total} matching`}
                onAction={() => {
                  if (allFiltered) {
                    setAllFiltered(false);
                    setExcluded([]);
                    setSelected([]);
                  } else {
                    setAllFiltered(true);
                    setExcluded([]);
                  }
                }}
              />
            )}
            <State {...list} data={list.loaded ? true : null} />
          </View>
        }
        renderSectionHeader={({ section }) => <DateHeader date={section.key} />}
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.line,
              marginBottom: 8,
              overflow: "hidden",
            }}
          >
          <TransactionRow
            item={{ ...item, accountLabel: names[item.accountIdentifier], accountColor: accountColors[item.accountIdentifier] }}
            selectable={selecting}
            selected={selecting && isSelected(item.id)}
            onLongPress={() => {
              if (!selecting) {
                setSelecting(true);
                setSelected([item.id]);
              }
            }}
            onPress={() =>
              selecting ? toggle(item.id) : navigation.navigate("Transaction", { id: item.id, item })
            }
          />
          </View>
        )}
        ListEmptyComponent={
          list.loaded && !list.loading && !list.error ? (
            <Card>
              <Empty
                icon="search-outline"
                title="No transactions"
                message={query || active ? "Nothing matches these filters." : "Import a statement to get started."}
              />
            </Card>
          ) : null
        }
        ListFooterComponent={
          list.loadingMore ? (
            <ActivityIndicator style={{ padding: 20 }} color={BRAND} />
          ) : list.items.length && list.items.length >= list.total ? (
            <Txt muted size={12} style={{ textAlign: "center", padding: 16 }}>
              That’s everything.
            </Txt>
          ) : null
        }
      />
      {selecting && (
        <Footer inTab>
          <View style={[styles.row, { gap: 8 }]}>
            <Button compact secondary icon="pricetag-outline" title="Category" style={{ flex: 1 }} disabled={!count} onPress={() => setBulk("category")} />
            <Button compact secondary icon="calendar-outline" title="Date" style={{ flex: 1 }} disabled={!count} onPress={() => setBulk("date")} />
            <Button compact secondary icon="share-outline" title="Export" style={{ flex: 1 }} disabled={!count} onPress={() => exportCsv("selection")} />
            <IconButton
              icon="trash-outline"
              label="Delete selected"
              tone="red"
              disabled={!count}
              onPress={() =>
                confirm("Delete transactions?", `Permanently delete ${plural(count, "transaction")}.`, async () => {
                  if (allFiltered) await call("bulkDeleteTransactionsByFilter", q, excluded);
                  else await call("bulkDeleteTransactionsByIds", selected);
                  toast(`Deleted ${plural(count, "transaction")}`);
                  endSelection();
                  await list.reload();
                }, "Delete")
              }
            />
          </View>
        </Footer>
      )}
      <FilterSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onApply={setFilters}
        categories={categories.data}
        accounts={accounts.data}
      />
      <BulkSheet
        visible={!!bulk}
        kind={bulk}
        count={count}
        categories={categories.data}
        onClose={() => setBulk("")}
        onApply={(updates: any) =>
          confirm("Update transactions?", `Apply this change to ${plural(count, "transaction")}.`, () => runBulk(updates))
        }
      />
    </View>
  );
}
type LinkKind = "none" | "internal" | "reimbursement";
export function TransactionScreen({ navigation, route }: any) {
  const id = route.params.id || route.params.item?.id;
  const { call } = useApi();
  const { colors } = useTheme();
  const tx = useResource("getTransaction", id);
  const links = useResource("getLinkedTransactions", id);
  const categories = useResource("getCategories", { scope: "main" });
  const accounts = useResource("getAccountNumbers");
  const [editing, setEditing] = useState(false);
  const [showMeta, setShowMeta] = useState(false);
  const t = tx.data || route.params.item;
  if (!t)
    return (
      <Screen>
        <State {...tx} />
      </Screen>
    );
  const amountIn = Number(t.amountIn || 0);
  const amountOut = Number(t.amountOut || 0);
  const income = amountIn > 0;
  const kind: LinkKind =
    t.linkage?.type === "internal" ? "internal" : t.linkage?.type === "reimbursement" ? "reimbursement" : "none";
  const reimburses = links.data?.reimburses || [];
  const reimbursedBy = links.data?.reimbursedBy || [];
  const reimbursedTotal = reimbursedBy.reduce((s: number, r: any) => s + Number(r.reimbursementAmount || 0), 0);
  const linkedTotal = reimburses.reduce((s: number, r: any) => s + Number(r.reimbursementAmount || 0), 0);
  const reload = async () => {
    await Promise.all([tx.reload(), links.reload()]);
  };
  const setKind = (next: LinkKind) => {
    if (next === kind) return;
    const linkage =
      next === "internal"
        ? { type: "internal", autoDetected: false }
        : next === "reimbursement"
          ? { type: "reimbursement", leftoverCategoryId: null }
          : null;
    const apply = async () => {
      await call("updateTransaction", t.id, { linkage });
      toast(next === "none" ? "Link removed" : `Marked as ${next}`);
      await reload();
      if (next === "reimbursement") openPicker("expenses");
    };
    if (kind === "reimbursement" && (reimburses.length || linkedTotal))
      confirm("Change link type?", "This removes the expenses this reimbursement is linked to.", apply);
    else void apply().catch(notice);
  };
  const openPicker = (mode: "expenses" | "reimbursements") =>
    navigation.navigate("LinkPicker", {
      subject: { transactionId: t.id },
      mode,
      title: t.label || t.description,
      leftoverCategoryId: t.linkage?.leftoverCategoryId ?? null,
    });
  const category = t.category;
  const account = (accounts.data || []).find((a: any) => a.accountIdentifier === t.accountIdentifier);
  const metadata = Object.entries(t.metadata || {}).filter(
    ([k, v]) => v != null && v !== "" && typeof v !== "object" && !["parserId"].includes(k),
  );
  return (
    <Screen refreshControl={<RefreshControl refreshing={tx.loading && !!tx.data} onRefresh={reload} />}>
      <Card style={{ gap: 8 }}>
        <View style={[styles.between, { alignItems: "flex-start" }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt bold size={18}>
              {t.label || t.description}
            </Txt>
            {!!t.label && (
              <Txt muted size={13}>
                {t.description}
              </Txt>
            )}
          </View>
          <Txt mono size={20} style={{ color: kind === "internal" ? colors.muted : income ? colors.green : colors.red }}>
            {income ? "+" : "-"}
            {moneyCode(income ? amountIn : amountOut, t.currency || "SGD")}
          </Txt>
        </View>
        <View style={[styles.row, { gap: 6, flexWrap: "wrap" }]}>
          <Dot color={category?.color || colors.faint} size={8} />
          <Txt muted size={13}>
            {category?.name || "Uncategorized"} · {fmtDate(t.date)}
          </Txt>
          {kind === "internal" && <Pill tone="blue" label="Internal" />}
          {kind === "reimbursement" && <Pill tone="green" label="Reimbursement" />}
          {reimbursedBy.length > 0 && <Pill tone="green" label="Reimbursed" />}
          {t.metadata?.splitFromTransactionId && <Pill tone="amber" label="Split" />}
        </View>
      </Card>
      <View style={[styles.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button title="Edit" compact secondary icon="create-outline" onPress={() => setEditing(true)} />
        <Button
          title="Split"
          compact
          secondary
          icon="cut-outline"
          onPress={() =>
            kind === "reimbursement" || reimbursedBy.length
              ? Alert.alert(
                  "Can’t split this yet",
                  "Reimbursement transactions cannot be split. Remove the reimbursement links first, then link the split transactions.",
                )
              : navigation.navigate("Split", { item: t })
          }
        />
        <Button
          title={income ? "Pays back" : "Reimbursed by"}
          compact
          secondary
          icon="link-outline"
          onPress={() =>
            income ? (kind === "reimbursement" ? openPicker("expenses") : setKind("reimbursement")) : openPicker("reimbursements")
          }
        />
        <Button
          title="Delete"
          compact
          secondary
          danger
          icon="trash-outline"
          onPress={() =>
            confirm("Delete transaction?", "This permanently removes the transaction.", async () => {
              await call("deleteTransaction", t.id);
              toast("Transaction deleted");
              navigation.goBack();
            }, "Delete")
          }
        />
      </View>
      <Section title="Details">
        <Card style={{ gap: 12 }}>
          <KeyValue label="Date" value={fmtDate(t.date)} />
          <KeyValue label="Category" value={category?.name || "Uncategorized"} />
          <KeyValue label="Account" value={account ? accountDisplay(account) : t.accountIdentifier || "No account"} />
          {t.balance != null && <KeyValue label="Balance" mono value={money(t.balance, t.currency)} />}
          {!!t.currency && <KeyValue label="Currency" value={t.currency} />}
          {!!(t.importBatch?.filename || t.metadata?.sourceFilename) && (
            <KeyValue label="Statement" value={t.importBatch?.filename || t.metadata?.sourceFilename} />
          )}
          {!!(t.importBatch?.parserId || t.metadata?.parserId) && (
            <KeyValue label="Parser" value={t.importBatch?.parserId || t.metadata?.parserId} />
          )}
        </Card>
      </Section>
      <Section title="Reconciliation"      >
        <Segmented
          values={income ? ["none", "internal", "reimbursement"] : ["none", "internal"]}
          labels={{ none: "None", internal: "Internal", reimbursement: "Reimbursement" }}
          value={kind}
          onChange={(v) => setKind(v as LinkKind)}
        />
        {kind === "reimbursement" && (
          <Card style={{ gap: 10 }}>
            <View style={styles.between}>
              <Txt bold>Pays back</Txt>
              <Txt mono size={13} muted>
                {money(linkedTotal)} of {money(amountIn)}
              </Txt>
            </View>
            {reimburses.length === 0 && <Txt muted size={13}>Not linked to any expense yet.</Txt>}
            {reimburses.map((r: any) => (
              <LinkedRow key={r.id} item={r} onPress={() => navigation.push("Transaction", { id: r.id })} />
            ))}
            <Button title={reimburses.length ? "Edit links" : "Choose expenses"} compact secondary icon="link-outline" onPress={() => openPicker("expenses")} />
          </Card>
        )}
        {!income && (
          <Card style={{ gap: 10 }}>
            <View style={styles.between}>
              <Txt bold>Reimbursed by</Txt>
              <Txt mono size={13} muted>
                {money(reimbursedTotal)} of {money(amountOut)}
              </Txt>
            </View>
            {reimbursedBy.length === 0 && <Txt muted size={13}>Nothing has paid this back yet.</Txt>}
            {reimbursedBy.map((r: any) => (
              <LinkedRow key={r.id} item={r} onPress={() => navigation.push("Transaction", { id: r.id })} />
            ))}
            <Button title="Reimbursed by…" compact secondary icon="link-outline" onPress={() => openPicker("reimbursements")} />
          </Card>
        )}
      </Section>
      {(t.tripEntries?.length > 0 || t.tripFundings?.length > 0) && (
        <Section title="Trips">
          <Group>
            {[...(t.tripEntries || []), ...(t.tripFundings || [])].map((e: any) => (
              <ListItem
                key={e.id}
                icon="airplane-outline"
                title={e.trip?.name || "Trip record"}
                subtitle={e.type ? humanize(e.type) : "Funding"}
                onPress={e.tripId || e.trip?.id ? () => navigation.navigate("Trip", { tripId: e.tripId || e.trip?.id }) : undefined}
              />
            ))}
          </Group>
        </Section>
      )}
      {metadata.length > 0 && (
        <Section title="Source data" action={showMeta ? "Hide" : "Show"} onAction={() => setShowMeta(!showMeta)}>
          {showMeta && (
            <Card style={{ gap: 10 }}>
              {metadata.map(([k, v]) => (
                <KeyValue key={k} label={humanize(k.replace(/([A-Z])/g, " $1").toLowerCase())} value={String(v)} />
              ))}
            </Card>
          )}
        </Section>
      )}
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit transaction">
        <Form
          key={`${t.id}:${t.updatedAt}`}
          initial={{
            description: t.description,
            label: t.label || "",
            date: String(t.date).slice(0, 10),
            amountIn: amountIn || "",
            amountOut: amountOut || "",
            categoryId: t.categoryId || t.category?.id || "",
            accountIdentifier: t.accountIdentifier || "",
            balance: t.balance ?? "",
          }}
          fields={[
            { key: "description", label: "Description", required: true },
            { key: "label", label: "Label", placeholder: "A friendlier name" },
            { key: "date", label: "Date", type: "date", required: true },
            { key: "amountIn", label: "Money in", type: "number" },
            { key: "amountOut", label: "Money out", type: "number" },
            {
              key: "categoryId",
              label: "Category",
              hidden: kind !== "none",
              options: [
                { label: "Uncategorized", value: "" },
                ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
              ],
            },
            {
              key: "accountIdentifier",
              label: "Account",
              options: [
                { label: "No account", value: "" },
                ...(accounts.data || []).map((a: any) => ({ label: accountDisplay(a), value: a.accountIdentifier, color: a.color })),
              ],
            },
            { key: "balance", label: "Balance after (optional)", type: "number" },
          ]}
          onSave={async (v) => {
            const inV = v.amountIn === "" ? 0 : Number(v.amountIn);
            const outV = v.amountOut === "" ? 0 : Number(v.amountOut);
            if (inV < 0 || outV < 0 || (inV > 0 && outV > 0) || !(inV > 0 || outV > 0))
              throw new Error("Enter one positive money-in or money-out amount");
            if (kind === "reimbursement" && outV > 0)
              throw new Error("A reimbursement must stay money in. Remove the reimbursement first.");
            await call("updateTransaction", t.id, {
              description: v.description,
              label: v.label || null,
              date: v.date,
              amountIn: inV || null,
              amountOut: outV || null,
              ...(kind === "none" ? { categoryId: v.categoryId || null } : {}),
              accountIdentifier: v.accountIdentifier || null,
              balance: v.balance === "" || v.balance == null ? null : Number(v.balance),
            });
            setEditing(false);
            toast("Transaction saved");
            await reload();
          }}
        >
          {kind !== "none" && (
            <Txt muted size={12}>
              The category follows the {kind === "internal" ? "internal transfer" : "reimbursement"} link.
            </Txt>
          )}
        </Form>
      </Sheet>
    </Screen>
  );
}
function LinkedRow({ item, onPress }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label || item.description}
      onPress={onPress}
      style={[styles.between, { paddingVertical: 6 }]}
    >
      <View style={{ flex: 1 }}>
        <Txt numberOfLines={1}>{item.label || item.description}</Txt>
        <Txt muted size={12}>
          {fmtDate(item.date)} · {money(item.amountOut || item.amountIn)}
        </Txt>
      </View>
      <Txt mono size={13} tone="green">
        {money(item.reimbursementAmount)}
      </Txt>
    </Pressable>
  );
}
export function SplitScreen({ navigation, route }: any) {
  const { item } = route.params;
  const { call } = useApi();
  const categories = useResource("getCategories", { scope: "main" });
  const field = Number(item.amountIn) > 0 ? "amountIn" : "amountOut";
  const total = Number(item[field]);
  const [parts, setParts] = useState<any[]>([
    { description: item.description, label: item.label || "", amount: "", categoryId: item.categoryId || item.category?.id || "" },
    { description: item.description, label: "", amount: "", categoryId: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const first = Number(parts[0].amount || 0);
  const second = Math.round((total - first) * 100) / 100;
  const update = (i: number, patch: any) =>
    setParts((old) => old.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const valid = first > 0 && second > 0 && parts.every((p) => p.description.trim());
  return (
    <Screen
      footer={
        <Button
          title={busy ? "Splitting…" : "Confirm split"}
          icon="cut-outline"
          loading={busy}
          disabled={busy || !valid}
          onPress={async () => {
            setBusy(true);
            try {
              await call(
                "splitTransaction",
                item.id,
                parts.map((p, i) => ({
                  description: p.description.trim(),
                  label: p.label.trim() || undefined,
                  categoryId: p.categoryId || null,
                  [field]: i === 0 ? first : second,
                })),
              );
              toast("Transaction split in two");
              navigation.pop(2);
            } catch (err) {
              notice(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      }
    >
      <Heading title="Split transaction" subtitle={item.label || item.description} />
      <Card style={{ gap: 6 }}>
        <KeyValue label="Original" mono value={money(total)} />
        <KeyValue label="Part 1" mono value={money(first)} />
        <KeyValue label="Part 2" mono value={money(second)} tone={second > 0 ? undefined : "red"} />
      </Card>
      {parts.map((part, i) => (
        <Card key={i}>
          <Txt bold size={16}>
            Part {i + 1}
          </Txt>
          <Input label="Description" value={part.description} onChangeText={(v: string) => update(i, { description: v })} />
          <Input label="Label" value={part.label} placeholder="Optional" onChangeText={(v: string) => update(i, { label: v })} />
          {i === 0 ? (
            <Input
              label="Amount"
              value={part.amount}
              keyboardType="decimal-pad"
              hint={`Part 2 gets the remaining ${money(Math.max(second, 0))}.`}
              onChangeText={(v: string) => update(i, { amount: v })}
            />
          ) : (
            <KeyValue label="Amount" mono value={money(second)} />
          )}
          <Choice
            label="Category"
            value={part.categoryId}
            options={[
              { label: "Uncategorized", value: "" },
              ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
            ]}
            onChange={(v) => update(i, { categoryId: v })}
          />
        </Card>
      ))}
    </Screen>
  );
}
const EPS = 0.005;
const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
const endOf = (key: string) =>
  key.startsWith("t:") ? { transactionId: key.slice(2) } : { draftRowId: key.slice(2) };
/**
 * Choose what a reimbursement pays back ("expenses"), or what paid an expense
 * back ("reimbursements"). Works for saved transactions and staged rows.
 */
export function LinkPickerScreen({ navigation, route }: any) {
  const { subject, mode, title, currentDraftId, contextDraftIds, leftoverCategoryId } = route.params;
  const { call } = useApi();
  const { colors } = useTheme();
  const lookingFor = mode === "expenses" ? "expense" : "reimbursement";
  const subjectIsSaved = "transactionId" in subject;
  const [tab, setTab] = useState(currentDraftId && !subjectIsSaved ? "import" : "saved");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<any>(null);
  const [saved, setSaved] = useState<any[]>([]);
  const [known, setKnown] = useState<Map<string, any>>(new Map());
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [leftover, setLeftover] = useState(leftoverCategoryId || "");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const categories = useResource("getCategories", { scope: "settings" });
  const [narrow, setNarrow] = useState<{ categoryId: string | null; dateFrom: string; dateTo: string; sameAmount: boolean }>(
    { categoryId: null, dateFrom: "", dateTo: "", sameAmount: false },
  );
  const [showFilters, setShowFilters] = useState(false);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const load = async (offset: number, q: string) => {
    const id = ++requestId.current;
    const f = narrowRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await call("getReimbursementCandidates", {
        subject,
        lookingFor,
        query: q,
        limit: 30,
        offset,
        contextDraftIds: contextDraftIds?.length ? contextDraftIds : undefined,
        ...(f.categoryId !== null ? { categoryId: f.categoryId } : {}),
        ...(f.dateFrom ? { dateFrom: f.dateFrom } : {}),
        ...(f.dateTo ? { dateTo: f.dateTo } : {}),
        ...(f.sameAmount && data?.subject.amount ? { amountEquals: data.subject.amount } : {}),
      });
      if (id !== requestId.current) return;
      setData(result);
      setSaved((old) => (offset ? [...old, ...result.saved.items] : result.saved.items));
      setKnown((old) => {
        const next = new Map(old);
        [...result.saved.items, ...result.staged].forEach((c: any) => next.set(c.key, c));
        return next;
      });
    } catch (e: any) {
      if (id === requestId.current) setError(e.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load(0, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() !== query) {
        setQuery(search.trim());
        void load(0, search.trim());
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => {
    if (data) void load(0, query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrow]);
  const readOnly = subjectIsSaved ? (data?.subject.linked || []).filter((l: any) => l.key.startsWith("r:")) : [];
  useEffect(() => {
    if (!data || initialized) return;
    const initial = new Map<string, number>(
      data.subject.linked
        .filter((l: any) => !(subjectIsSaved && l.key.startsWith("r:")))
        .map((l: any) => [l.key, Number(l.amount)]),
    );
    setSelection(initial);
    setInputs(Object.fromEntries([...initial].map(([k, v]) => [k, String(v)])));
    setInitialized(true);
  }, [data, initialized, subjectIsSaved]);
  const subjectAmount = Number(data?.subject.amount || 0);
  const allocated = round2([...selection.values()].reduce((s, v) => s + v, 0));
  const remaining = round2(subjectAmount - allocated);
  const capFor = (key: string, current = selection.get(key) || 0) => {
    const c = known.get(key);
    return round2(Math.max(Math.min(c ? Number(c.available) : current, remaining + current), 0));
  };
  const setAmount = (key: string, raw: string) => {
    setInputs((old) => ({ ...old, [key]: raw }));
    const value = Number(raw || 0);
    setSelection((old) => {
      const next = new Map(old);
      next.set(key, Number.isFinite(value) ? Math.max(0, value) : 0);
      return next;
    });
  };
  const toggle = (c: any) => {
    if (selection.has(c.key)) {
      setSelection((old) => {
        const next = new Map(old);
        next.delete(c.key);
        return next;
      });
      return;
    }
    if (c.fullyAllocated) return;
    const amount = round2(Math.max(Math.min(Number(c.available), remaining), 0));
    if (!(amount > 0)) return Alert.alert("Nothing left to link", "The full amount is already allocated.");
    setSelection((old) => new Map(old).set(c.key, amount));
    setInputs((old) => ({ ...old, [c.key]: String(amount) }));
  };
  const staged: any[] = data?.staged || [];
  const inImport = staged.filter((c) => currentDraftId && c.draftId === currentDraftId);
  const elsewhere = staged.filter((c) => !currentDraftId || c.draftId !== currentDraftId);
  const visible = tab === "saved" ? saved : tab === "import" ? inImport : elsewhere;
  const tabs = ["saved", ...(currentDraftId ? ["import"] : []), "staged"];
  const roleProblem = data?.subject.roleProblem;
  const overCap = [...selection].some(([k, v]) => {
    const c = known.get(k);
    return c && v > Number(c.available) + EPS;
  });
  return (
    <Screen
      footer={
        <>
          {!!error && <Txt tone="red" size={13}>{error}</Txt>}
          <Button
            title="Save links"
            icon="link-outline"
            loading={busy}
            disabled={busy || !data || !!roleProblem || remaining < -EPS || overCap}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await call("setReimbursementLinks", {
                  subject,
                  role: mode === "expenses" ? "reimbursement" : "expense",
                  links: [...selection]
                    .filter(([, amount]) => amount > 0)
                    .map(([key, amount]) => ({ other: endOf(key), amount: round2(amount) })),
                  ...(mode === "expenses" ? { leftoverCategoryId: leftover || null } : {}),
                  contextDraftIds,
                });
                toast("Links saved");
                if (result.warnings?.length) Alert.alert("Saved with warnings", result.warnings.join("\n"));
                navigation.goBack();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      }
    >
      <Heading
        title={mode === "expenses" ? "What does this pay back?" : "What reimbursed this?"}
        subtitle={`${title} · ${money(subjectAmount)}`}
      />
      {!!roleProblem && (
        <Banner tone="amber" icon="warning-outline" message={`${roleProblem}. Save the transaction first, then link it.`} />
      )}
      <Card style={{ gap: 8 }}>
        <KeyValue label={mode === "expenses" ? "Reimbursement" : "Expense"} mono value={money(subjectAmount)} />
        <KeyValue label="Linked" mono value={money(allocated)} />
        <KeyValue
          label={mode === "expenses" ? "Left over" : "Not reimbursed"}
          mono
          tone={remaining < -EPS ? "red" : "purple"}
          value={money(remaining)}
        />
        {(data?.subject.pending || []).map((p: any) => (
          <Txt key={p.filename} size={12} tone="amber">
            {money(p.amount)} pending in {p.filename}
          </Txt>
        ))}
      </Card>
      {mode === "expenses" && (
        <Choice
          label="Category for what is left over"
          value={leftover}
          options={[
            { label: "Uncategorized", value: "" },
            ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
          ]}
          onChange={setLeftover}
        />
      )}
      {(selection.size > 0 || readOnly.length > 0) && (
        <Section title={`Linked (${selection.size})`}>
          {[...selection].map(([key, amount]) => {
            const c = known.get(key);
            const linked = data?.subject.linked.find((l: any) => l.key === key);
            const name = c ? c.label || c.description : linked?.label || linked?.description || "Transaction";
            const cap = capFor(key, amount);
            return (
              <Card key={key} style={{ gap: 10, padding: 14 }}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Txt bold numberOfLines={1}>
                      {name}
                    </Txt>
                    <Txt muted size={12}>
                      {fmtDate(c?.date || linked?.date)}
                      {c?.filename || linked?.filename ? ` · ${c?.filename || linked?.filename}` : ""}
                      {c ? ` · ${money(c.amount)}` : ""}
                    </Txt>
                  </View>
                  <IconButton
                    icon="close"
                    label={`Remove ${name}`}
                    size={32}
                    onPress={() =>
                      setSelection((old) => {
                        const next = new Map(old);
                        next.delete(key);
                        return next;
                      })
                    }
                  />
                </View>
                <View style={[styles.row, { gap: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Input
                      value={inputs[key] ?? String(amount)}
                      keyboardType="decimal-pad"
                      accessibilityLabel={`Amount for ${name}`}
                      onChangeText={(v: string) => setAmount(key, v)}
                    />
                  </View>
                  <Button title="Max" compact secondary onPress={() => setAmount(key, String(cap))} />
                </View>
                <Txt muted size={12} tone={c && amount > Number(c.available) + EPS ? "red" : undefined}>
                  Up to {money(cap)}
                </Txt>
              </Card>
            );
          })}
          {readOnly.map((l: any) => (
            <Banner
              key={l.key}
              tone="neutral"
              icon="time-outline"
              title={l.label || l.description}
              message={`${money(l.amount)} pending in ${l.filename || "a staged import"}. Change it in that import.`}
            />
          ))}
        </Section>
      )}
      <Section title="Find transactions">
        <Segmented
          values={tabs}
          labels={{
            saved: `Saved ${data?.saved.total ?? ""}`.trim(),
            import: `This import ${inImport.length}`,
            staged: `${currentDraftId ? "Other staged" : "Staged"} ${elsewhere.length}`,
          }}
          value={tab}
          onChange={setTab}
        />
        <View style={[styles.row, { gap: 8 }]}>
          <View style={{ flex: 1 }}>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search label or description" />
          </View>
          <IconButton
            icon="options-outline"
            label="Filter candidates"
            tone={narrow.categoryId !== null || narrow.dateFrom || narrow.dateTo ? "purple" : "neutral"}
            onPress={() => setShowFilters(true)}
          />
        </View>
        <Chips
          values={["off", "on"]}
          labels={{ off: "Any amount", on: `Same amount (${money(subjectAmount)})` }}
          value={narrow.sameAmount ? "on" : "off"}
          onChange={(v) => setNarrow((n) => ({ ...n, sameAmount: v === "on" }))}
        />
        {loading && !data && <ActivityIndicator color={BRAND} style={{ padding: 20 }} />}
        {visible.length === 0 && !loading && (
          <Card>
            <Empty
              icon="search-outline"
              title="Nothing to link here"
              message={
                mode === "expenses"
                  ? "No expenses to link here."
                  : "No reimbursements here. Mark the money-in transaction as a reimbursement first."
              }
            />
          </Card>
        )}
        <Group>
          {visible.map((c: any) => {
            const on = selection.has(c.key);
            const blocked = c.fullyAllocated && !on;
            const exact = Math.abs(Number(c.amount) - subjectAmount) < EPS;
            return (
              <Pressable
                key={c.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: blocked || !!roleProblem }}
                accessibilityLabel={c.label || c.description}
                disabled={blocked || !!roleProblem}
                onPress={() => toggle(c)}
                style={{
                  flexDirection: "row",
                  gap: 12,
                  padding: 14,
                  alignItems: "center",
                  opacity: blocked ? 0.5 : 1,
                  backgroundColor: on ? colors.tint : "transparent",
                }}
              >
                <Checkbox checked={on} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt bold numberOfLines={1}>
                    {c.label || c.description}
                  </Txt>
                  {!!c.label && (
                    <Txt muted size={12} numberOfLines={1}>
                      {c.description}
                    </Txt>
                  )}
                  <Txt muted size={12}>
                    {fmtDate(c.date)}
                    {c.filename ? ` · ${c.filename} row ${(c.rowIndex ?? 0) + 1}` : ""}
                  </Txt>
                  {c.pending?.length > 0 && (
                    <Txt size={12} tone="amber">
                      {c.pending.map((p: any) => `${money(p.amount)} pending in ${p.filename}`).join(" · ")}
                    </Txt>
                  )}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Txt mono size={14}>
                    {money(c.amount)}
                  </Txt>
                  {blocked ? (
                    <Pill label="Fully allocated" />
                  ) : (
                    <Txt muted size={11}>
                      {money(c.available)} free
                    </Txt>
                  )}
                  {exact && <Pill label="Same amount" tone="green" />}
                </View>
              </Pressable>
            );
          })}
        </Group>
        {tab === "saved" && data && saved.length < data.saved.total && (
          <Button title={loading ? "Loading…" : "Show more"} compact ghost disabled={loading} onPress={() => void load(saved.length, query)} />
        )}
      </Section>
      <Sheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        title="Filter candidates"
        footer={
          <View style={styles.row}>
            <Button
              title="Reset"
              secondary
              style={{ flex: 1 }}
              onPress={() => {
                setNarrow({ categoryId: null, dateFrom: "", dateTo: "", sameAmount: false });
                setShowFilters(false);
              }}
            />
            <Button title="Done" style={{ flex: 2 }} onPress={() => setShowFilters(false)} />
          </View>
        }
      >
        <Choice
          label="Category"
          value={narrow.categoryId === null ? "__all__" : narrow.categoryId || "__none__"}
          options={[
            { label: "All categories", value: "__all__" },
            { label: "Uncategorized", value: "__none__" },
            ...(categories.data || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
          ]}
          onChange={(v) =>
            setNarrow((n) => ({ ...n, categoryId: v === "__all__" ? null : v === "__none__" ? "" : v }))
          }
        />
        <DateField label="From" value={narrow.dateFrom} onChange={(dateFrom) => setNarrow((n) => ({ ...n, dateFrom }))} />
        <DateField label="To" value={narrow.dateTo} onChange={(dateTo) => setNarrow((n) => ({ ...n, dateTo }))} />
      </Sheet>
    </Screen>
  );
}
