import React, { useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useApi, useResource } from "./api";
import {
  Button,
  Card,
  Choice,
  confirm,
  Form,
  Heading,
  Input,
  money,
  notice,
  Screen,
  State,
  styles,
  today,
  TransactionRow,
  Txt,
  useTheme,
} from "./ui";
import { shareCsv } from "./sharing";
export function TransactionsScreen({ navigation, route }: any) {
  const { call } = useApi();
  const { colors } = useTheme();
  const [search, setSearch] = useState(route.params?.search || "");
  const [query, setQuery] = useState(search);
  const [filters, setFilters] = useState<any>({});
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const result = useResource("getTransactions", {
    ...filters,
    search: query,
    limit: 50,
    offset,
  });
  const categories = useResource("getCategories");
  const accounts = useResource("getAccountNumbers");
  const items = result.data?.transactions || [];
  const reload = async () => {
    setSelected([]);
    await result.reload();
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={result.loading}
            onRefresh={result.reload}
          />
        }
        ListHeaderComponent={
          <View style={styles.stack}>
            <Heading
              title="Your transactions"
              subtitle={`${result.data?.total ?? 0} transactions`}
            />
            <Input
              label="Search transactions"
              value={search}
              onChangeText={setSearch}
              placeholder="Merchant, label or description"
            />
            <View style={styles.row}>
              <Button
                title="Filters"
                secondary
                icon="options-outline"
                onPress={() => setShowFilters(!showFilters)}
              />
              <Button
                title={selecting ? "Done" : "Select"}
                secondary
                onPress={() => {
                  setSelecting(!selecting);
                  setSelected([]);
                }}
              />
            </View>
            {showFilters && (
              <Card>
                <Form
                  initial={filters}
                  submit="Apply filters"
                  fields={[
                    { key: "dateFrom", label: "From", type: "date" },
                    { key: "dateTo", label: "To", type: "date" },
                    {
                      key: "minAmount",
                      label: "Minimum amount",
                      type: "number",
                    },
                    {
                      key: "maxAmount",
                      label: "Maximum amount",
                      type: "number",
                    },
                    {
                      key: "transactionType",
                      label: "Type",
                      options: [
                        { label: "All", value: "" },
                        { label: "Income", value: "income" },
                        { label: "Expense", value: "expense" },
                      ],
                    },
                    {
                      key: "category",
                      label: "Category",
                      options: [
                        { label: "All", value: "" },
                        ...(categories.data || []).map((c: any) => ({
                          label: c.name,
                          value: c.id,
                        })),
                      ],
                    },
                    {
                      key: "accountIdentifier",
                      label: "Account",
                      options: [
                        { label: "All", value: "" },
                        ...(accounts.data || []).map((a: any) => ({
                          label: a.accountIdentifier,
                          value: a.accountIdentifier,
                        })),
                      ],
                    },
                    {
                      key: "dateOrder",
                      label: "Order",
                      options: [
                        { label: "Newest first", value: "desc" },
                        { label: "Oldest first", value: "asc" },
                      ],
                    },
                  ]}
                  onSave={async (v) => {
                    const { category, ...rest } = v;
                    setFilters(
                      Object.fromEntries(
                        Object.entries({
                          ...rest,
                          ...(category ? { categoryIds: [category] } : {}),
                        }).filter(([, value]) => value !== ""),
                      ),
                    );
                    setOffset(0);
                    setShowFilters(false);
                  }}
                />
                <Button
                  title="Reset filters"
                  secondary
                  onPress={() => {
                    setFilters({});
                    setOffset(0);
                    setShowFilters(false);
                  }}
                />
              </Card>
            )}
            {selecting && (
              <Card>
                <Txt bold>{selected.length} selected</Txt>
                <Button
                  title="Select this page"
                  secondary
                  onPress={() => setSelected(items.map((i: any) => i.id))}
                />
                <Choice
                  label="Category"
                  value={category}
                  options={(categories.data || []).map((c: any) => ({
                    label: c.name,
                    value: c.id,
                  }))}
                  onChange={setCategory}
                />
                <Button
                  title="Categorize selected"
                  disabled={!selected.length || !category}
                  onPress={() =>
                    confirm(
                      "Update selected transactions?",
                      `Apply this category to ${selected.length} transactions.`,
                      async () => {
                        await call("bulkUpdateTransactionsByIds", selected, {
                          categoryId: category,
                        });
                        await reload();
                      },
                    )
                  }
                />
                <Button
                  title="Delete selected"
                  danger
                  secondary
                  disabled={!selected.length}
                  onPress={() =>
                    confirm(
                      "Delete transactions?",
                      `Permanently delete ${selected.length} transactions.`,
                      async () => {
                        await call("bulkDeleteTransactionsByIds", selected);
                        await reload();
                      },
                    )
                  }
                />
              </Card>
            )}
            <Button
              title={
                selected.length ? "Export selected CSV" : "Export filtered CSV"
              }
              secondary
              icon="share-outline"
              onPress={() =>
                void call<string>(
                  "exportTransactionsCsv",
                  selected.length
                    ? { ids: selected }
                    : { filters: { ...filters, search: query } },
                )
                  .then((csv) => shareCsv("fortuna-transactions.csv", csv))
                  .catch(notice)
              }
            />
            <State {...result} />
          </View>
        }
        renderItem={({ item }) => (
          <TransactionRow
            item={item}
            selected={selected.includes(item.id)}
            onPress={() =>
              selecting
                ? setSelected((old) =>
                    old.includes(item.id)
                      ? old.filter((id) => id !== item.id)
                      : [...old, item.id],
                  )
                : navigation.navigate("Transaction", { item })
            }
          />
        )}
        ListEmptyComponent={
          !result.loading && !result.error ? (
            <State empty="No transactions match these filters." />
          ) : null
        }
        ListFooterComponent={
          <View style={[styles.between, { paddingTop: 18 }]}>
            <Button
              title="Previous"
              secondary
              disabled={offset === 0}
              onPress={() => setOffset(Math.max(0, offset - 50))}
            />
            <Txt muted>{Math.floor(offset / 50) + 1}</Txt>
            <Button
              title="Next"
              secondary
              disabled={offset + 50 >= (result.data?.total || 0)}
              onPress={() => setOffset(offset + 50)}
            />
          </View>
        }
      />
    </View>
  );
}
export function TransactionScreen({ navigation, route }: any) {
  const item = route.params.item;
  const { call } = useApi();
  const categories = useResource("getCategories");
  const accounts = useResource("getAccountNumbers");
  const links = useResource("getLinkedTransactions", item.id);
  return (
    <Screen>
      <Heading
        title={item.label || "Transaction details"}
        subtitle={item.description}
      />
      <Card>
        <Txt style={[styles.money, { fontSize: 30, lineHeight: 40 }]}>
          {money(Number(item.amountIn) - Number(item.amountOut), item.currency)}
        </Txt>
        <Txt muted>
          {String(item.date).slice(0, 10)} ·{" "}
          {item.accountIdentifier || "No account"}
        </Txt>
      </Card>
      <Card>
        <Form
          initial={{
            ...item,
            date: String(item.date).slice(0, 10),
            categoryId: item.category?.id || item.categoryId || "",
            amountIn: item.amountIn || 0,
            amountOut: item.amountOut || 0,
          }}
          fields={[
            { key: "description", label: "Description", required: true },
            { key: "label", label: "Label" },
            { key: "date", label: "Date", type: "date", required: true },
            { key: "amountIn", label: "Money in", type: "number" },
            { key: "amountOut", label: "Money out", type: "number" },
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
            {
              key: "accountIdentifier",
              label: "Account",
              options: (accounts.data || []).map((a: any) => ({
                label: a.accountIdentifier,
                value: a.accountIdentifier,
              })),
            },
          ]}
          onSave={async (v) => {
            const {
              description,
              label,
              date,
              amountIn,
              amountOut,
              categoryId,
              accountIdentifier,
            } = v;
            if (
              amountIn < 0 ||
              amountOut < 0 ||
              (amountIn > 0 && amountOut > 0)
            )
              throw new Error("Enter one positive income or expense amount");
            await call("updateTransaction", item.id, {
              description,
              label,
              date,
              amountIn,
              amountOut,
              categoryId: categoryId || null,
              accountIdentifier,
            });
            navigation.goBack();
          }}
        />
      </Card>
      <Button
        title="Split transaction"
        secondary
        onPress={() => navigation.navigate("Split", { item })}
      />
      <Button
        title="Link reimbursement"
        secondary
        disabled={!(Number(item.amountIn) > 0)}
        onPress={() => navigation.navigate("Reimbursement", { item })}
      />
      <Button
        title="Mark as internal transfer"
        secondary
        onPress={() =>
          confirm(
            "Mark internal?",
            "This changes how the transaction is included in analytics.",
            async () => {
              await call("updateTransaction", item.id, {
                linkage: { type: "internal" },
              });
              navigation.goBack();
            },
          )
        }
      />
      <Button
        title="Clear links"
        secondary
        onPress={() =>
          confirm(
            "Clear linkage?",
            "Remove reimbursement or transfer links from this transaction.",
            async () => {
              await call("updateTransaction", item.id, { linkage: null });
              navigation.goBack();
            },
          )
        }
      />
      <State {...links} />
      {links.data && (
        <Card>
          <Txt bold>Linked transactions</Txt>
          {Object.values(links.data)
            .flatMap((v: any) => (Array.isArray(v) ? v : []))
            .map((link: any, index: number) => (
              <Txt key={index}>
                {link.description ||
                  link.transaction?.description ||
                  link.label ||
                  "Linked allocation"}{" "}
                {link.amount ? money(link.amount) : ""}
              </Txt>
            ))}
        </Card>
      )}
      <Button
        title="Delete transaction"
        danger
        secondary
        onPress={() =>
          confirm(
            "Delete transaction?",
            "This permanently removes the transaction.",
            async () => {
              await call("deleteTransaction", item.id);
              navigation.goBack();
            },
          )
        }
      />
    </Screen>
  );
}
export function SplitScreen({ navigation, route }: any) {
  const { item } = route.params;
  const { call } = useApi();
  const categories = useResource("getCategories");
  const field = Number(item.amountIn) > 0 ? "amountIn" : "amountOut";
  const total = Number(item[field]);
  const [parts, setParts] = useState<any[]>([
    { description: item.description, amount: "", categoryId: "" },
    { description: "", amount: "", categoryId: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const remainder =
    total - parts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return (
    <Screen>
      <Heading
        title="Split your transaction"
        subtitle="Keep the total. Give each part its own purpose."
      />
      <Card>
        <Txt bold>{money(total)} total</Txt>
        <Txt muted>{money(remainder)} left to allocate</Txt>
      </Card>
      {parts.map((part, i) => (
        <Card key={i}>
          <Txt bold>Part {i + 1}</Txt>
          <Input
            label="Description"
            value={part.description}
            onChangeText={(v: string) =>
              setParts((old) =>
                old.map((p, n) => (n === i ? { ...p, description: v } : p)),
              )
            }
          />
          <Input
            label="Amount"
            value={part.amount}
            keyboardType="decimal-pad"
            onChangeText={(v: string) =>
              setParts((old) =>
                old.map((p, n) => (n === i ? { ...p, amount: v } : p)),
              )
            }
          />
          <Choice
            label="Category"
            value={part.categoryId}
            options={(categories.data || []).map((c: any) => ({
              label: c.name,
              value: c.id,
            }))}
            onChange={(v) =>
              setParts((old) =>
                old.map((p, n) => (n === i ? { ...p, categoryId: v } : p)),
              )
            }
          />
          {parts.length > 2 && (
            <Button
              title="Remove part"
              secondary
              onPress={() => setParts((old) => old.filter((_, n) => n !== i))}
            />
          )}
        </Card>
      ))}
      <Button
        title="Add another part"
        secondary
        onPress={() =>
          setParts([...parts, { description: "", amount: "", categoryId: "" }])
        }
      />
      <Button
        title={busy ? "Splitting…" : "Confirm split"}
        disabled={
          busy ||
          Math.abs(remainder) > 0.005 ||
          parts.some((p) => !p.description.trim() || !(Number(p.amount) > 0))
        }
        onPress={async () => {
          setBusy(true);
          try {
            await call(
              "splitTransaction",
              item.id,
              parts.map((p) => ({
                description: p.description,
                categoryId: p.categoryId || null,
                [field]: Number(p.amount),
              })),
            );
            navigation.pop(2);
          } catch (err) {
            notice(err);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
export function ReimbursementScreen({ navigation, route }: any) {
  const { item, tripId } = route.params;
  const { call } = useApi();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [allocations, setAllocations] = useState<
    Record<string, { item: any; amount: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const candidates = useResource(
    tripId
      ? "searchTripEntriesForReimbursement"
      : "searchTransactionsForReimbursement",
    ...(tripId
      ? [tripId, { search, excludeEntryId: item.id, offset, limit: 20 }]
      : [search, 20, offset, { transactionType: "out" }]),
  );
  const total = Number(tripId ? item.baseAmount : item.amountIn);
  const allocated = Object.values(allocations).reduce(
    (s, v) => s + Number(v.amount || 0),
    0,
  );
  return (
    <Screen>
      <Heading
        title="Match reimbursement"
        subtitle="Allocate the money received to the expenses it covers."
      />
      <Card>
        <Txt bold>
          {money(total)} received · {money(total - allocated)} remaining
        </Txt>
      </Card>
      <Input
        label="Find an expense"
        value={search}
        onChangeText={(v: string) => {
          setSearch(v);
          setOffset(0);
        }}
      />
      <State {...candidates} />
      {(candidates.data?.transactions || [])
        .filter((c: any) => c.id !== item.id)
        .map((c: any) => (
          <TransactionRow
            key={c.id}
            item={c}
            selected={!!allocations[c.id]}
            onPress={() =>
              setAllocations((old) => {
                const next = { ...old };
                if (next[c.id]) delete next[c.id];
                else
                  next[c.id] = {
                    item: c,
                    amount: String(
                      Math.max(
                        0,
                        Math.min(
                          total - allocated,
                          Number(
                            c.remainingBase ?? c.amountOut ?? c.baseAmount,
                          ),
                        ),
                      ),
                    ),
                  };
                return next;
              })
            }
          />
        ))}
      <View style={styles.between}>
        <Button
          title="Previous"
          secondary
          disabled={!offset}
          onPress={() => setOffset(offset - 20)}
        />
        <Button
          title="Next"
          secondary
          disabled={offset + 20 >= (candidates.data?.total || 0)}
          onPress={() => setOffset(offset + 20)}
        />
      </View>
      {Object.entries(allocations).map(([id, a]) => (
        <Input
          key={id}
          label={a.item.label || a.item.description}
          value={a.amount}
          keyboardType="decimal-pad"
          onChangeText={(amount: string) =>
            setAllocations((old) => ({ ...old, [id]: { ...a, amount } }))
          }
        />
      ))}
      <Button
        title={busy ? "Linking…" : "Confirm allocations"}
        disabled={
          busy ||
          !(total > 0) ||
          allocated > total + 0.005 ||
          !Object.keys(allocations).length ||
          Object.values(allocations).some((a) => !(Number(a.amount) > 0))
        }
        onPress={async () => {
          setBusy(true);
          try {
            const values = Object.entries(allocations).map(
              ([transactionId, a]) => ({
                transactionId,
                amount: Number(a.amount),
              }),
            );
            if (tripId)
              await call("createTripReimbursementLink", tripId, item.id, {
                reimbursedAllocations: values.map((v) => ({
                  transactionId: v.transactionId,
                  amountBase: v.amount,
                })),
              });
            else
              await call("updateTransaction", item.id, {
                linkage: {
                  type: "reimbursement",
                  reimbursesAllocations: values,
                  leftoverAmount: total - allocated,
                },
              });
            navigation.goBack();
          } catch (e) {
            notice(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
