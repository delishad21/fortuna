import React, { useContext, useEffect, useState } from "react";
import { DraftContext } from "./imports";
import { useApi, useResource } from "./api";
import {
  Button,
  Card,
  Chips,
  Input,
  Heading,
  money,
  Screen,
  State,
  TransactionRow,
  Txt,
  notice,
} from "./ui";
export function ImportAllocationScreen({ route, navigation }: any) {
  const { batches, setBatches } = useContext(DraftContext);
  const { call } = useApi();
  const draftId = route.params.draftId;
  const staged = useResource(
    draftId ? "getAgentDraft" : "getCurrentUser",
    ...(draftId ? [draftId] : []),
  );
  const draft = staged.data?.draft;
  const draftRow = draft?.rows.find((r: any) => r.id === route.params.rowId);
  const batch = draftId
    ? draft && {
        transactions: draft.rows.map((r: any) => r.currentPayload),
        tripId: draft.targetTripId,
      }
    : batches[0];
  const index = draftId
    ? draft?.rows.findIndex((r: any) => r.id === route.params.rowId)
    : route.params.index;
  const item = batch?.transactions[index];
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("This statement");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [allocations, setAllocations] = useState<Record<string, any>>({});
  const [baseAmount, setBaseAmount] = useState(
    String(item?.linkage?.reimbursementBaseAmount ?? item?.amountIn ?? ""),
  );
  const [rate, setRate] = useState(
    String(item?.linkage?.reimbursingFxRate ?? 1),
  );
  const [initializedItem, setInitializedItem] = useState("");
  const saved = useResource(
    batch?.tripId
      ? "searchTripEntriesForReimbursement"
      : "searchTransactionsForReimbursement",
    ...(batch?.tripId
      ? [batch.tripId, { search, offset, limit: 20 }]
      : [search, 20, offset, { transactionType: "out" }]),
  );
  const stagedTargets = useResource("getStagedReimbursementTargets");
  useEffect(() => {
    if (!item) return;
    const itemKey = draftId
      ? `${draftId}:${route.params.rowId}:${draftRow?.version || ""}`
      : `batch:${index}`;
    if (initializedItem === itemKey) return;
    const next: Record<string, any> = {};
    for (const allocation of item.linkage?.reimbursesAllocations || []) {
      const target = typeof allocation.pendingBatchIndex === "number"
        ? batch?.transactions[allocation.pendingBatchIndex]
        : allocation.stagedDraftId && allocation.stagedRowId
          ? {
              stagedDraftId: allocation.stagedDraftId,
              stagedRowId: allocation.stagedRowId,
              description: allocation.targetDescription || "Staged transaction",
              date: allocation.targetDate,
            }
          : {
              id: allocation.transactionId,
              description: allocation.targetDescription || "Saved transaction",
              date: allocation.targetDate,
            };
      const key = typeof allocation.pendingBatchIndex === "number"
        ? `pending:${allocation.pendingBatchIndex}`
        : allocation.stagedDraftId && allocation.stagedRowId
          ? `staged:${allocation.stagedDraftId}:${allocation.stagedRowId}`
          : String(allocation.transactionId);
      next[key] = { row: target, amount: String(allocation.amount) };
    }
    setAllocations(next);
    setBaseAmount(String(item.linkage?.reimbursementBaseAmount ?? item.amountIn ?? ""));
    setRate(String(item.linkage?.reimbursingFxRate ?? 1));
    setInitializedItem(itemKey);
  }, [batch, draftId, draftRow?.version, index, initializedItem, item, route.params.rowId]);
  if (!batch || !item)
    return (
      <Screen>
        <State {...staged} />
        {!staged.loading && <Txt>This statement is no longer pending.</Txt>}
      </Screen>
    );
  const total = Number(batch.tripId ? baseAmount : item.amountIn);
  const allocated = Object.values(allocations).reduce(
    (sum, a) => sum + Number(a.amount || 0),
    0,
  );
  const pending = batch.transactions
    .map((t: any, i: number) => ({
      ...t,
      candidateKey: `pending:${i}`,
      pendingBatchIndex: i,
    }))
    .filter(
      (t: any) =>
        t.pendingBatchIndex !== index &&
        Number(t.amountOut) > 0 &&
        `${t.label || ""} ${t.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  const rows =
    tab === "This statement"
      ? pending
      : tab === "Staged"
        ? (stagedTargets.data?.transactions || [])
            .filter(
              (t: any) =>
                (!draftId || t.stagedDraftId !== draftId) &&
                `${t.label || ""} ${t.description}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            )
            .map((t: any) => ({
              ...t,
              candidateKey: `staged:${t.stagedDraftId}:${t.stagedRowId}`,
              amountOut: t.amountOut || t.amountIn,
            }))
        : (saved.data?.transactions || []).map((t: any) => ({
          ...t,
          candidateKey: t.id,
        }));
  return (
    <Screen>
      <Heading
        title="Allocate reimbursement"
        subtitle="Choose expenses in this statement or your saved ledger."
      />
      <Txt muted>Saving replaces this row’s existing allocations.</Txt>
      {batch.tripId && (
        <Card>
          <Input
            label="Reimbursement in base currency"
            value={baseAmount}
            onChangeText={setBaseAmount}
            keyboardType="decimal-pad"
          />
          <Input
            label="Exchange rate to base"
            value={rate}
            onChangeText={setRate}
            keyboardType="decimal-pad"
          />
        </Card>
      )}
      <Txt bold>{money(total - allocated)} remaining</Txt>
      <Chips
        values={
          batch.tripId
            ? ["This statement", "Saved expenses"]
            : ["This statement", "Staged", "Saved expenses"]
        }
        value={tab}
        onChange={setTab}
      />
      <Input
        label="Search expenses"
        value={search}
        onChangeText={(v: string) => {
          setSearch(v);
          setOffset(0);
        }}
      />
      {tab === "Saved expenses" && <State {...saved} />}
      {tab === "Staged" && <State {...stagedTargets} />}
      {rows.map((row: any) => (
        <TransactionRow
          key={row.candidateKey}
          item={row}
          selected={!!allocations[row.candidateKey]}
          onPress={() =>
            setAllocations((old) => {
              const next = { ...old };
              if (next[row.candidateKey]) delete next[row.candidateKey];
              else
                next[row.candidateKey] = {
                  row,
                  amount: String(
                    Math.max(
                      0,
                      Math.min(
                        total - allocated,
                        Number(
                          row.remainingBase ?? row.amountOut ?? row.baseAmount,
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
      {tab === "Saved expenses" && (
        <>
          <Button
            title="Previous"
            secondary
            disabled={!offset}
            onPress={() => setOffset(offset - 20)}
          />
          <Button
            title="Next"
            secondary
            disabled={offset + 20 >= (saved.data?.total || 0)}
            onPress={() => setOffset(offset + 20)}
          />
        </>
      )}
      {Object.entries(allocations).map(([key, a]) => (
        <Input
          key={key}
          label={`${a.row.label || a.row.description}${batch.tripId ? " (base currency)" : ""}`}
          value={a.amount}
          onChangeText={(amount: string) =>
            setAllocations((old) => ({ ...old, [key]: { ...a, amount } }))
          }
          keyboardType="decimal-pad"
        />
      ))}
      <Button
        title="Save allocations"
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
            if (batch.tripId && !(Number(rate) > 0))
              throw new Error("Enter a positive exchange rate");
            const reimbursesAllocations = Object.values(allocations).map(
              (a) => ({
                ...(a.row.pendingBatchIndex !== undefined
                  ? { pendingBatchIndex: a.row.pendingBatchIndex }
                  : a.row.stagedDraftId && a.row.stagedRowId
                    ? {
                        stagedDraftId: a.row.stagedDraftId,
                        stagedRowId: a.row.stagedRowId,
                        targetDescription: a.row.label || a.row.description,
                        targetDate: a.row.date,
                      }
                    : { transactionId: a.row.id }),
                amount: Number(a.amount),
                ...(batch.tripId ? { amountBase: Number(a.amount) } : {}),
              }),
            );
            if (draftId) {
              await call("updateAgentDraftRow", draftId, draftRow.id, {
                expectedVersion: draftRow.version,
                currentPayload: {
                  ...item,
                  linkage: {
                    type: "reimbursement",
                    reimbursesAllocations,
                    leftoverAmount: total - allocated,
                  },
                },
                reviewStatus: "edited",
              });
              navigation.pop(2);
              return;
            }
            setBatches((old) =>
              old.map((b, bi) =>
                bi === 0
                  ? {
                      ...b,
                      transactions: b.transactions.map((t, ti) =>
                        ti === index
                          ? {
                              ...t,
                              ...(batch.tripId
                                ? { entryType: "reimbursement" }
                                : {}),
                              linkage: {
                                type: "reimbursement",
                                reimbursesAllocations,
                                leftoverAmount: total - allocated,
                                ...(batch.tripId
                                  ? {
                                      reimbursementBaseAmount: total,
                                      reimbursingFxRate: Number(rate),
                                    }
                                  : {}),
                              },
                            }
                          : t,
                      ),
                    }
                  : b,
              ),
            );
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
