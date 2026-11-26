import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApi, useResource } from "./api";
import {
  BRAND,
  Button,
  Card,
  Choice,
  Chips,
  DateField,
  Empty,
  fmtDate,
  fmtMonth,
  Group,
  Dot,
  ListItem,
  Tabs,
  money,
  notice,
  Pill,
  plural,
  Progress,
  Screen,
  Section,
  Segmented,
  Sheet,
  Stat,
  StatGrid,
  State,
  styles,
  tap,
  toast,
  TransactionRow,
  Txt,
  useTheme,
} from "./ui";
import { ColumnChart, Donut, RankBars } from "./charts";
import { shareCsv } from "./sharing";
import { TransactionThumb } from "./images";
import { useWorkflow } from "./workflow";
import { localToday, WORKFLOW_OPTIONS } from "../../frontend/shared/workflow";
import { cardDisplay } from "../../frontend/shared/accountTypes";

/** "2026-10" → "2026-11" */
const nextMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
};

const signed = (n: number, currency?: string) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n), currency)}`;

/** Income, spending and net flow cards, as on the web analytics page. */
export function Summary({
  summary,
  currency = "SGD",
  title,
  footer,
}: {
  summary: any;
  currency?: string;
  title?: string;
  footer?: React.ReactNode;
}) {
  const net = Number(summary?.net ?? Number(summary?.totalIn || 0) - Number(summary?.totalOut || 0));
  return (
    <View style={{ gap: 8 }}>
      {!!title && (
        <Txt muted bold size={13}>
          {title}
        </Txt>
      )}
      <StatGrid>
        <Stat label="Income" tone="green" value={money(summary?.totalIn, currency)} />
        <Stat label="Spending" tone="red" value={money(summary?.totalOut, currency)} />
        <Stat label="Net flow" tone={net >= 0 ? "green" : "red"} value={money(net, currency)} />
        {summary?.transactionCount != null && (
          <Stat label="Transactions" value={String(summary.transactionCount)} />
        )}
      </StatGrid>
      {footer}
    </View>
  );
}
/** Horizontal month chips; newest first. */
export function MonthStrip({
  months,
  value,
  onChange,
}: {
  months: string[];
  value?: string;
  onChange: (m: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 8 }}
    >
      {months.map((m) => {
        const on = m === value;
        return (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityLabel={fmtMonth(m)}
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(m);
            }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 8,
              backgroundColor: on ? colors.tint : colors.card,
              borderWidth: 1,
              borderColor: on ? colors.purple : colors.line,
              alignItems: "center",
            }}
          >
            <Txt bold size={13} style={{ color: on ? colors.purple : colors.text }}>
              {fmtMonth(m, true)}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
function ImportSummaryCard({ item, onPress }: any) {
  return (
    <Card onPress={onPress} accessibilityLabel={item.filename} style={{ gap: 8 }}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Txt bold numberOfLines={1}>
            {item.filename}
          </Txt>
          <Txt muted size={12}>
            {item.transactionCount} transactions ·{" "}
            {fmtDate(item.startDate, false)} – {fmtDate(item.endDate)}
          </Txt>
        </View>
      </View>
      <View style={[styles.row, { gap: 16 }]}>
        <Txt mono size={13} tone="green">
          +{money(item.totalIn)}
        </Txt>
        <Txt mono size={13} tone="red">
          -{money(item.totalOut)}
        </Txt>
        {item.topCategory && (
          <View style={[styles.row, { gap: 5 }]}>
            <Dot color={item.topCategory.color || BRAND} size={8} />
            <Txt muted size={12}>
              {item.topCategory.name}
            </Txt>
          </View>
        )}
      </View>
    </Card>
  );
}
export { ImportSummaryCard };
function CategorizeRow({ item, categories, onDone, navigation }: any) {
  const { call } = useApi();
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
      <TransactionRow
        item={item}
        leading={<TransactionThumb item={item} />}
        onPress={() => navigation.navigate("Transaction", { id: item.id, item })}
      />
      <Choice
        compact
        label="Set category"
        value={null}
        options={categories.map((c: any) => ({
          label: c.name,
          value: c.id,
          color: c.color,
        }))}
        onChange={(categoryId) =>
          void call("updateTransaction", item.id, { categoryId })
            .then(() => {
              toast("Category saved");
              onDone();
            })
            .catch(notice)
        }
      />
    </View>
  );
}
/** Up to `radius` items either side of `index`, shifted to stay in range. */
const around = <T,>(items: T[], index: number, radius: number) => {
  const size = Math.min(items.length, radius * 2 + 1);
  const start = Math.min(Math.max(index - radius, 0), Math.max(items.length - size, 0));
  return items.slice(start, start + size);
};

/** "↑ $12.68 (+20%)": more spending is red, less is green (`invert` for income). */
const changeText = (value: number, previous: number | null | undefined, currency: string) => {
  if (Math.abs(value) < 0.005) return "No change";
  const percent = previous ? Math.round((value / previous) * 100) : null;
  return `${value > 0 ? "↑" : "↓"} ${money(Math.abs(value), currency)}${
    percent != null && Number.isFinite(percent) ? ` (${value > 0 ? "+" : ""}${percent}%)` : ""
  }`;
};
const changeTone = (value: number, invert = false): "red" | "green" | undefined =>
  Math.abs(value) < 0.005 ? undefined : (value > 0) !== invert ? "red" : "green";

/** "‹ October 2026 ›"; tap the title to pick any month. Months newest first. */
function MonthHeader({
  months,
  value,
  onChange,
  partialMonth,
}: {
  months: string[];
  value?: string | null;
  onChange: (month: string) => void;
  /** The running month, labelled "so far". */
  partialMonth?: string | null;
}) {
  const title = (m?: string | null) => `${fmtMonth(m)}${m && m === partialMonth ? " (so far)" : ""}`;
  const { colors } = useTheme();
  const [picking, setPicking] = useState(false);
  const index = value ? months.indexOf(value) : -1;
  const older = index >= 0 ? months[index + 1] : undefined;
  const newer = index > 0 ? months[index - 1] : undefined;
  const arrow = (icon: any, target: string | undefined, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!target}
      onPress={() => {
        if (!target) return;
        tap();
        onChange(target);
      }}
      style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
        alignItems: "center",
        justifyContent: "center",
        opacity: target ? 1 : 0.35,
      }}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );
  return (
    <View style={[styles.row, { gap: 8 }]}>
      {arrow("chevron-back", older, "Previous month")}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Month: ${title(value)}`}
        onPress={() => setPicking(true)}
        style={[styles.row, { flex: 1, justifyContent: "center", gap: 6 }]}
      >
        <Txt bold size={18} numberOfLines={1} adjustsFontSizeToFit>
          {title(value)}
        </Txt>
        <Ionicons name="chevron-down" size={16} color={colors.muted} />
      </Pressable>
      {arrow("chevron-forward", newer, "Next month")}
      <Sheet visible={picking} onClose={() => setPicking(false)} title="Month">
        <Group>
          {months.map((m) => (
            <ListItem
              key={m}
              title={title(m)}
              value={m === value ? "Showing" : undefined}
              onPress={() => {
                setPicking(false);
                onChange(m);
              }}
            />
          ))}
        </Group>
      </Sheet>
    </View>
  );
}

/** The month's spending up top, with income and net underneath. */
function MonthCard({
  summary,
  currency,
  label,
  lines = [],
}: {
  summary: any;
  currency: string;
  label: string;
  lines?: Array<{ text: string; tone?: "red" | "green" }>;
}) {
  const { colors } = useTheme();
  const net = Number(summary.totalIn || 0) - Number(summary.totalOut || 0);
  const kept = summary.totalIn > 0 ? Math.round((net / summary.totalIn) * 100) : null;
  return (
    <Card style={{ gap: 6 }}>
      <Txt muted bold size={13}>
        {label}
      </Txt>
      <Txt mono size={30} tone="red" numberOfLines={1} adjustsFontSizeToFit>
        {money(summary.totalOut, currency)}
      </Txt>
      {lines.map((line) => (
        <Txt key={line.text} size={13} tone={line.tone} muted={!line.tone}>
          {line.text}
        </Txt>
      ))}
      <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 6 }} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt muted size={12}>
            Income
          </Txt>
          <Txt mono size={16} tone="green" numberOfLines={1} adjustsFontSizeToFit>
            {money(summary.totalIn, currency)}
          </Txt>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt muted size={12}>
            Net{kept != null ? ` · ${kept}% kept` : ""}
          </Txt>
          <Txt mono size={16} tone={net >= 0 ? "green" : "red"} numberOfLines={1} adjustsFontSizeToFit>
            {signed(net, currency)}
          </Txt>
        </View>
      </View>
    </Card>
  );
}

const useAccountColors = () => {
  const accounts = useResource("getAccountNumbers");
  return useMemo(
    () => Object.fromEntries((accounts.data || []).map((a: any) => [a.accountIdentifier, a.color])),
    [accounts.data],
  );
};

/** Pick how you mainly work; shown until a choice is saved. Only emphasis changes. */
function WorkflowPrompt() {
  const workflow = useWorkflow();
  if (!workflow.loaded || workflow.chosen) return null;
  return (
    <Card style={{ gap: 10 }}>
      <Txt bold size={16}>
        How do you use Fortuna?
      </Txt>
      <Txt muted size={13}>
        This sets what the dashboard and tabs show first. You can change it in Settings.
      </Txt>
      {WORKFLOW_OPTIONS.map((option) => (
        <Button
          key={option.value}
          title={option.label}
          secondary={option.value !== workflow.mode}
          compact
          onPress={() => void workflow.choose(option.value).catch(notice)}
        />
      ))}
    </Card>
  );
}

/** Today, this week, the month so far and where it is heading. */
function DailyView({ data, currency, navigation, onShowReview }: any) {
  const { colors } = useTheme();
  const m = data.monthToDate;
  const attention = data.attention;
  const previous = m.previous;
  const sameDayLabel = `vs ${fmtDate(previous.sameDay, false)}`;
  const projectionChange = m.projected != null && previous.hasData ? m.projected - previous.spentTotal : null;
  const categories = (m.categories || []) as any[];
  const unreconciled = attention.unreconciledPastMonths;
  const monthStart = `${m.month}-01`;
  const dayBefore = (() => {
    const d = new Date(`${monthStart}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const items = [
    attention.toReview > 0 && (
      <ListItem
        key="review"
        icon="checkmark-done-outline"
        tone="amber"
        title="To review"
        subtitle="Entries the assistant logged, waiting for a check"
        value={String(attention.toReview)}
        chevron
        onPress={() => navigation.navigate("Review")}
      />
    ),
    attention.autoCreatedAccounts.length > 0 && (
      <ListItem
        key="accounts"
        icon="card-outline"
        tone="amber"
        title="Accounts to confirm"
        subtitle={attention.autoCreatedAccounts.map((a: any) => a.name).join(", ")}
        value={String(attention.autoCreatedAccounts.length)}
        chevron
        onPress={() => navigation.navigate("Review")}
      />
    ),
    attention.uncategorizedCount > 0 && (
      <ListItem
        key="uncategorized"
        icon="pricetag-outline"
        tone="amber"
        title="Without a category"
        value={String(attention.uncategorizedCount)}
        chevron
        onPress={onShowReview}
      />
    ),
    unreconciled.count > 0 && (
      <ListItem
        key="unreconciled"
        icon="document-text-outline"
        tone="amber"
        title="Not matched by a statement"
        subtitle={unreconciled.months
          .slice(0, 4)
          .map((x: any) => `${fmtMonth(x.month, true)} (${x.count})`)
          .join(", ")}
        value={String(unreconciled.count)}
        chevron
        onPress={() =>
          navigation.navigate("Transactions", { filters: { reconciled: "unreconciled", dateTo: dayBefore } })
        }
      />
    ),
    attention.stagedImports > 0 && (
      <ListItem
        key="staged"
        icon="layers-outline"
        title="Imports waiting to commit"
        value={String(attention.stagedImports)}
        chevron
        onPress={() => navigation.navigate("Import")}
      />
    ),
  ].filter(Boolean);
  return (
    <>
      <StatGrid>
        <Stat label="Today" tone="red" value={money(m.todaySpent, currency)} detail={fmtDate(m.today, false)} />
        <Stat label="This week" tone="red" value={money(m.weekSpent, currency)} detail={`Since ${fmtDate(m.weekStart, false)}`} />
      </StatGrid>
      <Card style={{ gap: 6 }}>
        <Txt muted bold size={13}>
          {fmtMonth(m.month)} so far · day {m.dayOfMonth} of {m.daysInMonth}
        </Txt>
        <Txt mono size={30} tone="red" numberOfLines={1} adjustsFontSizeToFit>
          {money(m.spent, currency)}
        </Txt>
        <Txt size={13} tone={previous.hasData ? changeTone(m.change) : undefined} muted={!previous.hasData}>
          {previous.hasData
            ? `${changeText(m.change, previous.spentSameDay, currency)} ${sameDayLabel} (${money(previous.spentSameDay, currency)})`
            : "Nothing last month to compare"}
        </Txt>
        <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 6 }} />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt muted size={12}>
              Projected month-end
            </Txt>
            <Txt mono size={16} numberOfLines={1} adjustsFontSizeToFit>
              {m.projected != null ? money(m.projected, currency) : "–"}
            </Txt>
            {projectionChange != null && (
              <Txt size={12} tone={changeTone(projectionChange)}>
                {changeText(projectionChange, previous.spentTotal, currency)} vs {fmtMonth(previous.month, true)}
              </Txt>
            )}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt muted size={12}>
              Income so far
            </Txt>
            <Txt mono size={16} tone="green" numberOfLines={1} adjustsFontSizeToFit>
              {money(m.income, currency)}
            </Txt>
          </View>
        </View>
      </Card>
      {items.length > 0 && (
        <Section title="Needs attention">
          <Group>{items}</Group>
        </Section>
      )}
      {categories.length > 0 && (
        <Section
          title="Categories so far"
          hint={previous.hasData ? `Bars show this month against all of ${fmtMonth(previous.month, true).split(" ")[0]}.` : undefined}
          action="Details"
          onAction={() => navigation.navigate("Analytics")}
        >
          <Card style={{ gap: 14 }}>
            {categories.slice(0, 8).map((c) => (
              <View key={c.key} style={{ gap: 6 }}>
                <View style={styles.between}>
                  <View style={[styles.row, { gap: 8, flex: 1 }]}>
                    <Dot color={c.color} />
                    <Txt numberOfLines={1} style={{ flex: 1 }}>
                      {c.name}
                    </Txt>
                  </View>
                  <Txt mono size={14}>
                    {money(c.spent, currency)}
                    {c.previousTotal ? ` / ${money(c.previousTotal, currency)}` : ""}
                  </Txt>
                </View>
                {c.previousTotal > 0 && (
                  <Progress value={c.spent / c.previousTotal} color={c.spent > c.previousTotal ? colors.red : c.color} height={6} />
                )}
                <Txt muted size={12}>
                  {previous.hasData
                    ? c.previousSameDay
                      ? `${changeText(c.spent - c.previousSameDay, c.previousSameDay, currency)} ${sameDayLabel}`
                      : `Nothing by ${fmtDate(previous.sameDay, false)}`
                    : plural(c.transactionCount, "transaction")}
                </Txt>
              </View>
            ))}
          </Card>
        </Section>
      )}
      <Section title="Latest" action="See all" onAction={() => navigation.navigate("Transactions")}>
        <Card style={{ paddingVertical: 6, gap: 0 }}>
          {data.recent.length === 0 && <Empty title="No entries yet" />}
          {data.recent.map((item: any) => (
            <TransactionRow
              key={item.id}
              item={{
                ...item,
                amountIn: item.originalAmountIn ?? item.amountIn,
                amountOut: item.originalAmountOut ?? item.amountOut,
                accountColor: item.account?.color,
                accountLabel: item.card ? cardDisplay(item.card) : item.account?.name,
              }}
              leading={<TransactionThumb item={item} />}
              showDate
              onPress={() => navigation.navigate("Transaction", { id: item.id, item })}
            />
          ))}
        </Card>
      </Section>
    </>
  );
}

const HOME_TABS = {
  daily: ["month", "statement", "review"],
  statements: ["statement", "month", "review"],
} as const;

export function HomeScreen({ navigation }: any) {
  const workflow = useWorkflow();
  const [month, setMonth] = useState<string | undefined>();
  const [chosenTab, setTab] = useState<string | null>(null);
  // Daily trackers open on the month so far, statement uploaders on the last full month.
  const tab = chosenTab ?? HOME_TABS[workflow.mode][0];
  const [uncategorizedShown, setUncategorizedShown] = useState(8);
  const todayKey = localToday();
  const overview = useResource("getDashboardOverview", month, todayKey);
  const daily = useResource("getDailyOverview", todayKey);
  const review = useResource("getDashboardReview");
  const user = useResource("getCurrentUser");
  const categories = useResource("getCategories", { scope: "main" });
  const accountColors = useAccountColors();
  const resource = tab === "statement" ? overview : tab === "month" ? daily : review;
  const o = overview.data;
  const d = daily.data;
  const uploadMonth = o?.latestStatementMonth ? nextMonth(o.latestStatementMonth) : null;
  const showUpload = !!uploadMonth && uploadMonth < todayKey.slice(0, 7);
  const r = review.data;
  const currency = user.data?.baseCurrency || "SGD";
  const { colors } = useTheme();
  const reviewCount =
    (r?.dataHealth?.uncategorizedCount || 0) + (r?.stagedImports?.length || 0);
  const openTransaction = (item: any) => navigation.navigate("Transaction", { id: item.id, item });

  const months: string[] = (o?.importedMonths || []).map((m: any) => m.month);
  const selected: string | undefined = o?.selectedMonth || undefined;
  const previous = o?.summary?.previousMonth;
  const trendIndex = (o?.trend || []).findIndex((t: any) => t.month === selected);
  const trend = around(o?.trend || [], trendIndex >= 0 ? trendIndex : (o?.trend?.length || 1) - 1, 3);
  const categoriesSpent = (o?.spendingByCategory || []) as any[];
  const missing = ((r?.coverage?.accounts || []) as any[]).filter((a) => a.missingMonths?.length);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={resource.loading && !!resource.data}
          onRefresh={() => {
            void resource.reload();
            void user.reload();
            void workflow.reload();
          }}
        />
      }
    >
      <Tabs
        values={[...HOME_TABS[workflow.mode]]}
        labels={{
          month: "This month",
          statement: workflow.mode === "daily" ? "Statements" : "Overview",
          review: reviewCount ? `Review (${reviewCount})` : "Review",
        }}
        value={tab}
        onChange={setTab}
      />
      <WorkflowPrompt />
      <State {...resource} />
      {tab === "month" && d && !d.hasTransactions && (
        <Card>
          {workflow.mode === "daily" ? (
            <Empty
              title="No entries yet"
              message="What the assistant logs shows up here as it happens. You can also import a statement."
            />
          ) : (
            <Empty title="No transactions yet" message="Import a statement, or let the assistant log spending as it happens." />
          )}
          <Button title="Import Statement" icon="cloud-upload-outline" secondary onPress={() => navigation.navigate("Import")} />
        </Card>
      )}
      {tab === "month" && d?.hasTransactions && (
        <DailyView data={d} currency={d.monthToDate.currency || currency} navigation={navigation} onShowReview={() => setTab("review")} />
      )}
      {tab === "statement" && o && !o.hasTransactions && (
        <Card>
          <Empty title="No transactions yet" message="Import a statement to see your month." />
          <Button title="Import Statement" icon="cloud-upload-outline" onPress={() => navigation.navigate("Import")} />
        </Card>
      )}
      {tab === "statement" && o?.hasTransactions && showUpload && (
        <Card style={{ gap: 8 }}>
          <Txt bold size={16}>
            Upload your {fmtMonth(uploadMonth)} statement
          </Txt>
          <Txt muted size={13}>
            The latest statement covers {fmtMonth(o.latestStatementMonth)}.
          </Txt>
          <Button title="Upload statement" icon="cloud-upload-outline" compact onPress={() => navigation.navigate("Import")} />
        </Card>
      )}
      {tab === "statement" && o?.hasTransactions && selected && (
        <>
          <MonthHeader months={months} value={selected} onChange={setMonth} />
          <MonthCard
            summary={o.summary}
            currency={currency}
            label={`Spent in ${fmtMonth(selected)}`}
            lines={
              previous
                ? [
                    {
                      text: `${changeText(previous.spendingDelta, previous.totalOut, currency)} vs ${fmtMonth(previous.month, true)}`,
                      tone: changeTone(previous.spendingDelta),
                    },
                  ]
                : []
            }
          />
          {trend.length > 1 && (
            <Card>
              <Txt bold size={16}>
                Income and spending
              </Txt>
              <ColumnChart
                currency={currency}
                primaryLabel="Spending"
                secondaryLabel="Income"
                color={colors.red}
                secondaryColor={colors.green}
                selectedKey={selected}
                data={trend.map((t: any) => ({
                  key: t.month,
                  label: fmtMonth(t.month, true),
                  value: t.totalOut,
                  secondary: t.totalIn,
                }))}
                onSelect={(d) => d.key && d.key !== selected && setMonth(d.key)}
              />
            </Card>
          )}
          {categoriesSpent.length > 0 && (
            <Section title="Where it went" action="Details" onAction={() => navigation.navigate("Analytics")}>
              <Card>
                <Donut
                  currency={currency}
                  centerLabel="Spent"
                  limit={5}
                  data={categoriesSpent.map((c) => {
                    const change = c.totalOut - (c.previousTotalOut || 0);
                    return {
                      key: c.key,
                      label: c.name,
                      value: c.totalOut,
                      color: c.color,
                      note: previous
                        ? c.previousTotalOut
                          ? changeText(change, c.previousTotalOut, currency)
                          : "New this month"
                        : undefined,
                      noteTone: previous && c.previousTotalOut ? changeTone(change) : undefined,
                    };
                  })}
                />
              </Card>
            </Section>
          )}
          {(o.largestExpenses || []).length > 0 && (
            <Section title="Largest expenses" action="See all" onAction={() => navigation.navigate("Transactions")}>
              <Card style={{ paddingVertical: 6, gap: 0 }}>
                {o.largestExpenses.slice(0, 3).map((item: any) => (
                  <TransactionRow
                    key={item.id}
                    item={{ ...item, accountColor: item.account?.color || accountColors[item.accountIdentifier] }}
                    leading={<TransactionThumb item={item} />}
                    showDate
                    onPress={() => openTransaction(item)}
                  />
                ))}
              </Card>
            </Section>
          )}
        </>
      )}
      {tab === "review" && r && (
        <>
          <Card style={{ gap: 8 }}>
            <View style={styles.between}>
              <Txt bold size={16}>
                Categorised
              </Txt>
              <Txt mono size={22} tone={r.dataHealth.categorizedPercent >= 90 ? "green" : "amber"}>
                {r.dataHealth.categorizedPercent}%
              </Txt>
            </View>
            <Progress
              value={r.dataHealth.categorizedPercent / 100}
              color={r.dataHealth.categorizedPercent >= 90 ? undefined : "#F59E0B"}
            />
            <Txt muted size={13}>
              {r.dataHealth.uncategorizedCount} of {r.dataHealth.transactionCount} without a category ·{" "}
              {r.dataHealth.ruleCount} import rules
            </Txt>
          </Card>

          {(r.stagedImports || []).length > 0 && (
            <Section title="Waiting to commit">
              <Group>
                {r.stagedImports.map((draft: any) => (
                  <ListItem
                    key={draft.id}
                    icon="layers-outline"
                    title={draft.filename}
                    subtitle={`${draft.rowCount} rows · staged ${fmtDate(draft.updatedAt, false)}`}
                    chevron
                    onPress={() => navigation.navigate("Draft", { ids: [draft.id] })}
                  />
                ))}
              </Group>
            </Section>
          )}

          <Section title={`Without a category${r.dataHealth.uncategorizedCount ? ` (${r.dataHealth.uncategorizedCount})` : ""}`}>
            <Card style={{ padding: 0, gap: 0, paddingTop: 6 }}>
              {r.reviewQueue.uncategorized.length === 0 && (
                <Empty icon="checkmark-done-outline" title="Everything has a category" />
              )}
              {r.reviewQueue.uncategorized.slice(0, uncategorizedShown).map((item: any) => (
                <CategorizeRow
                  key={item.id}
                  item={item}
                  categories={categories.data || []}
                  navigation={navigation}
                  onDone={review.reload}
                />
              ))}
              {r.reviewQueue.uncategorized.length > uncategorizedShown && (
                <View style={{ padding: 12, paddingTop: 0 }}>
                  <Button
                    title={`Show more (${r.reviewQueue.uncategorized.length - uncategorizedShown})`}
                    secondary
                    compact
                    onPress={() => setUncategorizedShown((n) => n + 10)}
                  />
                </View>
              )}
            </Card>
          </Section>

          {missing.length > 0 && (
            <Section title="Possibly missing statements" hint="Months with no transactions after an account's first statement.">
              <Group>
                {missing.map((account: any) => (
                  <ListItem
                    key={account.label}
                    color={account.color}
                    title={account.label}
                    subtitle={account.missingMonths.map((m: string) => fmtMonth(m, true)).join(", ")}
                    onPress={() => navigation.navigate("Import")}
                  />
                ))}
              </Group>
            </Section>
          )}

          {r.reviewQueue.newMerchants.length > 0 && (
            <Section title={`New in ${fmtMonth(r.reviewQueue.newMerchantsMonth || selected, true)}`}>
              <Group>
                {r.reviewQueue.newMerchants.slice(0, 5).map((m: any) => (
                  <ListItem
                    key={m.key}
                    icon="storefront-outline"
                    title={m.name}
                    subtitle={m.transactionCount ? `${m.transactionCount} transaction${m.transactionCount === 1 ? "" : "s"}` : undefined}
                    value={m.totalOut ? `-${money(m.totalOut, currency)}` : undefined}
                    valueTone="red"
                    onPress={() => navigation.navigate("Transactions", { search: m.name })}
                  />
                ))}
              </Group>
            </Section>
          )}

          <Button
            title="Import history"
            icon="time-outline"
            secondary
            onPress={() => navigation.navigate("Import", { openTab: "History", refreshKey: Date.now() })}
          />
        </>
      )}
    </Screen>
  );
}

type Period = "month" | "last3" | "last12" | "ytd" | "custom";
const PERIODS: Record<Period, string> = {
  month: "Month",
  last3: "3 months",
  last12: "12 months",
  ytd: "Year to date",
  custom: "Custom",
};
const METRICS: Record<string, string> = {
  spending: "Spending",
  income: "Income",
  inOut: "Both",
  net: "Net",
};
const ORDERINGS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "largest", label: "Largest amount" },
  { value: "smallest", label: "Smallest amount" },
];
const csvCell = (v: any) => JSON.stringify(String(v ?? ""));
const daysBetween = (from?: string, to?: string) =>
  from && to ? (Date.parse(to) - Date.parse(from)) / 86400000 : Infinity;

function ReportTab({ navigation, currency }: any) {
  const { colors } = useTheme();
  const accountColors = useAccountColors();
  const [period, setPeriod] = useState<Period>("month");
  const [month, setMonth] = useState<string | undefined>();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [metric, setMetric] = useState("spending");
  const [categoryId, setCategoryId] = useState("");
  const [merchantKey, setMerchantKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cardId, setCardId] = useState("");
  const [breakdown, setBreakdown] = useState("Category");
  const [ordering, setOrdering] = useState("newest");
  const [shown, setShown] = useState(20);
  const [lastTap, setLastTap] = useState<string | null>(null);

  const custom = period === "custom";
  const interval = period === "month" || (custom && daysBetween(dateFrom, dateTo) <= 62) ? "day" : "month";
  const params = useMemo(
    () => ({
      month,
      range: custom ? "month" : period,
      ...(custom && dateFrom ? { dateFrom } : {}),
      ...(custom && dateTo ? { dateTo } : {}),
      metric,
      groupBy: interval,
      interval,
      ...(categoryId ? { categoryId } : {}),
      ...(merchantKey ? { merchantKey } : {}),
      ...(accountId ? { accountId } : {}),
      ...(cardId ? { cardId } : {}),
      today: localToday(),
    }),
    [month, period, custom, dateFrom, dateTo, metric, interval, categoryId, merchantKey, accountId, cardId],
  );
  const report = useResource("getAnalyticsReport", params);
  const r = report.data;

  const value = (t: any) =>
    metric === "income" ? t.totalIn : metric === "net" ? t.totalIn - t.totalOut : t.totalOut;
  const series = ((r?.timeSeries || r?.chartSeries || []) as any[]).map((t) => ({
    key: t.key,
    label: interval === "day" ? fmtDate(t.key, false) : fmtMonth(t.key, true),
    value: metric === "inOut" ? t.totalOut : value(t),
    secondary: metric === "inOut" ? t.totalIn : undefined,
  }));
  const metricColor = metric === "income" ? colors.green : metric === "net" ? colors.purple : colors.red;

  /** First tap reads a bar; tapping it again zooms in (month → days, day → that day). */
  const onBar = (d: any) => {
    if (lastTap !== d.key) {
      setLastTap(d.key);
      return;
    }
    setLastTap(null);
    setShown(20);
    if (interval === "month") {
      setPeriod("month");
      setMonth(d.key);
    } else {
      setPeriod("custom");
      setDateFrom(d.key);
      setDateTo(d.key);
    }
  };

  const total = r ? value(r.summary) : 0;
  const prev = r?.previousPeriod?.summary;
  const prevTotal = prev ? value(prev) : null;
  const hasPrev = !!prev && prev.transactionCount > 0;
  const invert = metric === "income" || metric === "net";
  const breakdownRows: Record<string, any[] | undefined> = {
    Category: r?.categoryBreakdown || r?.breakdown,
    Merchant: r?.merchantBreakdown,
    Account: r?.accountBreakdown,
    Card: r?.cardBreakdown,
  };
  const rows = (breakdownRows[breakdown] || []).filter((b: any) => Math.abs(Number(b.metricValue)) > 0.004);
  const partial = r?.partial;
  const projected = partial
    ? metric === "income"
      ? partial.projected.totalIn
      : metric === "spending" || metric === "inOut"
        ? partial.projected.totalOut
        : null
    : null;
  const comparedWith = r?.previousPeriod?.sameDays
    ? period === "month"
      ? "vs the same days last month"
      : "vs the same days of the previous period"
    : "vs previous period";
  const merchantName = r?.merchants?.find((m: any) => m.key === merchantKey)?.name;
  const amount = (t: any) => Math.max(Number(t.originalAmountIn ?? t.amountIn) || 0, Number(t.originalAmountOut ?? t.amountOut) || 0);
  const transactions = [...(r?.transactions || [])].sort((a: any, b: any) => {
    if (ordering === "largest") return amount(b) - amount(a);
    if (ordering === "smallest") return amount(a) - amount(b);
    const byDate = String(a.date).localeCompare(String(b.date));
    return ordering === "oldest" ? byDate : -byDate;
  });

  return (
    <>
      <Chips
        values={Object.keys(PERIODS)}
        labels={PERIODS}
        value={period}
        onChange={(next) => {
          setLastTap(null);
          if (next === "custom" && r) {
            setDateFrom(String(r.period.start).slice(0, 10));
            setDateTo(String(r.period.end).slice(0, 10));
          }
          setPeriod(next as Period);
        }}
      />
      {period === "month" && r?.importedMonths?.length > 0 && (
        <MonthHeader months={r.importedMonths} value={r.selectedMonth} onChange={setMonth} partialMonth={r.currentMonth} />
      )}
      {custom && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <DateField label="From" value={dateFrom} onChange={setDateFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To" value={dateTo} onChange={setDateTo} />
          </View>
        </View>
      )}
      <Segmented values={Object.keys(METRICS)} labels={METRICS} value={metric} onChange={setMetric} />
      <Choice
        compact
        label="Category"
        value={categoryId}
        options={[
          { label: "All categories", value: "" },
          ...(r?.categories || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color || "#9ca3af" })),
        ]}
        onChange={(id) => setCategoryId(id || "")}
      />
      {(r?.accounts || []).length > 0 && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Choice
              compact
              label="Account"
              value={accountId}
              options={[
                { label: "All accounts", value: "" },
                ...(r?.accounts || []).map((a: any) => ({ label: a.name, value: a.id, color: a.color })),
              ]}
              onChange={(id) => {
                setAccountId(id || "");
                setCardId("");
              }}
            />
          </View>
          {(r?.cards || []).length > 0 && (
            <View style={{ flex: 1 }}>
              <Choice
                compact
                label="Card"
                value={cardId}
                options={[
                  { label: "All cards", value: "" },
                  ...(r?.cards || []).map((c: any) => ({ label: c.name, value: c.id, color: c.color })),
                  { label: "No card", value: "none" },
                ]}
                onChange={(id) => setCardId(id || "")}
              />
            </View>
          )}
        </View>
      )}
      {!!merchantKey && (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove merchant filter" onPress={() => setMerchantKey("")} style={{ alignSelf: "flex-start" }}>
          <Pill label={merchantName || "Merchant"} tone="purple" icon="close" />
        </Pressable>
      )}
      <State {...report} />
      {r && (
        <>
          <Card style={{ gap: 4 }}>
            <Txt muted bold size={13}>
              {METRICS[metric] === "Both" ? "Spending" : METRICS[metric]} · {fmtDate(r.period.start, false)} – {fmtDate(r.period.end)}
            </Txt>
            <Txt mono size={28} tone={metric === "income" ? "green" : metric === "net" ? (total >= 0 ? "green" : "red") : "red"}>
              {metric === "net" ? signed(total, currency) : money(total, currency)}
            </Txt>
            <Txt size={13} tone={hasPrev ? changeTone(total - (prevTotal || 0), invert) : undefined} muted={!hasPrev}>
              {hasPrev ? `${changeText(total - (prevTotal || 0), prevTotal, currency)} ${comparedWith}` : "No previous period to compare"}
            </Txt>
            {partial && (
              <Txt muted size={12}>
                Day {partial.elapsedDays} of {partial.totalDays}
                {projected != null ? ` · ${money(projected, currency)} at this pace` : ""}
              </Txt>
            )}
            <Txt muted size={12}>
              {r.summary.transactionCount} transactions · in {money(r.summary.totalIn, currency)} · out {money(r.summary.totalOut, currency)}
            </Txt>
          </Card>
          <Card>
            <View style={styles.between}>
              <Txt bold size={16}>
                By {interval}
              </Txt>
              <Txt muted size={12}>
                {interval === "month" ? "Tap twice to open a month" : series.length > 1 ? "Tap twice to open a day" : ""}
              </Txt>
            </View>
            {series.every((d) => !d.value && !d.secondary) ? (
              <Empty title="No transactions in this period" />
            ) : (
              <ColumnChart
                data={series}
                currency={currency}
                color={metric === "inOut" ? colors.red : metricColor}
                secondaryColor={colors.green}
                primaryLabel={metric === "inOut" ? "Spending" : undefined}
                secondaryLabel={metric === "inOut" ? "Income" : undefined}
                onSelect={onBar}
                showLatest={false}
              />
            )}
          </Card>
          <Section title="Breakdown">
            <Card>
              <Segmented values={["Category", "Merchant", "Account", "Card"]} value={breakdown} onChange={setBreakdown} />
              {rows.length === 0 ? (
                <Empty title="Nothing to break down" />
              ) : (
                <RankBars
                  currency={currency}
                  limit={8}
                  data={rows.map((b: any) => ({
                    key: b.key,
                    label: `${b.name} · ${b.percentOfTotal}%`,
                    value: Math.abs(Number(b.metricValue)),
                    color: b.color,
                  }))}
                  onSelect={(d) => {
                    setShown(20);
                    if (breakdown === "Category") setCategoryId(d.key === categoryId ? "" : d.key || "");
                    else if (breakdown === "Account") {
                      setAccountId(d.key === accountId ? "" : d.key || "");
                      setCardId("");
                    } else if (breakdown === "Card") setCardId(d.key === cardId ? "" : d.key || "");
                    else setMerchantKey(d.key === merchantKey ? "" : d.key || "");
                  }}
                />
              )}
            </Card>
          </Section>
          <Section
            title={`Transactions (${transactions.length})`}
            action="Share CSV"
            onAction={() =>
              void shareCsv(
                "fortuna-report.csv",
                [
                  "Date,Label,Description,Category,Merchant,In,Out",
                  ...transactions.map((t: any) =>
                    [String(t.date).slice(0, 10), t.label, t.description, t.category?.name, t.merchant, t.amountIn || 0, t.amountOut || 0]
                      .map(csvCell)
                      .join(","),
                  ),
                ].join("\n"),
              )
            }
          >
            <Choice compact label="Order" value={ordering} options={ORDERINGS} onChange={setOrdering} />
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {transactions.length === 0 && <Empty title="No transactions" />}
              {transactions.slice(0, shown).map((item: any) => (
                <TransactionRow
                  key={item.id}
                  item={{
                    ...item,
                    amountIn: item.originalAmountIn ?? item.amountIn,
                    amountOut: item.originalAmountOut ?? item.amountOut,
                    accountColor: item.account?.color || accountColors[item.accountIdentifier],
                  }}
                  leading={<TransactionThumb item={item} />}
                  showDate={ordering === "largest" || ordering === "smallest" || interval === "month"}
                  onPress={() => navigation.navigate("Transaction", { id: item.id, item })}
                />
              ))}
              {transactions.length > shown && (
                <View style={{ padding: 10 }}>
                  <Button title={`Show more (${transactions.length - shown})`} secondary compact onPress={() => setShown((n) => n + 30)} />
                </View>
              )}
            </Card>
          </Section>
        </>
      )}
    </>
  );
}

function ChangeList({ rows, currency }: any) {
  if (!rows?.length) return <Empty title="No changes" />;
  return (
    <Group>
      {rows.map((row: any) => (
        <ListItem
          key={row.key}
          color={row.color || "#9ca3af"}
          title={row.name}
          subtitle={`${money(row.previousTotalOut, currency)} → ${money(row.totalOut, currency)}`}
          value={row.previousTotalOut ? changeText(row.delta, row.previousTotalOut, currency) : "New"}
          valueTone={row.delta > 0 ? "red" : "green"}
        />
      ))}
    </Group>
  );
}

function InsightsTab({ navigation, currency }: any) {
  const [month, setMonth] = useState<string | undefined>();
  const insights = useResource("getAnalyticsInsights", month, localToday());
  const i = insights.data;
  const s = i?.monthlySummary;
  const changes = (i?.categoryChanges || []).filter((c: any) => Math.abs(c.delta) > 0.004).slice(0, 5);
  return (
    <>
      <State {...insights} />
      {i && !i.hasTransactions && (
        <Card>
          <Empty title="No insights yet" message="Import a few months of statements to compare." />
        </Card>
      )}
      {i?.hasTransactions && s && (
        <>
          <MonthHeader months={i.importedMonths} value={i.selectedMonth} onChange={setMonth} partialMonth={i.currentMonth} />
          <MonthCard
            summary={s}
            currency={currency}
            label={i.partial ? `Spent so far in ${fmtMonth(i.selectedMonth)}` : `Spent in ${fmtMonth(i.selectedMonth)}`}
            lines={[
              ...(i.partial
                ? [
                    {
                      text: `Day ${i.partial.elapsedDays} of ${i.partial.totalDays}${
                        i.partial.projected.totalOut != null ? ` · ${money(i.partial.projected.totalOut, currency)} at this pace` : ""
                      }`,
                    },
                  ]
                : []),
              ...(s.spendingDelta != null && s.previousMonth
                ? [
                    {
                      text: `${changeText(s.spendingDelta, s.previousTotalOut, currency)} vs ${fmtMonth(s.previousMonth, true)}${i.partial ? " to the same day" : ""}`,
                      tone: changeTone(s.spendingDelta),
                    },
                  ]
                : []),
              ...(s.threeMonthDelta != null
                ? [
                    {
                      text: `${changeText(s.threeMonthDelta, s.threeMonthAverage, currency)} vs 3-month average${i.partial ? " to the same day" : ""}`,
                      tone: changeTone(s.threeMonthDelta),
                    },
                  ]
                : []),
            ]}
          />
          {changes.length > 0 && (
            <Section title={s.previousMonth ? `What changed since ${fmtMonth(s.previousMonth, true).split(" ")[0]}` : "What changed"}>
              <ChangeList rows={changes} currency={currency} />
            </Section>
          )}
          {(i.merchantInsights?.topMerchants || []).length > 0 && (
            <Section title="Top merchants">
              <Card>
                <RankBars
                  currency={currency}
                  limit={5}
                  data={i.merchantInsights.topMerchants
                    .filter((m: any) => m.totalOut > 0)
                    .map((m: any) => ({ key: m.key, label: m.name, value: m.totalOut }))}
                  onSelect={(d) => navigation.navigate("Transactions", { search: d.label })}
                />
              </Card>
            </Section>
          )}
          {(i.merchantInsights?.newMerchants || []).length > 0 && (
            <Section title="First time this month">
              <Group>
                {i.merchantInsights.newMerchants.slice(0, 5).map((m: any) => (
                  <ListItem
                    key={m.key}
                    icon="sparkles-outline"
                    title={m.name}
                    value={m.totalOut ? `-${money(m.totalOut, currency)}` : undefined}
                    valueTone="red"
                    onPress={() => navigation.navigate("Transactions", { search: m.name })}
                  />
                ))}
              </Group>
            </Section>
          )}
          {(i.anomalies || []).length > 0 && (
            <Section title="Unusually large">
              <Card style={{ paddingVertical: 6, gap: 0 }}>
                {i.anomalies.slice(0, 3).map((item: any) => (
                  <TransactionRow
                    key={item.id}
                    item={item}
                    leading={<TransactionThumb item={item} />}
                    showDate
                    onPress={() => navigation.navigate("Transaction", { id: item.id, item })}
                  />
                ))}
              </Card>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function OverallTab({ navigation, currency }: any) {
  const { colors } = useTheme();
  const overview = useResource("getAnalyticsOverview", localToday());
  const o = overview.data;
  const months = o?.importedMonths?.length || 0;
  const net = Number(o?.summary?.net || 0);
  return (
    <>
      <State {...overview} />
      {o && (
        <>
          <StatGrid>
            <Stat label="Spent a month" tone="red" value={money(months ? o.summary.totalOut / months : 0, currency)} detail="on average" />
            <Stat label="Earned a month" tone="green" value={money(months ? o.summary.totalIn / months : 0, currency)} detail="on average" />
          </StatGrid>
          <Txt muted size={13}>
            {months} months of statements · net {signed(net, currency)}
            {o.summary.totalIn > 0 ? ` · ${Math.round((net / o.summary.totalIn) * 100)}% of income kept` : ""}
          </Txt>
          <Card>
            <Txt bold size={16}>
              Last 12 months
            </Txt>
            <ColumnChart
              currency={currency}
              primaryLabel="Spending"
              secondaryLabel="Income"
              color={colors.red}
              secondaryColor={colors.green}
              data={(o.monthlyTrend || []).map((t: any) => ({
                key: t.month,
                label: `${fmtMonth(t.month, true)}${t.partial ? " so far" : ""}`,
                value: t.totalOut,
                secondary: t.totalIn,
                partial: t.partial,
                projected: t.projectedOut,
              }))}
            />
            {(o.monthlyTrend || []).some((t: any) => t.partial) && (
              <Txt muted size={12}>
                The latest month is still running; its dashed outline is where it is heading at this pace.
              </Txt>
            )}
          </Card>
          <Section title="Top categories">
            <Card>
              <Donut
                currency={currency}
                centerLabel="Spent"
                limit={6}
                data={(o.topCategories || [])
                  .filter((c: any) => c.totalOut > 0)
                  .map((c: any) => ({ key: c.key, label: c.name, value: c.totalOut, color: c.color }))}
              />
            </Card>
          </Section>
          {(o.recurringMerchants || []).length > 0 && (
            <Section title="Recurring payments" hint="Merchants charged in two or more months.">
              <Group>
                {o.recurringMerchants.slice(0, 6).map((m: any) => (
                  <ListItem
                    key={m.key}
                    icon="repeat-outline"
                    title={m.name}
                    subtitle={`${m.monthsSeen} months · ${m.stability === "fixed" ? "fixed amount" : "varies"}${m.lastDate ? ` · last ${fmtDate(m.lastDate, false)}` : ""}`}
                    value={money(m.averageAmount, currency)}
                    detail="typical"
                    onPress={() => navigation.navigate("Transactions", { search: m.name })}
                  />
                ))}
              </Group>
            </Section>
          )}
        </>
      )}
    </>
  );
}

export function AnalyticsScreen({ navigation }: any) {
  const [tab, setTab] = useState("Reports");
  const user = useResource("getCurrentUser");
  const currency = user.data?.baseCurrency || "SGD";
  return (
    <Screen>
      <Tabs values={["Reports", "Month", "All time"]} value={tab} onChange={setTab} />
      {tab === "Reports" && <ReportTab navigation={navigation} currency={currency} />}
      {tab === "Month" && <InsightsTab navigation={navigation} currency={currency} />}
      {tab === "All time" && <OverallTab navigation={navigation} currency={currency} />}
    </Screen>
  );
}
