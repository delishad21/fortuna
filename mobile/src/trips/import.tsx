import React, { useMemo, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApi, useResource } from "../api";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Chips,
  Choice,
  Empty,
  fmtDate,
  Footer,
  Group,
  Heading,
  humanize,
  IconButton,
  Input,
  KeyValue,
  ListItem,
  money,
  moneyCode,
  notice,
  Pill,
  Screen,
  SearchBar,
  Section,
  Segmented,
  Sheet,
  State,
  styles,
  toast,
  Txt,
  useTheme,
} from "../ui";
import { FILE_TYPES } from "../imports";
import { appendFile } from "../upload";
import { FundingOutFields, fundingOutFromMetadata, emptyFundingOut } from "./common";

const ROUTED = ["revolut_statement", "youtrip_statement"];
const REASONS: Record<string, string> = {
  account_holder_unknown: "Account holder unknown",
  counterparty_unclear: "Counterparty unclear",
  counterparty_name_partial_match: "Counterparty only partly matches",
  pending: "Pending transaction",
  pdf_row_not_in_csv: "In the PDF but not the CSV",
};
type Row = Record<string, any>;
const meta = (r: Row) => (r.metadata && typeof r.metadata === "object" ? r.metadata : {});
const kindOf = (r: Row) => String(meta(r).transactionType || "").trim().toLowerCase();
const isConversion = (r: Row) => kindOf(r) === "conversion";
const currencyOf = (r: Row, base: string) => String(meta(r).currency || meta(r).statementCurrency || base).toUpperCase();
const amountOf = (r: Row) => Number(r.amountOut || 0) || Number(r.amountIn || 0);
const isFundingIn = (r: Row) =>
  r.entryTypeOverride === "funding_in" || (kindOf(r) === "topup" && meta(r).fundingInDisabled !== true);
const conversionResolved = (r: Row) => {
  if (!isConversion(r) || r.entryTypeOverride === "funding_out") return true;
  const review = meta(r).conversionReview || {};
  return ["internal", "skip_duplicate"].includes(review.mode) || (review.mode === "link_existing" && !!review.linkedFundingId);
};
const checksOf = (r: Row) => {
  const m = meta(r);
  const reasons = (Array.isArray(m.reviewReasons) ? m.reviewReasons : []).map((x: string) => REASONS[x] || humanize(x));
  const warnings = (Array.isArray(m.parseWarnings) ? m.parseWarnings : []).map((x: any) => humanize(typeof x === "string" ? x : x?.code || x?.message));
  if (!reasons.length && m.needsReview === true) reasons.push("Flagged by the parser");
  return [...reasons, ...warnings];
};
/** Mirrors the web normalisation: top-ups become funding in, conversions need a decision. */
const normalize = (rows: Row[], base: string, filename: string, parserId: string) =>
  rows.map((tx) => {
    const m: Record<string, any> = { ...meta(tx), sourceFilename: filename, parserId };
    const type = String(m.transactionType || "").toLowerCase();
    const net = Number(tx.amountIn || 0) - Number(m.feeAmount || 0);
    const label =
      tx.label && String(tx.label).trim()
        ? tx.label
        : type === "topup" && net > 0
          ? `Top up of (${String(m.currency || base).toUpperCase()}) ${net.toFixed(2)}`
          : undefined;
    if (type === "conversion" && tx.entryTypeOverride !== "funding_out" && !m.conversionReview)
      m.conversionReview = { mode: "unreviewed", linkedFundingId: null };
    return {
      ...tx,
      label,
      entryTypeOverride: tx.entryTypeOverride || (type === "topup" && m.fundingInDisabled !== true ? "funding_in" : undefined),
      metadata: m,
    };
  });
export function TripImportScreen({ route, navigation }: any) {
  const { tripId } = route.params;
  const { call, parse } = useApi();
  const { colors } = useTheme();
  const trip = useResource("getTrip", tripId);
  const base = trip.data?.baseCurrency || route.params.trip?.baseCurrency || "SGD";
  const parsers = useResource("getAvailableParsers", "trip");
  const wallets = useResource("getWallets", tripId);
  const categories = useResource("getCategories", { scope: "trips" });
  const fundings = useResource("getTripFundings", tripId);
  const list: any[] = Array.isArray(parsers.data) ? parsers.data : parsers.data?.parsers || [];
  const [parserId, setParserId] = useState("");
  const [walletId, setWalletId] = useState(route.params.walletId || "");
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [supplement, setSupplement] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("All");
  const [editing, setEditing] = useState<number | null>(null);
  const routed = ROUTED.includes(parserId);
  const pick = async (extra = false) => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: !extra, copyToCacheDirectory: true, type: FILE_TYPES });
    if (result.canceled) return;
    if (extra) setSupplement(result.assets[0]);
    else setFiles((old) => [...old, ...result.assets]);
  };
  const read = async () => {
    setBusy(true);
    setMessage("");
    const all: Row[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const form = new FormData();
        await appendFile(form, "file", file);
        form.append("parserId", parserId);
        if (supplement && parserId === "revolut_statement" && files.length === 1) await appendFile(form, "supplementalFile", supplement);
        const result = await parse(form);
        if (!result?.success) throw new Error(result?.error || "Could not read this file");
        all.push(...normalize(result.transactions || [], base, file.name, parserId));
      } catch (e: any) {
        failures.push(`${file.name}: ${e.message}`);
      }
    }
    setBusy(false);
    if (failures.length) setMessage(failures.join("\n"));
    if (!all.length) return;
    all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setRows(all);
    setSelected(new Set(all.map((_, i) => i)));
  };
  const update = (index: number, fn: (r: Row) => Row) =>
    setRows((old) => (old ? old.map((r, i) => (i === index ? fn(r) : r)) : old));
  const setMeta = (index: number, fn: (m: Record<string, any>) => void) =>
    update(index, (r) => {
      const m = { ...meta(r) };
      fn(m);
      return { ...r, metadata: m };
    });
  const counts = useMemo(() => {
    const r = rows || [];
    return {
      All: r.length,
      Checks: r.filter((x) => checksOf(x).length).length,
      Conversions: r.filter(isConversion).length,
      Funding: r.filter((x) => isFundingIn(x) || x.entryTypeOverride === "funding_out").length,
      Excluded: r.length - selected.size,
    };
  }, [rows, selected]);
  const visible = (rows || [])
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) =>
      filter === "Checks"
        ? checksOf(r).length > 0
        : filter === "Conversions"
          ? isConversion(r)
          : filter === "Funding"
            ? isFundingIn(r) || r.entryTypeOverride === "funding_out"
            : filter === "Excluded"
              ? !selected.has(i)
              : true,
    );
  const unresolved = (rows || []).filter((r, i) => selected.has(i) && !conversionResolved(r)).length;
  const commit = async () => {
    if (!rows) return;
    const chosen = [...selected].sort((a, b) => a - b);
    if (!chosen.length) return notice(new Error("Select at least one row"));
    if (unresolved) return notice(new Error(`Decide what to do with ${unresolved} conversion row(s) first`));
    for (const i of chosen) {
      const r = rows[i];
      if (r.entryTypeOverride === "funding_out") {
        const f = meta(r).fundingOutConfig;
        if (!f?.destinationCurrency || (f.destinationType === "trip" && !f.destinationTripId))
          return notice(new Error(`Finish the funding-out details for “${r.label || r.description}”`));
      }
      if (r.entryTypeOverride === "reimbursement") {
        if (!r.linkage?.reimbursesAllocations?.length)
          return notice(new Error(`Choose what “${r.label || r.description}” pays back`));
        if (currencyOf(r, base) !== base && !(Number(r.linkage.reimbursementBaseAmount) > 0 || Number(r.linkage.reimbursingFxRate) > 0))
          return notice(new Error(`Enter a ${base} value for “${r.label || r.description}”`));
      }
    }
    // The data service needs a base value and rate on every refund, as the web sends them.
    const prepared = rows.map((r) => {
      if (r.entryTypeOverride !== "reimbursement" || r.linkage?.type !== "reimbursement") return r;
      const local = amountOf(r);
      const sameCurrency = currencyOf(r, base) === base;
      const baseValue = sameCurrency
        ? local
        : Number(r.linkage.reimbursementBaseAmount) > 0
          ? Number(r.linkage.reimbursementBaseAmount)
          : local * Number(r.linkage.reimbursingFxRate);
      const allocated = (r.linkage.reimbursesAllocations || []).reduce((s: number, a: any) => s + Number(a.amountBase || 0), 0);
      return {
        ...r,
        linkage: {
          ...r.linkage,
          reimbursementBaseAmount: Number(baseValue.toFixed(4)),
          reimbursingFxRate: local > 0 ? Number((baseValue / local).toFixed(8)) : undefined,
          leftoverAmount: Number(Math.max(baseValue - allocated, 0).toFixed(4)),
          leftoverCategoryId: baseValue - allocated > 0 ? r.linkage.leftoverCategoryId || null : null,
        },
      };
    });
    setBusy(true);
    try {
      const result = await call("commitReviewedTripImport", tripId, { walletId: routed ? null : walletId || null, parserId }, prepared, chosen);
      const parts = [
        result.importedSpendings && `${result.importedSpendings} spending`,
        result.importedReimbursements && `${result.importedReimbursements} reimbursements`,
        result.importedFundings && `${result.importedFundings} fundings`,
        result.importedTransfers && `${result.importedTransfers} transfers`,
        result.importedFees && `${result.importedFees} fees`,
      ].filter(Boolean);
      toast(`Imported ${parts.join(", ") || "rows"}${result.skippedDuplicates ? ` · ${result.skippedDuplicates} duplicates skipped` : ""}`);
      navigation.replace("FundingReview", { tripId });
    } catch (e) {
      notice(e);
    } finally {
      setBusy(false);
    }
  };
  if (!rows)
    return (
      <Screen
        footer={
          <Button
            title={busy ? "Reading statements…" : "Read & review"}
            icon="sparkles-outline"
            loading={busy}
            disabled={busy || !parserId || !files.length}
            onPress={() => void read()}
          />
        }
      >
        <Heading title="Import a statement" subtitle={trip.data?.name} />
        <Banner tone="purple" icon="wallet-outline" message="Wallets are created automatically by provider and currency." />
        <Card>
          <State {...parsers} />
          <Choice
            label="Statement type"
            value={parserId}
            options={list.map((p: any) => ({ label: p.name || p.id, value: p.id, hint: p.description }))}
            onChange={setParserId}
          />
          <Choice
            label="Wallet"
            value={routed ? "" : walletId}
            options={[
              { label: routed ? "Auto-routed by provider + currency" : "Auto-create / auto-detect", value: "" },
              ...(routed ? [] : (wallets.data || []).map((w: any) => ({ label: `${w.name} · ${w.currency}`, value: w.id, color: w.color }))),
            ]}
            onChange={setWalletId}
          />
        </Card>
        <Card>
          <View style={styles.between}>
            <Txt bold size={16}>
              Statement files
            </Txt>
            <Button title="Add files" compact icon="add" onPress={() => void pick().catch(notice)} />
          </View>
          {files.length === 0 && <Txt muted size={13}>PDF or CSV statements.</Txt>}
          {files.map((f, i) => (
            <View key={f.uri + i} style={styles.row}>
              <Ionicons name="document-outline" size={20} color={colors.muted} />
              <Txt style={{ flex: 1 }} numberOfLines={1}>
                {f.name}
              </Txt>
              <IconButton icon="close" size={32} label={`Remove ${f.name}`} onPress={() => setFiles((o) => o.filter((x) => x !== f))} />
            </View>
          ))}
          {parserId === "revolut_statement" && (
            <>
              <Txt muted size={13}>
                Optional: add the Revolut CSV export to merge with a single PDF.
              </Txt>
              <Button title={supplement ? supplement.name : "Add Revolut CSV merge file"} compact secondary icon="git-merge-outline" onPress={() => void pick(true).catch(notice)} />
            </>
          )}
        </Card>
        {!!message && <Banner tone="red" icon="alert-circle-outline" message={message} />}
      </Screen>
    );
  const item = editing !== null ? rows[editing] : null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={visible}
        keyExtractor={(x) => String(x.i)}
        contentContainerStyle={[styles.content, { gap: 8 }]}
        ListHeaderComponent={
          <View style={styles.stack}>
            <Heading
              title="Review import"
              subtitle={`${rows.length} rows · ${selected.size} selected`}
              right={<Button title="Start over" compact secondary onPress={() => setRows(null)} />}
            />
            {!!message && <Banner tone="amber" icon="alert-circle-outline" message={message} />}
            {counts.Checks > 0 && (
              <Banner
                tone="amber"
                icon="search-outline"
                title={`${counts.Checks} row${counts.Checks === 1 ? " needs" : "s need"} a check`}
                message="The parser wasn't sure about these. Review them before importing."
                action="Show them"
                onAction={() => setFilter("Checks")}
              />
            )}
            {unresolved > 0 && (
              <Banner
                tone="blue"
                icon="swap-horizontal-outline"
                title={`${unresolved} conversion${unresolved === 1 ? "" : "s"} to decide`}
                message="Tell Fortuna whether each currency conversion is internal, money leaving the trip, a duplicate or an existing funding."
                action="Review conversions"
                onAction={() => setFilter("Conversions")}
              />
            )}
            <Chips values={Object.keys(counts)} value={filter} onChange={setFilter} counts={counts as any} />
            <View style={styles.row}>
              <Button title="Select all" compact secondary style={{ flex: 1 }} onPress={() => setSelected(new Set(rows.map((_, i) => i)))} />
              <Button title="Select none" compact secondary style={{ flex: 1 }} onPress={() => setSelected(new Set())} />
            </View>
          </View>
        }
        ListEmptyComponent={
          <Card>
            <Empty icon="filter-outline" title="No rows in this view" />
          </Card>
        }
        renderItem={({ item: { r, i } }) => (
          <ImportRow
            row={r}
            base={base}
            included={selected.has(i)}
            categories={categories.data || []}
            onInclude={(c: boolean) =>
              setSelected((o) => {
                const n = new Set(o);
                if (c) n.add(i);
                else n.delete(i);
                return n;
              })
            }
            onEdit={(patch: Row) => update(i, (x) => ({ ...x, ...patch }))}
            onOpen={() => setEditing(i)}
          />
        )}
      />
      <Footer>
        <Button title={busy ? "Importing…" : `Import ${selected.size} rows`} icon="cloud-done-outline" loading={busy} disabled={busy || !selected.size} onPress={() => void commit()} />
      </Footer>
      <Sheet visible={!!item} onClose={() => setEditing(null)} title={item?.label || item?.description} subtitle={item ? `${fmtDate(item.date)} · ${money(amountOf(item), currencyOf(item, base))}` : undefined}>
        {item && editing !== null && (
          <RowEditor
            row={item}
            index={editing}
            rows={rows}
            selected={selected}
            base={base}
            tripId={tripId}
            categories={categories.data || []}
            wallets={wallets.data || []}
            fundings={fundings.data || []}
            update={(fn: (r: Row) => Row) => update(editing, fn)}
            setMeta={(fn: (m: Record<string, any>) => void) => setMeta(editing, fn)}
          />
        )}
      </Sheet>
    </View>
  );
}
/** A statement row with the label and category edited in place, like the web review table. */
function ImportRow({ row: r, base, included, categories, onInclude, onEdit, onOpen }: any) {
  const { colors } = useTheme();
  const income = Number(r.amountIn || 0) > 0;
  const checks = checksOf(r);
  const [label, setLabel] = useState(r.label || "");
  React.useEffect(() => setLabel(r.label || ""), [r.label]);
  const saveLabel = () => {
    if (label !== (r.label || "")) onEdit({ label: label.trim() || undefined });
  };
  const spending = !income && !r.entryTypeOverride;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.line,
        borderLeftWidth: 3,
        borderLeftColor: checks.length ? "#F59E0B" : isConversion(r) && !conversionResolved(r) ? colors.red : "transparent",
        padding: 12,
        gap: 8,
        opacity: included ? 1 : 0.55,
      }}
    >
      <View style={[styles.row, { alignItems: "flex-start", gap: 10 }]}>
        <Checkbox checked={included} label={`Include ${r.label || r.description}`} onChange={onInclude} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={[styles.between, { alignItems: "flex-start" }]}>
            <Txt bold numberOfLines={2} style={{ flex: 1 }}>
              {r.description}
            </Txt>
            <Txt mono size={14} style={{ color: income ? colors.green : colors.red }}>
              {income ? "+" : "-"}
              {moneyCode(amountOf(r), currencyOf(r, base))}
            </Txt>
          </View>
          <Txt muted size={12}>
            {fmtDate(r.date)}
          </Txt>
        </View>
      </View>
      <TextInput
        accessibilityLabel={`Label for ${r.description}`}
        value={label}
        placeholder="Label"
        placeholderTextColor={colors.faint}
        onChangeText={setLabel}
        onBlur={saveLabel}
        onSubmitEditing={saveLabel}
        returnKeyType="done"
        style={{
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 14,
          fontFamily: "DMSans_400Regular",
          color: colors.text,
        }}
      />
      <View style={[styles.row, { gap: 8 }]}>
        <View style={{ flex: 1 }}>
          {spending ? (
            <Choice
              compact
              label="Category"
              placeholder="Uncategorized"
              value={r.categoryId || ""}
              options={[
                { label: "Uncategorized", value: "" },
                ...categories.map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
              ]}
              onChange={(categoryId) => onEdit({ categoryId: categoryId || undefined })}
            />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              {isFundingIn(r) && <Pill tone="purple" label="Funding in" />}
              {r.entryTypeOverride === "funding_out" && <Pill tone="amber" label="Funding out" />}
              {r.entryTypeOverride === "reimbursement" && <Pill tone="green" label="Reimbursement" />}
              {income && !r.entryTypeOverride && <Pill label="Money in" />}
            </View>
          )}
        </View>
        <Button title="Details" label={`Edit ${r.label || r.description}`} compact secondary onPress={onOpen} />
      </View>
      {(checks.length > 0 || isConversion(r) || (meta(r).baseValuationMode && meta(r).baseValuationMode !== "auto")) && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {isConversion(r) && (
            <Pill
              tone={conversionResolved(r) ? "blue" : "red"}
              label={conversionResolved(r) ? `Conversion · ${humanize(meta(r).conversionReview?.mode || "funding out")}` : "Conversion: decide"}
            />
          )}
          {checks.length > 0 && <Pill tone="amber" icon="alert-circle-outline" label={checks[0]} />}
          {meta(r).baseValuationMode && meta(r).baseValuationMode !== "auto" && <Pill label="Manual value" />}
        </View>
      )}
    </View>
  );
}
function RowEditor({ row, index, rows, selected, base, tripId, categories, wallets, fundings, update, setMeta }: any) {
  const m = meta(row);
  const income = Number(row.amountIn || 0) > 0;
  const currency = currencyOf(row, base);
  const checks = checksOf(row);
  const type = isFundingIn(row) ? "funding_in" : row.entryTypeOverride || "default";
  const [allocating, setAllocating] = useState(false);
  const setType = (next: string) =>
    update((r: Row) => {
      const md = { ...meta(r) };
      if (next !== "funding_out") delete md.fundingOutConfig;
      if (next !== "funding_in" && kindOf(r) === "topup") md.fundingInDisabled = true;
      if (next === "funding_in") delete md.fundingInDisabled;
      if (next === "funding_out") {
        md.fundingInDisabled = true;
        md.fundingOutConfig = md.fundingOutConfig || { destinationType: "bank", destinationCurrency: base, inputMode: "amount" };
        if (isConversion(r)) md.conversionReview = { mode: "funding_out", linkedFundingId: null };
      } else if (isConversion(r) && md.conversionReview?.mode === "funding_out") md.conversionReview = { mode: "unreviewed", linkedFundingId: null };
      return {
        ...r,
        entryTypeOverride: next === "default" ? undefined : next,
        linkage: next === "reimbursement" ? r.linkage || { type: "reimbursement", reimbursesAllocations: [] } : null,
        metadata: md,
      };
    });
  const fo = m.fundingOutConfig ? fundingOutFromMetadata(m.fundingOutConfig, base) : emptyFundingOut(base);
  const conversion = m.conversionReview || {};
  return (
    <>
      {checks.length > 0 && <Banner tone="amber" icon="alert-circle-outline" title="Check this row" message={checks.join("\n")} />}
      <Card>
        <Input label="Label" value={row.label || ""} placeholder={row.description} onChangeText={(label: string) => update((r: Row) => ({ ...r, label }))} />
        <KeyValue label="Description" value={row.description} />
        <Section title="Treat as">
          <Segmented
            values={income ? ["default", "reimbursement", "funding_in"] : ["default", "funding_out"]}
            labels={{ default: income ? "Default" : "Spending", reimbursement: "Refund", funding_in: "Funding in", funding_out: "Funding out" }}
            value={type}
            onChange={setType}
          />
        </Section>
        {type === "default" && !income && (
          <Choice
            label="Category"
            value={row.categoryId || ""}
            options={[{ label: "Uncategorized", value: "" }, ...categories.map((c: any) => ({ label: c.name, value: c.id, color: c.color }))]}
            onChange={(categoryId) => update((r: Row) => ({ ...r, categoryId: categoryId || undefined }))}
          />
        )}
      </Card>
      {isConversion(row) && type !== "funding_out" && (
        <Card>
          <Txt bold>Currency conversion</Txt>
          <Txt muted size={13}>
            {m.fromAmount ? `${money(m.fromAmount, m.fromCurrency)} → ${money(m.toAmount, m.toCurrency)}` : "Converted between wallets."}
          </Txt>
          <Choice
            label="What is it?"
            value={conversion.mode && conversion.mode !== "unreviewed" ? conversion.mode : ""}
            options={[
              { label: "Internal move between wallets", value: "internal" },
              { label: "Duplicate of another row", value: "skip_duplicate" },
              { label: "Matches an existing funding", value: "link_existing" },
              { label: "Money leaving the trip (funding out)", value: "funding_out" },
            ]}
            onChange={(mode) =>
              mode === "funding_out"
                ? setType("funding_out")
                : setMeta((md: any) => {
                    md.conversionReview = { mode, linkedFundingId: mode === "link_existing" ? md.conversionReview?.linkedFundingId || null : null };
                  })
            }
          />
          {conversion.mode === "link_existing" && (
            <Choice
              label="Existing funding"
              value={conversion.linkedFundingId || ""}
              options={fundings.map((f: any) => ({
                label: `${money(f.sourceAmount, f.sourceCurrency)} → ${money(f.destinationAmount, f.destinationCurrency)}`,
                value: f.id,
                hint: `${humanize(f.sourceType)} · ${f.wallet?.name || "No wallet"}`,
              }))}
              onChange={(id) => setMeta((md: any) => (md.conversionReview = { mode: "link_existing", linkedFundingId: id }))}
            />
          )}
        </Card>
      )}
      {type === "funding_out" && (
        <Card>
          <FundingOutFields
            value={fo}
            allowWallet={false}
            tripId={tripId}
            baseCurrency={base}
            wallets={wallets}
            onChange={(v) =>
              setMeta((md: any) => {
                md.fundingOutConfig = { ...v, destinationTripId: v.destinationTripId || null };
              })
            }
          />
        </Card>
      )}
      {type === "reimbursement" && (
        <Card>
          <View style={styles.between}>
            <Txt bold>Pays back</Txt>
            <Txt muted size={13}>
              {(row.linkage?.reimbursesAllocations || []).length} linked
            </Txt>
          </View>
          {(row.linkage?.reimbursesAllocations || []).map((a: any, i: number) => {
            const target = a.pendingBatchIndex !== undefined ? rows[a.pendingBatchIndex] : null;
            return (
              <KeyValue key={i} label={target ? target.label || target.description : a.targetDescription || "Trip entry"} mono value={money(a.amountBase, base)} />
            );
          })}
          <Button title="Choose spending" compact secondary icon="link-outline" onPress={() => setAllocating(true)} />
          {currency !== base && (
            <View style={[styles.row, { alignItems: "flex-start" }]}>
              <View style={{ flex: 1 }}>
                <Input
                  label={`Worth in ${base}`}
                  value={row.linkage?.reimbursementBaseAmount ? String(row.linkage.reimbursementBaseAmount) : ""}
                  keyboardType="decimal-pad"
                  onChangeText={(v: string) => update((r: Row) => ({ ...r, linkage: { ...r.linkage, reimbursementBaseAmount: Number(v) || null } }))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label={`${base} per 1 ${currency}`}
                  value={row.linkage?.reimbursingFxRate ? String(row.linkage.reimbursingFxRate) : ""}
                  keyboardType="decimal-pad"
                  onChangeText={(v: string) => update((r: Row) => ({ ...r, linkage: { ...r.linkage, reimbursingFxRate: Number(v) || null } }))}
                />
              </View>
            </View>
          )}
          <Choice
            label="Category for what is left over"
            value={row.linkage?.leftoverCategoryId || ""}
            options={[{ label: "Uncategorized", value: "" }, ...categories.map((c: any) => ({ label: c.name, value: c.id, color: c.color }))]}
            onChange={(id) => update((r: Row) => ({ ...r, linkage: { ...r.linkage, leftoverCategoryId: id || null } }))}
          />
        </Card>
      )}
      {type !== "funding_out" && (
        <Card>
          <Txt bold>Value in {base}</Txt>
          <Segmented
            values={["auto", "manual_fx", "manual_base"]}
            labels={{ auto: "Wallet rate", manual_fx: "My rate", manual_base: `My ${base}` }}
            value={m.baseValuationMode || "auto"}
            onChange={(mode) =>
              setMeta((md: any) => {
                md.baseValuationMode = mode;
                if (mode === "auto") {
                  delete md.manualBaseAmount;
                  delete md.manualFxRate;
                }
              })
            }
          />
          {m.baseValuationMode === "manual_fx" && (
            <Input
              label={`${base} per 1 ${currency}`}
              value={m.manualFxRate ? String(m.manualFxRate) : ""}
              keyboardType="decimal-pad"
              onChangeText={(v: string) => setMeta((md: any) => (Number(v) > 0 ? (md.manualFxRate = Number(v)) : delete md.manualFxRate))}
            />
          )}
          {m.baseValuationMode === "manual_base" && (
            <Input
              label={`Worth in ${base}`}
              value={m.manualBaseAmount ? String(m.manualBaseAmount) : ""}
              keyboardType="decimal-pad"
              onChangeText={(v: string) => setMeta((md: any) => (Number(v) > 0 ? (md.manualBaseAmount = Number(v)) : delete md.manualBaseAmount))}
            />
          )}
          <View style={[styles.row, { alignItems: "flex-start" }]}>
            <View style={{ flex: 1 }}>
              <Input
                label="Fee"
                value={m.feeAmount ? String(m.feeAmount) : ""}
                placeholder="Optional"
                keyboardType="decimal-pad"
                onChangeText={(v: string) => setMeta((md: any) => (Number(v) > 0 ? (md.feeAmount = Number(v)) : delete md.feeAmount))}
              />
            </View>
            <View style={{ width: 110 }}>
              <Input
                label="Fee currency"
                value={m.feeCurrency || currency}
                autoCapitalize="characters"
                maxLength={3}
                onChangeText={(v: string) => setMeta((md: any) => (md.feeCurrency = v.toUpperCase()))}
              />
            </View>
          </View>
        </Card>
      )}
      <AllocationSheet
        visible={allocating}
        onClose={() => setAllocating(false)}
        row={row}
        index={index}
        rows={rows}
        selected={selected}
        tripId={tripId}
        base={base}
        onSave={(allocations: any[]) => update((r: Row) => ({ ...r, linkage: { ...(r.linkage || { type: "reimbursement" }), type: "reimbursement", reimbursesAllocations: allocations } }))}
      />
    </>
  );
}
/** Pick spending this refund pays back: rows in this import or entries already in the trip. */
function AllocationSheet({ visible, onClose, row, index, rows, selected, tripId, base, onSave }: any) {
  const [tab, setTab] = useState("import");
  const [search, setSearch] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const existing = useResource(visible && tab === "trip" ? "searchTripEntriesForReimbursement" : "", tripId, { search, limit: 30 });
  React.useEffect(() => {
    if (!visible) return;
    const initial: Record<string, string> = {};
    for (const a of row.linkage?.reimbursesAllocations || [])
      initial[a.pendingBatchIndex !== undefined ? `b:${a.pendingBatchIndex}` : `t:${a.transactionId}`] = String(a.amountBase ?? a.amount);
    setAlloc(initial);
  }, [visible]);
  const batch = rows
    .map((r: Row, i: number) => ({ r, i }))
    .filter(({ r, i }: any) => i !== index && Number(r.amountOut || 0) > 0 && r.entryTypeOverride !== "funding_out" && `${r.label || ""} ${r.description}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (key: string, amount: number, label: string) => {
    setLabels((l) => ({ ...l, [key]: label }));
    setAlloc((o) => {
      const n = { ...o };
      if (n[key] !== undefined) delete n[key];
      else n[key] = String(Math.round(amount * 100) / 100);
      return n;
    });
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="What does it pay back?"
      footer={
        <Button
          title="Use these"
          onPress={() => {
            onSave(
              Object.entries(alloc)
                .filter(([, v]) => Number(v) > 0)
                .map(([k, v]) =>
                  k.startsWith("b:")
                    ? { pendingBatchIndex: Number(k.slice(2)), amountBase: Number(v), amount: Number(v) }
                    : { transactionId: k.slice(2), amountBase: Number(v), amount: Number(v), targetDescription: labels[k] },
                ),
            );
            onClose();
          }}
        />
      }
    >
      <Segmented values={["import", "trip"]} labels={{ import: "This import", trip: "Already in trip" }} value={tab} onChange={setTab} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search spending" />
      <Txt muted size={12}>Amounts are in {base}.</Txt>
      <Group>
        {tab === "import"
          ? batch.map(({ r, i }: any) => {
              const key = `b:${i}`;
              const on = alloc[key] !== undefined;
              return (
                <View key={key} style={{ padding: 12, gap: 8 }}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(key, amountOf(r), r.label || r.description)} style={styles.row}>
                    <Checkbox checked={on} />
                    <View style={{ flex: 1 }}>
                      <Txt bold numberOfLines={1}>{r.label || r.description}</Txt>
                      <Txt muted size={12}>
                        {fmtDate(r.date)} · {money(amountOf(r), currencyOf(r, base))}
                        {selected.has(i) ? "" : " · not selected"}
                      </Txt>
                    </View>
                  </Pressable>
                  {on && <Input value={alloc[key]} keyboardType="decimal-pad" accessibilityLabel="Amount" onChangeText={(v: string) => setAlloc((o) => ({ ...o, [key]: v }))} />}
                </View>
              );
            })
          : (existing.data?.transactions || []).map((c: any) => {
              const key = `t:${c.id}`;
              const on = alloc[key] !== undefined;
              return (
                <View key={key} style={{ padding: 12, gap: 8 }}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(key, Number(c.remainingBase), c.label || c.description)} style={styles.row}>
                    <Checkbox checked={on} />
                    <View style={{ flex: 1 }}>
                      <Txt bold numberOfLines={1}>{c.label || c.description}</Txt>
                      <Txt muted size={12}>
                        {fmtDate(c.date)} · {money(c.remainingBase, base)} free
                      </Txt>
                    </View>
                  </Pressable>
                  {on && <Input value={alloc[key]} keyboardType="decimal-pad" accessibilityLabel="Amount" onChangeText={(v: string) => setAlloc((o) => ({ ...o, [key]: v }))} />}
                </View>
              );
            })}
      </Group>
      {tab === "trip" && <State {...existing} />}
    </Sheet>
  );
}
