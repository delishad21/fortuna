import React, { useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { Txt, Button, TransactionRow, useTheme } from "../ui";
import {
  useChatApi,
  ComponentBlock,
  ComponentRow,
  changeLabel,
  fetchTransactionPage,
  formatMoney,
  groupLabel,
  periodLabel,
} from "./api";

const OTHER = "#9CA3AF";
type Of<K extends ComponentBlock["component"]> = Extract<
  ComponentBlock,
  { component: K }
>;

function Frame({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: 14,
        padding: 14,
        gap: 12,
      }}
    >
      <View style={{ gap: 2 }}>
        <Txt bold accessibilityRole="header">
          {title}
        </Txt>
        {!!aside && (
          <Txt muted size={12}>
            {aside}
          </Txt>
        )}
      </View>
      {children}
    </View>
  );
}

function TransactionList({
  block,
  onOpenTransaction,
}: {
  block: Of<"transaction_list">;
  onOpenTransaction: (id: string) => void;
}) {
  const api = useChatApi();
  const [rows, setRows] = useState<ComponentRow[]>(block.rows),
    [total, setTotal] = useState(block.total),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const remaining = total - rows.length;
  async function more() {
    setLoading(true);
    setError("");
    try {
      const page = await fetchTransactionPage(api, block.query, rows.length);
      const seen = new Set(rows.map((r) => r.id));
      setRows([...rows, ...page.rows.filter((r) => !seen.has(r.id))]);
      setTotal(page.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Frame
      title={block.title}
      aside={`${total.toLocaleString()} ${total === 1 ? "transaction" : "transactions"}`}
    >
      <View>
        {rows.map((row) => (
          <TransactionRow
            key={row.id}
            item={row}
            onPress={() => onOpenTransaction(row.id)}
          />
        ))}
        {!rows.length && <Txt muted>No matching transactions.</Txt>}
      </View>
      {remaining > 0 && (
        <Button
          secondary
          disabled={loading}
          title={
            loading
              ? "Loading…"
              : `Load ${Math.min(remaining, 50)} more of ${remaining}`
          }
          onPress={() => void more()}
        />
      )}
      {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
    </Frame>
  );
}

function SummaryTiles({ block }: { block: Of<"summary_tiles"> }) {
  const { colors } = useTheme();
  return (
    <Frame title={block.title}>
      {!block.currencies.length && (
        <Txt muted>No transactions in this period.</Txt>
      )}
      {block.currencies.map((c) => (
        <View key={c.currency} style={{ gap: 8 }}>
          {block.currencies.length > 1 && (
            <Txt muted bold size={12}>
              {c.currency}
            </Txt>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(
              [
                ["Spent", formatMoney(c.expense, c.currency), "expense"],
                ["Income", formatMoney(c.income, c.currency), "income"],
                ["Net", formatMoney(c.net, c.currency), "net"],
                ["Transactions", c.count.toLocaleString(), "count"],
              ] as const
            ).map(([label, value, key]) => {
              const change = changeLabel(
                String(c[key]),
                c.previous && String(c.previous[key]),
              );
              return (
                <View
                  key={key}
                  style={{
                    flexBasis: "47%",
                    flexGrow: 1,
                    backgroundColor: colors.bg,
                    borderRadius: 12,
                    padding: 12,
                    gap: 2,
                  }}
                >
                  <Txt muted size={12}>
                    {label}
                  </Txt>
                  <Txt bold size={17}>
                    {value}
                  </Txt>
                  {!!change && (
                    <Txt muted size={11}>
                      {change}
                    </Txt>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </Frame>
  );
}

function Breakdown({ block }: { block: Of<"breakdown"> }) {
  const { colors } = useTheme();
  return (
    <Frame
      title={block.title}
      aside={`Spending by ${groupLabel[block.groupBy].toLowerCase()}`}
    >
      {!block.series.length && <Txt muted>No spending in this period.</Txt>}
      {block.series.map((s) => {
        const max = Math.max(...s.items.map((i) => Number(i.amount)), 0);
        return (
          <View key={s.currency} style={{ gap: 10 }}>
            <Txt muted size={12}>
              Total {formatMoney(s.total, s.currency)}
            </Txt>
            {s.items.map((item) => {
              const share = Number(s.total)
                ? (Number(item.amount) / Number(s.total)) * 100
                : 0;
              const color = item.other
                ? OTHER
                : block.groupBy === "category"
                  ? item.color || colors.purple
                  : colors.purple;
              return (
                <View
                  key={item.name}
                  accessible
                  accessibilityLabel={`${item.name}, ${formatMoney(item.amount, s.currency)}, ${share.toFixed(0)} percent`}
                  style={{ gap: 4 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>
                      {item.name}
                    </Txt>
                    <Txt bold size={13}>
                      {formatMoney(item.amount, s.currency)}{" "}
                      <Txt muted size={11}>
                        {share.toFixed(0)}%
                      </Txt>
                    </Txt>
                  </View>
                  <View
                    style={{
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: colors.line,
                    }}
                  >
                    <View
                      style={{
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: color,
                        width: `${max ? Math.max((Number(item.amount) / max) * 100, 1) : 0}%`,
                      }}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </Frame>
  );
}

function Trend({ block }: { block: Of<"trend"> }) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<Record<string, number>>({});
  return (
    <Frame title={block.title} aside={`Spending per ${block.interval}`}>
      {!block.series.length && <Txt muted>No transactions in this period.</Txt>}
      {block.series.map((s) => {
        const max = Math.max(...s.points.map((p) => Number(p.expense)), 0);
        const index = selected[s.currency] ?? s.points.length - 1;
        const point = s.points[index];
        const dense = s.points.length > 24;
        const bars = s.points.map((p, i) => (
          <Pressable
            key={p.period}
            accessibilityRole="button"
            accessibilityLabel={`${periodLabel(p.period, block.interval)}, spent ${formatMoney(p.expense, s.currency)}`}
            onPress={() => setSelected({ ...selected, [s.currency]: i })}
            style={{
              width: dense ? 14 : undefined,
              flex: dense ? undefined : 1,
              height: "100%",
              justifyContent: "flex-end",
              paddingHorizontal: 1,
            }}
          >
            <View
              style={{
                height: `${max ? Math.max((Number(p.expense) / max) * 100, Number(p.expense) ? 2 : 0) : 0}%`,
                width: "100%",
                maxWidth: 28,
                alignSelf: "center",
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
                backgroundColor: colors.purple,
                opacity: i === index ? 1 : 0.55,
              }}
            />
          </Pressable>
        ));
        return (
          <View key={s.currency} style={{ gap: 8 }}>
            {point && (
              <View>
                <Txt muted size={12}>
                  {block.series.length > 1 ? `${s.currency} · ` : ""}
                  {periodLabel(point.period, block.interval)}
                </Txt>
                <Txt bold size={17}>
                  Spent {formatMoney(point.expense, s.currency)}
                </Txt>
                <Txt muted size={12}>
                  Income {formatMoney(point.income, s.currency)}
                </Txt>
              </View>
            )}
            {dense ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ height: 140, alignItems: "flex-end" }}
              >
                {bars}
              </ScrollView>
            ) : (
              <View
                style={{
                  height: 140,
                  flexDirection: "row",
                  alignItems: "flex-end",
                }}
              >
                {bars}
              </View>
            )}
            {s.points.length > 0 && (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Txt muted size={11}>
                  {periodLabel(s.points[0].period, block.interval)}
                </Txt>
                <Txt muted size={11}>
                  {periodLabel(
                    s.points[s.points.length - 1].period,
                    block.interval,
                  )}
                </Txt>
              </View>
            )}
          </View>
        );
      })}
    </Frame>
  );
}

export function ChatComponent({
  block,
  onOpenTransaction,
}: {
  block: ComponentBlock;
  onOpenTransaction: (id: string) => void;
}) {
  if (block.component === "transaction_list")
    return (
      <TransactionList block={block} onOpenTransaction={onOpenTransaction} />
    );
  if (block.component === "summary_tiles")
    return <SummaryTiles block={block} />;
  if (block.component === "breakdown") return <Breakdown block={block} />;
  if (block.component === "trend") return <Trend block={block} />;
  return null;
}
