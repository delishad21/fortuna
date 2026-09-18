import React, { createContext, useContext, useState } from "react";
import { FlatList, Platform, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useApi, useResource } from "./api";
import {
  Button,
  Card,
  Choice,
  Chips,
  Input,
  confirm,
  Form,
  Heading,
  money,
  notice,
  Screen,
  State,
  styles,
  TransactionRow,
  Txt,
  useTheme,
} from "./ui";
import { SafeAreaView } from "react-native-safe-area-context";
import { Bars, Summary } from "./home";

type Batch = {
  filename: string;
  parserId: string;
  transactions: any[];
  selected: number[];
  duplicates: any[];
  tripId?: string;
  walletId?: string;
};
export const DraftContext = createContext<{
  batches: Batch[];
  setBatches: React.Dispatch<React.SetStateAction<Batch[]>>;
}>(null!);
export function ImportProvider({ children }: any) {
  const [batches, setBatches] = useState<Batch[]>([]);
  return (
    <DraftContext.Provider value={{ batches, setBatches }}>
      {children}
    </DraftContext.Provider>
  );
}
export function ImportScreen({ navigation, route }: any) {
  const { tripId, walletId } = route.params || {};
  const { batches, setBatches } = useContext(DraftContext);
  const { parse, call } = useApi();
  const parsers = useResource("getAvailableParsers", tripId ? "trip" : "bank");
  const [parser, setParser] = useState("");
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [supplement, setSupplement] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pick = async (extra = false) => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: !extra,
      copyToCacheDirectory: true,
      type: [
        "application/pdf",
        "text/csv",
        "text/comma-separated-values",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
      ],
    });
    if (!result.canceled)
      extra ? setSupplement(result.assets[0]) : setFiles(result.assets);
  };
  const append = (
    form: FormData,
    key: string,
    file: DocumentPicker.DocumentPickerAsset,
  ) => {
    if (Platform.OS === "web" && file.file) form.append(key, file.file);
    else
      form.append(key, {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || "application/octet-stream",
      } as any);
  };
  const list = Array.isArray(parsers.data)
    ? parsers.data
    : parsers.data?.parsers || [];
  return (
    <Screen>
      <Heading
        title="Bring it all together"
        subtitle="Import a statement. Review every detail before saving."
      />
      <Card>
        <Txt bold size={19}>
          1. Choose your statement type
        </Txt>
        <State {...parsers} />
        <Choice
          label="Statement parser"
          value={parser}
          options={list.map((p: any) => ({
            label: p.name || p.label || p.id,
            value: p.id,
          }))}
          onChange={setParser}
        />
      </Card>
      <Card>
        <Txt bold size={19}>
          2. Add your files
        </Txt>
        <Txt muted>PDF, CSV or spreadsheet · Up to 25 MB per file</Txt>
        <Button
          title="Choose statements"
          icon="document-attach-outline"
          secondary
          onPress={() => void pick().catch(notice)}
        />
        {files.map((f) => (
          <Txt key={f.uri}>{f.name}</Txt>
        ))}
        {parser === "revolut_statement" && (
          <>
            <Button
              title="Add supplemental Revolut file"
              secondary
              onPress={() => void pick(true).catch(notice)}
            />
            {supplement && <Txt>{supplement.name}</Txt>}
          </>
        )}
      </Card>
      {!!message && <Txt>{message}</Txt>}
      <Button
        title={busy ? "Preparing your review…" : "Parse & review"}
        disabled={busy || !parser || !files.length}
        onPress={async () => {
          setBusy(true);
          setMessage("");
          const prepared: Batch[] = [];
          try {
            for (const [index, file] of files.entries()) {
              if ((file.size || 0) > 25 * 1024 * 1024)
                throw new Error(`${file.name} exceeds 25 MB`);
              setMessage(`Reading statement ${index + 1} of ${files.length}…`);
              const form = new FormData();
              append(form, "file", file);
              form.append("parserId", parser);
              if (supplement) append(form, "supplementalFile", supplement);
              const result = await parse(form);
              if (!result.success)
                throw new Error(result.error || "Could not parse this file");
              const transactions = result.transactions.map((row: any) => {
                const accountIdentifier =
                  row.accountIdentifier ||
                  row.accountNumber ||
                  result.accountIdentifier ||
                  row.metadata?.accountIdentifier ||
                  row.metadata?.accountNumber;
                return {
                  ...row,
                  accountIdentifier,
                  metadata: {
                    ...row.metadata,
                    sourceFilename: file.name,
                    parserId: parser,
                    ...(accountIdentifier ? { accountIdentifier } : {}),
                  },
                };
              });
              const check = tripId
                ? { duplicates: [] }
                : await call("checkImportDuplicates", transactions);
              const duplicateIndices = new Set(
                check.duplicates.map((d: any) => d.index),
              );
              prepared.push({
                filename: file.name,
                parserId: parser,
                transactions,
                selected: transactions
                  .map((_: any, i: number) => i)
                  .filter((i: number) => !duplicateIndices.has(i)),
                duplicates: check.duplicates,
                tripId,
                walletId,
              });
            }
            setBatches((old) => [...old, ...prepared]);
            navigation.navigate("ImportReview");
            setFiles([]);
            setMessage("");
          } catch (e: any) {
            if (prepared.length) setBatches((old) => [...old, ...prepared]);
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {batches.length > 0 && (
        <Button
          title={`Resume ${batches.length} pending statements`}
          secondary
          onPress={() => navigation.navigate("ImportReview")}
        />
      )}
      <Button
        title="Import history"
        secondary
        onPress={() => navigation.navigate("ImportHistory")}
      />
      <Button
        title="Review agent drafts"
        secondary
        onPress={() => navigation.navigate("Drafts")}
      />
    </Screen>
  );
}
export function ImportReviewScreen({ navigation }: any) {
  const { batches, setBatches } = useContext(DraftContext);
  const { call } = useApi();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const accounts = useResource("getAccountNumbers");
  const [account, setAccount] = useState("");
  const batch = batches[0];
  if (!batch)
    return (
      <Screen>
        <Heading
          title="All reviewed"
          subtitle="Your saved transactions are ready."
        />
        <Button
          title="Back to your money"
          onPress={() => navigation.navigate("Main")}
        />
      </Screen>
    );
  const update = (fn: (batch: Batch) => Batch) =>
    setBatches((old) => [fn(old[0]), ...old.slice(1)]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={batch.transactions}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.stack}>
            <Heading
              title="Review your statement"
              subtitle={`${batch.filename} · ${batches.length} pending`}
            />
            <Card>
              <Txt bold>
                {batch.selected.length} of {batch.transactions.length} selected
              </Txt>
              <Txt muted>
                {batch.duplicates.length} possible duplicates excluded by
                default. Tap a row to include or exclude it; edit to inspect
                details.
              </Txt>
              {!batch.tripId && (
                <>
                  <Choice
                    label="Apply account to selected rows"
                    value={account}
                    options={(accounts.data || []).map((a: any) => ({
                      label: a.accountIdentifier,
                      value: a.accountIdentifier,
                    }))}
                    onChange={setAccount}
                  />
                  <Button
                    title="Apply account"
                    secondary
                    disabled={!account}
                    onPress={() =>
                      update((b) => ({
                        ...b,
                        transactions: b.transactions.map((t, i) =>
                          b.selected.includes(i)
                            ? { ...t, accountIdentifier: account }
                            : t,
                        ),
                      }))
                    }
                  />
                  <Button
                    title="Create an account"
                    secondary
                    onPress={() =>
                      navigation.navigate("Manage", { kind: "accounts" })
                    }
                  />
                </>
              )}
              <Button
                title="Select all"
                secondary
                onPress={() =>
                  update((b) => ({
                    ...b,
                    selected: b.transactions.map((_, i) => i),
                  }))
                }
              />
              <Button
                title="Deselect all"
                secondary
                onPress={() => update((b) => ({ ...b, selected: [] }))}
              />
            </Card>
          </View>
        }
        renderItem={({ item, index }) => (
          <Card style={{ marginTop: 12 }}>
            <TransactionRow
              item={item}
              selected={batch.selected.includes(index)}
              onPress={() =>
                update((b) => ({
                  ...b,
                  selected: b.selected.includes(index)
                    ? b.selected.filter((i) => i !== index)
                    : [...b.selected, index],
                }))
              }
            />
            {batch.duplicates
              .find((d) => d.index === index)
              ?.matches.map((m: any) => (
                <Txt key={m.transaction.id} size={12} muted>
                  Possible duplicate: {m.transaction.description} ·{" "}
                  {String(m.transaction.date).slice(0, 10)} ·{" "}
                  {money(m.transaction.amountOut || m.transaction.amountIn)} —{" "}
                  {m.matchReasons.join(", ")}
                </Txt>
              ))}
            {item.suggestionSource && (
              <Txt muted size={12}>
                Suggestion: {item.suggestionSource} ·{" "}
                {Math.round((item.suggestionConfidence || 0) * 100)}% confidence
              </Txt>
            )}
            <Button
              title="Edit details"
              secondary
              onPress={() => navigation.navigate("ImportRow", { index })}
            />
          </Card>
        )}
        ListFooterComponent={
          <View style={{ gap: 12, marginTop: 20 }}>
            <Button
              title={
                busy ? "Saving…" : `Save ${batch.selected.length} transactions`
              }
              disabled={busy || !batch.selected.length}
              onPress={() =>
                confirm(
                  "Save reviewed transactions?",
                  `Import ${batch.selected.length} selected rows from ${batch.filename}.`,
                  async () => {
                    if (busy) return;
                    setBusy(true);
                    try {
                      if (batch.tripId)
                        await call(
                          "commitReviewedTripImport",
                          batch.tripId,
                          {
                            walletId: batch.walletId,
                            parserId: batch.parserId,
                          },
                          batch.transactions,
                          batch.selected,
                        );
                      else {
                        const result = await call(
                          "commitImport",
                          batch.transactions,
                          batch.selected,
                          {
                            filename: batch.filename,
                            parserId: batch.parserId,
                            fileType:
                              batch.filename.split(".").pop() || "unknown",
                          },
                        );
                        if (!result.success)
                          throw new Error(result.error || "Import failed");
                      }
                      setBatches((old) => old.slice(1));
                    } finally {
                      setBusy(false);
                    }
                  },
                )
              }
            />
            <Button
              title="Discard this statement"
              danger
              secondary
              onPress={() =>
                confirm(
                  "Discard review?",
                  "This only removes the unsaved statement from this device.",
                  async () => setBatches((old) => old.slice(1)),
                )
              }
            />
          </View>
        }
      />
    </View>
  );
}
export function ImportRowScreen({ route, navigation }: any) {
  const { batches, setBatches } = useContext(DraftContext);
  const index = route.params.index;
  const batch = batches[0];
  const item = batch?.transactions[index];
  const categories = useResource("getCategories", {
    scope: batch?.tripId ? "trips" : "main",
  });
  if (!item)
    return (
      <Screen>
        <Txt>This statement has already been reviewed.</Txt>
      </Screen>
    );
  return (
    <Screen>
      <Heading title="Review transaction" />
      <Button
        title="Allocate reimbursement"
        secondary
        disabled={!(Number(item.amountIn) > 0)}
        onPress={() => navigation.navigate("ImportAllocation", { index })}
      />
      {item.linkage && (
        <Button
          title="Clear reimbursement or transfer links"
          secondary
          onPress={() => {
            setBatches((old) =>
              old.map((b, bi) =>
                bi === 0
                  ? {
                      ...b,
                      transactions: b.transactions.map((t, ti) =>
                        ti === index ? { ...t, linkage: null } : t,
                      ),
                    }
                  : b,
              ),
            );
            navigation.goBack();
          }}
        />
      )}
      <Form
        initial={{
          ...item,
          date: String(item.date).slice(0, 10),
          internal: item.linkage?.type === "internal",
        }}
        fields={[
          { key: "date", label: "Date", type: "date", required: true },
          { key: "description", label: "Description", required: true },
          { key: "label", label: "Label" },
          { key: "amountIn", label: "Money in", type: "number" },
          { key: "amountOut", label: "Money out", type: "number" },
          { key: "accountIdentifier", label: "Account identifier" },
          {
            key: "categoryId",
            label: "Category",
            options: [
              { label: "Uncategorized", value: "" },
              ...(categories.data || []).map((c: any) => ({
                label: c.name,
                value: c.id,
              })),
            ],
          },
          ...(batch.tripId
            ? [
                {
                  key: "entryType",
                  label: "Entry type",
                  options: [
                    "spending",
                    "reimbursement",
                    "funding_in",
                    "funding_out",
                  ].map((value) => ({ label: value.replace("_", " "), value })),
                },
              ]
            : [
                {
                  key: "internal",
                  label: "Internal transfer",
                  type: "boolean" as const,
                },
              ]),
        ]}
        onSave={async (v) => {
          const { internal, ...payload } = v;
          if (!batch.tripId)
            payload.linkage = internal
              ? { type: "internal" }
              : item.linkage?.type === "internal"
                ? null
                : item.linkage;
          setBatches((old) =>
            old.map((b, bi) =>
              bi === 0
                ? {
                    ...b,
                    transactions: b.transactions.map((t, ti) =>
                      ti === index ? payload : t,
                    ),
                  }
                : b,
            ),
          );
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
export function ImportHistoryScreen({ navigation }: any) {
  const data = useResource("getImportSummaries");
  const rows = Array.isArray(data.data)
    ? data.data
    : data.data?.imports || data.data?.importSummaries || [];
  return (
    <Screen>
      <Heading
        title="Import history"
        subtitle="Every statement, accounted for."
      />
      <State {...data} />
      {rows.map((b: any) => (
        <Card key={b.key}>
          <Txt bold size={18}>
            {b.filename}
          </Txt>
          <Txt muted>
            {b.transactionCount} transactions ·{" "}
            {String(b.importedAt || b.latestTransactionDate).slice(0, 10)}
          </Txt>
          <Txt>
            {money(b.totalOut)} out · {money(b.totalIn)} in
          </Txt>
          <Button
            title="View statement"
            secondary
            onPress={() => navigation.navigate("ImportDetail", { key: b.key })}
          />
        </Card>
      ))}
    </Screen>
  );
}
export function ImportDetailScreen({ navigation, route }: any) {
  const result = useResource("getImportDetail", route.params.key);
  const d = result.data;
  return (
    <Screen>
      <State {...result} />
      {d && (
        <>
          <Heading
            title={d.filename}
            subtitle={`${d.transactionCount} transactions`}
          />
          <Summary summary={d} />
          <Card>
            <Txt bold>By category</Txt>
            <Bars rows={d.categoryBreakdown} />
          </Card>
          <Card>
            <Txt bold>By account</Txt>
            <Bars rows={d.accountBreakdown} />
          </Card>
          {d.transactions.map((item: any) => (
            <TransactionRow
              key={item.id}
              item={item}
              onPress={() => navigation.navigate("Transaction", { item })}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
export function ImportManagementScreen({ navigation }: any) {
  const drafts = useResource("getAgentDrafts");
  const history = useResource("getImportSummaries");
  const { batches } = useContext(DraftContext);
  const { colors } = useTheme();
  const [tab, setTab] = useState("Staged");
  const result = tab === "Staged" ? drafts : history;
  const staged = (drafts.data?.drafts || []).filter(
    (d: any) =>
      !["committed", "discarded", "expired"].includes(d.status) &&
      new Date(d.expiresAt) > new Date(),
  );
  const imported = Array.isArray(history.data)
    ? history.data
    : history.data?.imports || history.data?.importSummaries || [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={tab === "Staged" ? staged : imported}
        keyExtractor={(item: any) => item.id || item.key}
        contentContainerStyle={styles.content}
        refreshing={result.loading}
        onRefresh={() => void result.reload()}
        ListHeaderComponent={
          <View style={styles.stack}>
            <Heading
              title="Your imports"
              subtitle="Your assistant prepares. Review, reconcile and save here."
            />
            <Button
              title="Import a statement"
              icon="add-outline"
              onPress={() => navigation.navigate("StatementImport")}
            />
            {!!batches.length && (
              <Button
                title={`Resume ${batches.length} pending statements`}
                secondary
                onPress={() => navigation.navigate("ImportReview")}
              />
            )}
            <Chips
              values={["Staged", "History"]}
              value={tab}
              onChange={setTab}
            />
            {tab === "Staged" && (
              <Txt muted>
                {staged.length} staged statements ·{" "}
                {staged.reduce(
                  (sum: number, d: any) =>
                    sum + (d.reviewSummary?.needsReview || 0),
                  0,
                )}{" "}
                transactions need review
              </Txt>
            )}
            <State {...result} />
          </View>
        }
        ListEmptyComponent={
          !result.loading && !result.error ? (
            <Card>
              <Txt bold>
                {tab === "Staged"
                  ? "No staged statements"
                  : "No imported statements yet"}
              </Txt>
              <Txt muted>
                {tab === "Staged"
                  ? "Statements staged through the MCP appear here, including rows your agent flagged for review."
                  : "Saved statements appear here after you commit them."}
              </Txt>
            </Card>
          ) : null
        }
        renderItem={({ item: d }: any) => (
          <Card style={{ marginTop: 12 }}>
            <Txt bold size={18}>
              {d.sourceFilename || d.filename}
            </Txt>
            {tab === "Staged" ? (
              <>
                <Txt muted>
                  {d.reviewSummary?.total ?? d._count?.rows ?? 0} transactions ·{" "}
                  {d.mode} · {d.status}
                </Txt>
                <Txt bold>
                  {d.reviewSummary?.needsReview || 0} need review ·{" "}
                  {d.reviewSummary?.ready || 0} ready
                </Txt>
                <Txt muted>
                  {d.reviewSummary?.labelling || 0} need labelling ·{" "}
                  {d.reviewSummary?.reconciliation || 0} need reconciliation
                </Txt>
                <Button
                  title="Review staged transactions"
                  secondary
                  onPress={() => navigation.navigate("Draft", { id: d.id })}
                />
              </>
            ) : (
              <>
                <Txt muted>
                  {d.transactionCount} transactions ·{" "}
                  {String(d.importedAt || d.latestTransactionDate).slice(0, 10)}
                </Txt>
                <Txt>
                  {money(d.totalOut)} out · {money(d.totalIn)} in
                </Txt>
                <Button
                  title="View statement"
                  secondary
                  onPress={() =>
                    navigation.navigate("ImportDetail", { key: d.key })
                  }
                />
              </>
            )}
          </Card>
        )}
      />
    </View>
  );
}
export const DraftsScreen = ImportManagementScreen;
export function DraftScreen({ route, navigation }: any) {
  const { call } = useApi();
  const result = useResource("getAgentDraft", route.params.id);
  const categories = useResource("getCategories", { scope: "settings" });
  const { colors } = useTheme();
  const d = result.data?.draft;
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("Needs review");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const closed =
    !d ||
    ["committed", "discarded", "expired"].includes(d.status) ||
    new Date(d.expiresAt) <= new Date();
  const categoryName = (id: string) =>
    (categories.data || []).find((c: any) => c.id === id)?.name || "Unassigned";
  const run = async (fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await result.reload();
    } catch (e: any) {
      setMessage(e.message || "Could not update this draft");
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    let validation: any;
    await run(async () => {
      validation = await call("validateAgentDraft", d.id);
      if (!validation.valid)
        setMessage(
          [...(validation.errors || []), ...(validation.warnings || [])]
            .map(
              (e: any) =>
                `${e.rowIndex !== undefined ? `Row ${e.rowIndex + 1}: ` : ""}${e.message || e.code || e}`,
            )
            .join("\n") || "Review the flagged rows before saving.",
        );
    });
    if (validation?.valid)
      confirm(
        "Save this import?",
        `${validation.summary.selected} selected rows will be saved.${validation.duplicates?.length ? ` ${validation.duplicates.length} possible duplicates found.` : ""}`,
        () =>
          run(() =>
            call("commitAgentDraft", d.id, validation.confirmationToken),
          ),
      );
  };
  const rows = (d?.rows || []).filter((row: any) => {
    const r = row.review || {};
    const matches =
      filter === "All" ||
      (filter === "Needs review" && r.needsReview) ||
      (filter === "Labelling" && r.labelling) ||
      (filter === "Reconciliation" && r.reconciliation) ||
      (filter === "Ready" && !r.needsReview);
    return (
      matches &&
      `${row.currentPayload?.label || ""} ${row.currentPayload?.description || ""}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(row: any) => row.id}
        contentContainerStyle={styles.content}
        refreshing={result.loading}
        onRefresh={() => void result.reload()}
        ListHeaderComponent={
          <View style={styles.stack}>
            <Heading
              title="Review staged transactions"
              subtitle={d?.sourceFilename}
            />
            <State {...result} />
            {d && (
              <Card>
                <Txt bold>
                  {d.reviewSummary?.needsReview || 0} need review ·{" "}
                  {d.reviewSummary?.ready || 0} ready
                </Txt>
                <Txt muted>
                  {d.reviewSummary?.selected || 0} selected · {d.status}
                </Txt>
                <Txt muted>
                  Ready rows are still staged until you save the import.
                </Txt>
              </Card>
            )}
            <Chips
              values={[
                "Needs review",
                "Labelling",
                "Reconciliation",
                "Ready",
                "All",
              ]}
              value={filter}
              onChange={setFilter}
            />
            <Input
              label="Search staged transactions"
              value={search}
              onChangeText={setSearch}
              placeholder="Description or label"
            />
            {!!message && (
              <Card>
                <Txt>{message}</Txt>
              </Card>
            )}
          </View>
        }
        ListEmptyComponent={
          d ? (
            <Card>
              <Txt muted>
                No transactions match this view. Choose All to see every row.
              </Txt>
            </Card>
          ) : null
        }
        renderItem={({ item: row }: any) => (
          <Card style={{ marginTop: 12 }}>
            <TransactionRow
              item={{
                ...row.currentPayload,
                category: {
                  name: categoryName(row.currentPayload?.categoryId),
                },
              }}
              selected={row.selected}
            />
            <Txt muted>
              Category: {categoryName(row.currentPayload?.categoryId)} ·{" "}
              {row.reviewStatus}
            </Txt>
            {(row.review?.reasons || []).map((reason: string) => (
              <Txt key={reason} style={{ color: colors.purple }}>
                {reason}
              </Txt>
            ))}
            <View style={styles.row}>
              <Button
                title={row.selected ? "Exclude row" : "Include row"}
                secondary
                disabled={busy || closed}
                onPress={() =>
                  void run(() =>
                    call("updateAgentDraftRow", d.id, row.id, {
                      expectedVersion: row.version,
                      selected: !row.selected,
                    }),
                  )
                }
              />
              <Button
                title="Edit details"
                secondary
                disabled={busy || closed}
                onPress={() =>
                  navigation.navigate("DraftRow", {
                    draftId: d.id,
                    mode: d.mode,
                    row,
                  })
                }
              />
            </View>
            {(row.proposals || []).map((p: any) => (
              <View key={p.id} style={styles.stack}>
                <Txt bold>
                  Agent suggestion · {Math.round(Number(p.confidence) * 100)}% ·{" "}
                  {p.status}
                </Txt>
                <Txt>{p.reason}</Txt>
                {!!p.proposedLabel && <Txt>Label: {p.proposedLabel}</Txt>}
                {!!p.proposedCategoryId && (
                  <Txt>Category: {categoryName(p.proposedCategoryId)}</Txt>
                )}
                {!!p.proposedTripEntryType && (
                  <Txt>
                    Entry: {p.proposedTripEntryType.replaceAll("_", " ")}
                  </Txt>
                )}
                {!!p.proposedLinkage && (
                  <Card>
                    <Txt bold>Reconciliation</Txt>
                    <Txt>
                      {p.proposedLinkage.type === "internal"
                        ? "Mark as an internal transfer"
                        : "Allocate this reimbursement to the following expenses"}
                    </Txt>
                    {(
                      p.proposedLinkage.reimbursesAllocations ||
                      p.proposedLinkage.allocations ||
                      []
                    ).map((a: any, i: number) => (
                      <Txt key={i}>
                        {money(a.amount)} ·{" "}
                        {a.label ||
                          a.description ||
                          a.transactionId ||
                          a.targetTransactionId ||
                          "Linked expense"}
                      </Txt>
                    ))}
                  </Card>
                )}
                {p.status === "proposed" && !closed && (
                  <View style={styles.row}>
                    <Button
                      title="Accept"
                      disabled={busy}
                      onPress={() =>
                        void run(() =>
                          call("decideAgentProposal", p.id, "accept"),
                        )
                      }
                    />
                    <Button
                      title="Reject"
                      disabled={busy}
                      secondary
                      onPress={() =>
                        void run(() =>
                          call("decideAgentProposal", p.id, "reject"),
                        )
                      }
                    />
                  </View>
                )}
              </View>
            ))}
          </Card>
        )}
      />
      {!closed && (
        <SafeAreaView
          edges={["bottom"]}
          style={{
            backgroundColor: colors.card,
            padding: 16,
            borderTopWidth: 1,
            borderTopColor: colors.line,
          }}
        >
          <Button
            title={
              busy
                ? "Checking…"
                : `Review & save ${d?.reviewSummary?.selected || 0} rows`
            }
            disabled={busy || !d?.reviewSummary?.selected}
            onPress={() => void save()}
          />
        </SafeAreaView>
      )}
    </View>
  );
}
export function DraftRowScreen({ route, navigation }: any) {
  const { row, draftId, mode } = route.params;
  const { call } = useApi();
  const categories = useResource("getCategories", { scope: "settings" });
  const accounts = useResource("getAccountNumbers");
  return (
    <Screen>
      <Heading
        title="Edit staged transaction"
        subtitle="Changes stay in the draft until you save the import."
      />
      <State {...categories} />
      <State {...accounts} />
      {mode === "main" && Number(row.currentPayload?.amountIn) > 0 && (
        <Button
          title="Allocate reimbursement"
          secondary
          onPress={() =>
            navigation.navigate("ImportAllocation", { draftId, rowId: row.id })
          }
        />
      )}
      {!!row.currentPayload?.linkage && (
        <Button
          title="Clear reconciliation links"
          secondary
          onPress={async () => {
            try {
              await call("updateAgentDraftRow", draftId, row.id, {
                expectedVersion: row.version,
                currentPayload: { ...row.currentPayload, linkage: null },
                reviewStatus: "edited",
              });
              navigation.goBack();
            } catch (error) {
              notice(error);
            }
          }}
        />
      )}
      <Form
        initial={{
          ...row.currentPayload,
          internal: row.currentPayload?.linkage?.type === "internal",
        }}
        fields={[
          { key: "description", label: "Description", required: true },
          { key: "label", label: "Label" },
          {
            key: "categoryId",
            label: "Category",
            options: [
              { label: "Unassigned", value: "" },
              ...(categories.data || []).map((c: any) => ({
                label: c.name,
                value: c.id,
              })),
            ],
          },
          ...(mode === "main"
            ? [
                {
                  key: "internal",
                  label: "Internal transfer",
                  type: "boolean" as const,
                },
                {
                  key: "accountIdentifier",
                  label: "Account",
                  options: (accounts.data || []).map((a: any) => ({
                    label: a.accountIdentifier,
                    value: a.accountIdentifier,
                  })),
                },
              ]
            : []),
        ]}
        onSave={async (v) => {
          const { internal, ...payload } = v;
          await call("updateAgentDraftRow", draftId, row.id, {
            expectedVersion: row.version,
            currentPayload: {
              ...payload,
              categoryId: v.categoryId || null,
              ...(mode === "main"
                ? {
                    linkage: internal
                      ? { type: "internal" }
                      : row.currentPayload?.linkage?.type === "internal"
                        ? null
                        : row.currentPayload?.linkage || null,
                  }
                : {}),
            },
            reviewStatus: "edited",
          });
          navigation.goBack();
        }}
      />
    </Screen>
  );
}
