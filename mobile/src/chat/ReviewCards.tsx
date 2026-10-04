import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Modal,
  ScrollView,
  Pressable,
  AppState,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Input, Txt, Choice, useTheme } from "../ui";
import {
  useChatApi,
  TransactionReview,
  ReviewRow,
  reviewSuggestionSummary,
  isUnsure,
} from "./api";
import { Expandable } from "./Details";
import { accountDisplay } from "../../../frontend/shared/accounts";
export function ChatReviewCards({
  id,
  onSubmitted,
}: {
  id: string;
  onSubmitted: () => Promise<void>;
}) {
  const api = useChatApi(),
    { colors } = useTheme();
  const [review, setReview] = useState<TransactionReview | null>(null),
    [editing, setEditing] = useState<ReviewRow | null>(null),
    [form, setForm] = useState<any>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(false),
    key = useRef<string | null>(null);
  active.current = busy;
  useEffect(() => {
    let dead = false;
    const poll = async () => {
      if (
        active.current ||
        (Platform.OS !== "web" && AppState.currentState !== "active")
      )
        return;
      try {
        const v = await api<TransactionReview>(`/reviews/${id}`);
        if (!dead && !active.current) setReview(v);
      } catch (e) {
        if (!dead) setError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [api, id]);
  async function save() {
    if (!review || !editing || busy) return;
    setBusy(true);
    setError("");
    try {
      const patch: any = {};
      for (const field of [
        "description",
        "label",
        "date",
        "categoryId",
        "accountIdentifier",
        "currency",
        "amountIn",
        "amountOut",
        "balance",
      ]) {
        let value = form[field];
        if (["amountIn", "amountOut", "balance"].includes(field)) {
          if (value !== "" && !Number.isFinite(Number(value)))
            throw new Error(`Enter a valid ${field} amount`);
          value = value === "" ? null : Number(value);
        } else if (
          ["label", "categoryId", "accountIdentifier"].includes(field) &&
          value === ""
        )
          value = null;
        if (value !== editing.value[field]) patch[field] = value;
      }
      if (
        form.type !== (editing.value.linkage?.type || "") ||
        JSON.stringify(form.allocations) !==
          JSON.stringify(editing.value.linkage?.reimbursesAllocations || [])
      )
        patch.linkage = form.type
          ? {
              type: form.type,
              ...(form.type === "reimbursement"
                ? {
                    reimbursesAllocations: form.allocations.map((a: any) => ({
                      transactionId: a.transactionId,
                      stagedDraftId: a.stagedDraftId,
                      stagedRowId: a.stagedRowId,
                      amount: Number(a.amount),
                    })),
                  }
                : {}),
            }
          : null;
      if (Object.keys(patch).length) {
        const v = await api<TransactionReview>(`/reviews/${id}`, {
          method: "PUT",
          body: { rowId: editing.id, version: editing.version, patch },
        });
        setReview({ ...review, ...v });
      }
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      key.current ||= `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await api(`/conversations/${review.conversationId}/messages`, {
        method: "POST",
        body: {
          text: `Here is my completed review: ${review.title}`,
          reviewId: id,
          reviewVersion: review.version,
          idempotencyKey: key.current,
        },
      });
      setReview({ ...review, status: "submitted" });
      await onSubmitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!review) return <Txt>{error || "Loading transaction review…"}</Txt>;
  const closed = review.status !== "pending";
  const suggestions = reviewSuggestionSummary(review.rows, review.categories);
  return (
    <View style={{ gap: 12 }}>
      <Txt bold>{review.title}</Txt>
      {!!review.instructions && <Txt muted>{review.instructions}</Txt>}
      {suggestions.changed > 0 && (
        <View
          style={{ backgroundColor: colors.tint, borderRadius: 8, padding: 10 }}
        >
          <Txt size={13} style={{ color: colors.purple }}>
            Pre-filled · {suggestions.changed} of {suggestions.total} rows
            {suggestions.effects.map((e) => ` · ${e}`).join("")}
          </Txt>
        </View>
      )}
      <Txt muted size={12}>
        {closed
          ? review.status === "submitted"
            ? "Sent to Fortuna"
            : "Closed"
          : "Save each row to sync it"}
      </Txt>
      {!!error && (
        <Txt accessibilityRole="alert" style={{ color: colors.red }}>
          {error}
        </Txt>
      )}
      {review.rows.map((row) => (
        <View
          key={row.id}
          style={{
            padding: 16,
            borderWidth: 1,
            borderColor: isUnsure(row) && !closed ? colors.red : colors.line,
            borderRadius: 12,
            gap: 8,
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Txt bold>{row.value.label || row.value.description}</Txt>
              <Txt muted size={12}>
                {String(row.value.date).slice(0, 10)} ·{" "}
                {row.value.accountIdentifier || "Unassigned"}
              </Txt>
              {!!row.suggestion?.reason && (
                <Txt size={12} style={{ color: colors.purple }}>
                  {isUnsure(row) ? "Check: " : ""}
                  {row.suggestion.reason}
                  {row.suggestion.confidence !== undefined
                    ? ` (${Math.round(row.suggestion.confidence * 100)}% sure)`
                    : ""}
                </Txt>
              )}
            </View>
            {!closed && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${row.value.description}`}
                style={{ padding: 8 }}
                onPress={() => {
                  setError("");
                  setEditing(row);
                  setForm(
                    Object.fromEntries([
                      ...[
                        "description",
                        "label",
                        "date",
                        "categoryId",
                        "accountIdentifier",
                        "amountIn",
                        "amountOut",
                        "balance",
                        "currency",
                      ].map((k) => [
                        k,
                        String(row.value[k] ?? (k === "currency" ? "SGD" : "")),
                      ]),
                      ["type", row.value.linkage?.type || ""],
                      [
                        "allocations",
                        row.value.linkage?.reimbursesAllocations || [],
                      ],
                    ]),
                  );
                }}
              >
                <Ionicons
                  name="create-outline"
                  size={20}
                  color={colors.purple}
                />
              </Pressable>
            )}
          </View>
          <Txt bold>
            {row.value.currency || "SGD"}{" "}
            {row.value.amountOut
              ? `−${Number(row.value.amountOut).toFixed(2)}`
              : `+${Number(row.value.amountIn || 0).toFixed(2)}`}
          </Txt>
          <Txt>
            {review.categories.find((c) => c.id === row.value.categoryId)
              ?.name || "Uncategorized"}
          </Txt>
          <Expandable title="More details">
            <Txt>{row.value.description}</Txt>
            <Txt muted>Balance: {row.value.balance ?? "—"}</Txt>
            <Txt muted>Type: {row.value.linkage?.type || "Standard"}</Txt>
          </Expandable>
        </View>
      ))}
      {!closed && (
        <Button
          title="Send review to Fortuna"
          disabled={busy}
          onPress={() => void submit()}
        />
      )}
      <Modal
        visible={!!editing}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setEditing(null);
        }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 16 }}
          >
            <Txt bold size={22}>
              Edit transaction
            </Txt>
            {!!error && (
              <Txt accessibilityRole="alert" style={{ color: colors.red }}>
                {error}
              </Txt>
            )}
            {[
              "description",
              "label",
              "date",
              "amountIn",
              "amountOut",
              "balance",
              "currency",
            ].map((field) => (
              <View key={field} style={{ gap: 6 }}>
                <Txt>
                  {({ amountIn: "Amount in", amountOut: "Amount out" } as any)[
                    field
                  ] || field[0].toUpperCase() + field.slice(1)}
                </Txt>
                <Input
                  accessibilityLabel={field}
                  value={form[field] || ""}
                  editable={!busy && !closed}
                  keyboardType={
                    ["amountIn", "amountOut", "balance"].includes(field)
                      ? "decimal-pad"
                      : "default"
                  }
                  onChangeText={(v: string) =>
                    setForm((f: any) => ({ ...f, [field]: v }))
                  }
                />
              </View>
            ))}
            <Choice
              label="Category"
              value={form.categoryId}
              options={[
                { label: "Uncategorized", value: "" },
                ...review.categories.map((c) => ({
                  label: c.name,
                  value: c.id,
                })),
              ]}
              onChange={(v) => setForm((f: any) => ({ ...f, categoryId: v }))}
            />
            <Choice
              label="Account"
              value={form.accountIdentifier}
              options={[
                { label: "Unassigned", value: "" },
                ...review.accounts.map((a) => ({
                  label: accountDisplay(a),
                  value: a.accountIdentifier,
                })),
              ]}
              onChange={(v) =>
                setForm((f: any) => ({ ...f, accountIdentifier: v }))
              }
            />
            <Choice
              label="Type"
              value={form.type}
              options={[
                { label: "Standard", value: "" },
                { label: "Internal", value: "internal" },
                { label: "Reimbursement", value: "reimbursement" },
              ]}
              onChange={(v) => setForm((f: any) => ({ ...f, type: v }))}
            />
            {form.type === "reimbursement" && (
              <View style={{ gap: 12 }}>
                <Txt bold>Reimbursement allocations</Txt>
                {(form.allocations || []).map(
                  (allocation: any, index: number) => (
                    <View key={index} style={{ gap: 6 }}>
                      <Txt>
                        {allocation.targetDescription ||
                          review.rows.find(
                            (r) =>
                              r.id ===
                              (allocation.transactionId ||
                                allocation.stagedRowId),
                          )?.value.description ||
                          "Linked transaction"}
                      </Txt>
                      <Input
                        accessibilityLabel={`Allocation ${index + 1} amount`}
                        keyboardType="decimal-pad"
                        value={String(allocation.amount)}
                        onChangeText={(amount: string) =>
                          setForm((f: any) => ({
                            ...f,
                            allocations: f.allocations.map(
                              (a: any, i: number) =>
                                i === index ? { ...a, amount } : a,
                            ),
                          }))
                        }
                      />
                      <Button
                        title="Remove allocation"
                        secondary
                        onPress={() =>
                          setForm((f: any) => ({
                            ...f,
                            allocations: f.allocations.filter(
                              (_: any, i: number) => i !== index,
                            ),
                          }))
                        }
                      />
                    </View>
                  ),
                )}
                <Choice
                  label="Add target from this review"
                  value=""
                  options={review.rows
                    .filter(
                      (r) =>
                        r.id !== editing?.id && Number(r.value.amountOut) > 0,
                    )
                    .map((r) => ({
                      label: `${String(r.value.date).slice(0, 10)} · ${r.value.description}`,
                      value: r.id,
                    }))}
                  onChange={(value) => {
                    const target = review.rows.find((r) => r.id === value);
                    if (target)
                      setForm((f: any) => ({
                        ...f,
                        allocations: [
                          ...f.allocations,
                          {
                            transactionId: target.source.transactionId,
                            stagedDraftId: target.source.draftId,
                            stagedRowId: target.source.rowId,
                            amount: Math.min(
                              Number(target.value.amountOut),
                              Number(f.amountIn),
                            ),
                          },
                        ],
                      }));
                  }}
                />
                <Txt muted size={12}>
                  Unallocated portions remain untargeted. Ask Fortuna to include
                  other targets in this review.
                </Txt>
              </View>
            )}
            <Button
              title="Save transaction"
              disabled={busy || closed}
              onPress={() => void save()}
            />
            <Button
              title="Cancel"
              secondary
              disabled={busy}
              onPress={() => setEditing(null)}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
