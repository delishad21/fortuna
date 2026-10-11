import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useApi, useResource } from "./api";
import {
  Banner,
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
  Heading,
  IconBubble,
  ListItem,
  money,
  notice,
  Pill,
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
import { AreaChart, ColumnChart, Donut, RankBars } from "./charts";
import { shareCsv } from "./sharing";

const signed = (n: number, currency?: string) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n), currency)}`;

/** Gradient hero showing net cash flow with money in and out. */
export function Summary({
  summary,
  currency = "SGD",
  title = "Net cash flow",
  footer,
}: {
  summary: any;
  currency?: string;
  title?: string;
  footer?: React.ReactNode;
}) {
  return (
    <LinearGradient
      colors={[BRAND, "#8136DA"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 26, padding: 22, gap: 18 }}
    >
      <View style={{ gap: 6 }}>
        <Txt size={13} style={{ color: "#E6E2FF" }}>
          {title}
        </Txt>
        <Txt
          mono
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontSize: 34, lineHeight: 44, color: "#FFFFFF", letterSpacing: -1 }}
        >
          {money(summary?.net, currency)}
        </Txt>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {[
          ["arrow-down", "Money in", summary?.totalIn],
          ["arrow-up", "Money out", summary?.totalOut],
        ].map(([icon, label, value]) => (
          <View
            key={label}
            style={{
              flex: 1,
              borderRadius: 16,
              padding: 12,
              gap: 4,
              backgroundColor: "rgba(255,255,255,0.14)",
            }}
          >
            <View style={[styles.row, { gap: 6 }]}>
              <Ionicons name={icon as any} size={14} color="#E6E2FF" />
              <Txt size={12} style={{ color: "#E6E2FF" }}>
                {label}
              </Txt>
            </View>
            <Txt mono numberOfLines={1} adjustsFontSizeToFit style={{ color: "#FFFFFF" }}>
              {money(value, currency)}
            </Txt>
          </View>
        ))}
      </View>
      {footer}
    </LinearGradient>
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
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: on ? BRAND : colors.card,
              borderWidth: 1,
              borderColor: on ? BRAND : colors.line,
              alignItems: "center",
            }}
          >
            <Txt bold size={13} style={{ color: on ? "#FFFFFF" : colors.text }}>
              {fmtMonth(m, true).split(" ")[0]}
            </Txt>
            <Txt size={11} style={{ color: on ? "#E6E2FF" : colors.muted }}>
              {m.slice(0, 4)}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
function QuickAction({ icon, label, onPress }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <IconBubble icon={icon} size={48} />
      <Txt size={12} bold numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}
function ImportSummaryCard({ item, onPress }: any) {
  return (
    <Card onPress={onPress} accessibilityLabel={item.filename} style={{ gap: 10 }}>
      <View style={styles.row}>
        <IconBubble icon="document-text-outline" size={40} />
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
        <Txt mono size={13}>
          −{money(item.totalOut)}
        </Txt>
        {item.topCategory && (
          <Pill label={item.topCategory.name} tone="purple" />
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
export function HomeScreen({ navigation }: any) {
  const [month, setMonth] = useState<string | undefined>();
  const [tab, setTab] = useState("Overview");
  const overview = useResource("getDashboardOverview", month);
  const review = useResource("getDashboardReview");
  const user = useResource("getCurrentUser");
  const categories = useResource("getCategories", { scope: "main" });
  const resource = tab === "Overview" ? overview : review;
  const o = overview.data;
  const r = review.data;
  const currency = user.data?.baseCurrency || "SGD";
  const delta = Number(o?.summary?.previousMonth?.spendingDelta || 0);
  const now = new Date();
  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={resource.loading && !!resource.data}
          onRefresh={() => {
            void resource.reload();
            void user.reload();
          }}
        />
      }
    >
      <Heading
        eyebrow={now.toLocaleDateString("en-SG", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        title={`Hello, ${user.data?.name?.split(" ")[0] || "you"}.`}
        subtitle="A little clarity for your money."
      />
      <Segmented values={["Overview", "Review"]} value={tab} onChange={setTab} />
      <State {...resource} />
      {tab === "Overview" && o && (
        <>
          {o.importedMonths.length > 0 && (
            <MonthStrip
              months={o.importedMonths.map((m: any) => m.month)}
              value={month || o.selectedMonth}
              onChange={setMonth}
            />
          )}
          <Summary
            summary={o.summary}
            currency={currency}
            title={`Net cash flow · ${fmtMonth(o.selectedMonth)}`}
            footer={
              o.summary.previousMonth ? (
                <View style={[styles.row, { gap: 6 }]}>
                  <Ionicons
                    name={delta > 0 ? "trending-up" : "trending-down"}
                    size={16}
                    color="#FFFFFF"
                  />
                  <Txt size={13} style={{ color: "#FFFFFF" }}>
                    {money(Math.abs(delta), currency)} {delta > 0 ? "more" : "less"}{" "}
                    spending than {fmtMonth(o.summary.previousMonth.month, true)}
                  </Txt>
                </View>
              ) : null
            }
          />
          <Card style={{ flexDirection: "row", paddingVertical: 16 }}>
            <QuickAction
              icon="cloud-upload-outline"
              label="Import"
              onPress={() => navigation.navigate("Import")}
            />
            <QuickAction
              icon="receipt-outline"
              label="Activity"
              onPress={() => navigation.navigate("Transactions")}
            />
            <QuickAction
              icon="stats-chart-outline"
              label="Analytics"
              onPress={() => navigation.navigate("Analytics")}
            />
            <QuickAction
              icon="pricetags-outline"
              label="Categories"
              onPress={() => navigation.navigate("Manage", { kind: "categories" })}
            />
          </Card>
          {!o.hasTransactions && o.recentTransactions?.length === 0 && (
            <Card>
              <Empty
                icon="cloud-upload-outline"
                title="Bring in your first statement"
                message="Import a statement to see your money in one place."
                action="Import a statement"
                onAction={() => navigation.navigate("Import")}
              />
            </Card>
          )}
          {o.trend?.length > 0 && (
            <Section title="Cash flow">
              <Card>
                <ColumnChart
                  currency={currency}
                  primaryLabel="Out"
                  secondaryLabel="In"
                  data={o.trend.map((t: any) => ({
                    key: t.month,
                    label: fmtMonth(t.month, true),
                    value: t.totalOut,
                    secondary: t.totalIn,
                  }))}
                  onSelect={(d) => setMonth(d.key)}
                />
                <View style={[styles.row, { gap: 16 }]}>
                  <Legend color={BRAND} label="Spending" />
                  <Legend color="#1A8245" label="Income" />
                </View>
              </Card>
            </Section>
          )}
          <StatGrid>
            {o.summary.topCategory && (
              <Stat
                icon="pie-chart-outline"
                label="Top category"
                value={money(o.summary.topCategory.totalOut, currency)}
                detail={o.summary.topCategory.name}
              />
            )}
            {o.summary.largestTransaction && (
              <Stat
                icon="flash-outline"
                tone="amber"
                label="Largest spend"
                value={money(
                  o.summary.largestTransaction.amountOut ||
                    o.summary.largestTransaction.amountIn,
                  currency,
                )}
                detail={
                  o.summary.largestTransaction.label ||
                  o.summary.largestTransaction.description
                }
                onPress={() =>
                  navigation.navigate("Transaction", {
                    id: o.summary.largestTransaction.id,
                  })
                }
              />
            )}
          </StatGrid>
          <Section
            title="Recent activity"
            action="See all"
            onAction={() => navigation.navigate("Transactions")}
          >
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {o.recentTransactions.length === 0 && (
                <Empty title="No activity this month" />
              )}
              {o.recentTransactions.map((item: any) => (
                <TransactionRow
                  key={item.id}
                  item={item}
                  onPress={() =>
                    navigation.navigate("Transaction", { id: item.id, item })
                  }
                />
              ))}
            </Card>
          </Section>
        </>
      )}
      {tab === "Review" && r && (
        <>
          <Card>
            <View style={styles.between}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt bold size={17}>
                  Data health
                </Txt>
                <Txt muted size={13}>
                  {r.dataHealth.categorizedCount} of {r.dataHealth.transactionCount}{" "}
                  transactions categorized
                </Txt>
              </View>
              <Txt mono size={26} tone={r.dataHealth.categorizedPercent >= 90 ? "green" : "amber"}>
                {r.dataHealth.categorizedPercent}%
              </Txt>
            </View>
            <Progress
              value={r.dataHealth.categorizedPercent / 100}
              color={r.dataHealth.categorizedPercent >= 90 ? undefined : "#F59E0B"}
            />
            <View style={{ flexDirection: "row" }}>
              {[
                ["Transactions", r.dataHealth.transactionCount],
                ["To review", r.dataHealth.uncategorizedCount],
                ["Rules", r.dataHealth.ruleCount],
                ["Merchants", r.dataHealth.merchantCount],
              ].map(([label, value]) => (
                <View key={label} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                  <Txt mono size={17}>
                    {value}
                  </Txt>
                  <Txt muted size={11}>
                    {label}
                  </Txt>
                </View>
              ))}
            </View>
          </Card>
          {r.dataHealth.uncategorizedCount > 0 && (
            <Banner
              tone="amber"
              icon="alert-circle-outline"
              title={`${r.dataHealth.uncategorizedCount} transactions need a category`}
              message="Categorize them below so your reports stay accurate."
            />
          )}
          <Section title="Needs a category">
            <Card style={{ padding: 0, gap: 0, paddingTop: 6 }}>
              {r.reviewQueue.uncategorized.length === 0 && (
                <Empty icon="checkmark-done-outline" title="All caught up" />
              )}
              {r.reviewQueue.uncategorized.slice(0, 8).map((item: any) => (
                <CategorizeRow
                  key={item.id}
                  item={item}
                  categories={categories.data || []}
                  navigation={navigation}
                  onDone={review.reload}
                />
              ))}
            </Card>
          </Section>
          <Section title="Larger transactions">
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {r.reviewQueue.largeTransactions.length === 0 && (
                <Empty icon="checkmark-done-outline" title="Nothing unusual" />
              )}
              {r.reviewQueue.largeTransactions.slice(0, 5).map((item: any) => (
                <TransactionRow
                  key={item.id}
                  item={item}
                  onPress={() =>
                    navigation.navigate("Transaction", { id: item.id, item })
                  }
                />
              ))}
            </Card>
          </Section>
          {r.reviewQueue.newMerchants.length > 0 && (
            <Section title="New merchants">
              <Group>
                {r.reviewQueue.newMerchants.map((m: any) => (
                  <ListItem
                    key={m.key}
                    icon="storefront-outline"
                    title={m.name}
                    subtitle={
                      m.transactionCount
                        ? `${m.transactionCount} transactions`
                        : undefined
                    }
                    value={m.totalOut != null ? money(m.totalOut, currency) : undefined}
                    onPress={() =>
                      navigation.navigate("Transactions", { search: m.name })
                    }
                  />
                ))}
              </Group>
            </Section>
          )}
          <Section
            title="Recent imports"
            action="All imports"
            onAction={() =>
              navigation.navigate("Import", { openTab: "History", refreshKey: Date.now() })
            }
          >
            {r.importSummaries.length === 0 && (
              <Card>
                <Empty icon="document-text-outline" title="No imports yet" />
              </Card>
            )}
            {r.importSummaries.slice(0, 4).map((item: any) => (
              <ImportSummaryCard
                key={item.key}
                item={item}
                onPress={() => navigation.navigate("ImportDetail", { key: item.key })}
              />
            ))}
          </Section>
          <Button
            title="Staged imports"
            icon="layers-outline"
            secondary
            onPress={() =>
              navigation.navigate("Import", { openTab: "Staged", refreshKey: Date.now() })
            }
          />
        </>
      )}
    </Screen>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.row, { gap: 6 }]}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Txt muted size={12}>
        {label}
      </Txt>
    </View>
  );
}
const RANGES: Record<string, string> = {
  month: "Month",
  last3: "3 months",
  ytd: "Year to date",
  last12: "12 months",
  custom: "Custom",
};
const METRICS: Record<string, string> = {
  spending: "Spending",
  income: "Income",
  inOut: "In vs out",
  net: "Net",
};
const GROUPS: Record<string, string> = {
  month: "Month",
  day: "Day",
  category: "Category",
  merchant: "Merchant",
};
const CHARTS: Record<string, string> = { bar: "Bars", line: "Line", pie: "Pie" };
const csvCell = (v: any) => JSON.stringify(String(v ?? ""));
function ReportTab({ navigation, currency }: any) {
  const [filters, setFilters] = useState<any>({
    range: "month",
    metric: "spending",
    groupBy: "category",
  });
  const [chart, setChart] = useState("bar");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<any>(filters);
  const params = useMemo(() => {
    const { range, ...rest } = filters;
    return range === "custom" ? { ...rest, range: "month" } : filters;
  }, [filters]);
  const report = useResource("getAnalyticsReport", params);
  const r = report.data;
  const metricOf = (row: any) =>
    filters.metric === "income"
      ? row.totalIn
      : filters.metric === "net"
        ? row.totalIn - row.totalOut
        : row.totalOut;
  const timeGrouped = filters.groupBy === "month" || filters.groupBy === "day";
  const series = (r?.chartSeries || [])
    .filter((row: any) => timeGrouped || Number(row.metricValue ?? metricOf(row)) !== 0)
    .map((row: any) => ({
    key: row.key,
    label:
      row.label ||
      (filters.groupBy === "day" ? fmtDate(row.key, false) : fmtMonth(row.key, true)),
    value: filters.metric === "inOut" ? row.totalOut : Number(row.metricValue ?? metricOf(row)),
    secondary: filters.metric === "inOut" ? row.totalIn : undefined,
    color: timeGrouped ? undefined : row.color,
  }));
  const activeChips = [
    filters.categoryId &&
      `Category: ${r?.categories?.find((c: any) => c.id === filters.categoryId)?.name || "…"}`,
    filters.merchantKey &&
      `Merchant: ${r?.merchants?.find((m: any) => m.key === filters.merchantKey)?.name || "…"}`,
    filters.range === "custom" &&
      `${fmtDate(filters.dateFrom) || "Start"} – ${fmtDate(filters.dateTo) || "today"}`,
  ].filter(Boolean) as string[];
  return (
    <>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Chips
            values={Object.keys(RANGES)}
            labels={RANGES}
            value={filters.range}
            onChange={(range) => {
              if (range === "custom") {
                setDraft({ ...filters, range });
                setEditing(true);
              } else
                setFilters(({ dateFrom, dateTo, ...old }: any) => ({ ...old, range }));
            }}
          />
        </View>
      </View>
      <Segmented
        values={Object.keys(METRICS)}
        labels={METRICS}
        value={filters.metric}
        onChange={(metric) => setFilters((old: any) => ({ ...old, metric }))}
      />
      <View style={[styles.row, { gap: 8 }]}>
        <View style={{ flex: 1 }}>
          <Choice
            compact
            label="Group by"
            value={filters.groupBy}
            options={Object.entries(GROUPS).map(([value, label]) => ({
              value,
              label: `By ${label.toLowerCase()}`,
            }))}
            onChange={(groupBy) => setFilters((old: any) => ({ ...old, groupBy }))}
          />
        </View>
        <Button
          compact
          secondary
          icon="options-outline"
          title="Filters"
          onPress={() => {
            setDraft(filters);
            setEditing(true);
          }}
        />
      </View>
      {activeChips.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {activeChips.map((c) => (
            <Pill key={c} label={c} tone="purple" icon="funnel-outline" />
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setFilters(({ categoryId, merchantKey, dateFrom, dateTo, ...old }: any) => ({
                ...old,
                range: old.range === "custom" ? "month" : old.range,
              }))
            }
          >
            <Pill label="Clear" tone="red" icon="close" />
          </Pressable>
        </View>
      )}
      <State {...report} />
      {r && (
        <>
          <Txt muted size={13}>
            {fmtDate(r.period.start)} – {fmtDate(r.period.end)}
          </Txt>
          <StatGrid>
            <Stat icon="arrow-down" tone="green" label="Money in" value={money(r.summary.totalIn, currency)} />
            <Stat icon="arrow-up" label="Money out" value={money(r.summary.totalOut, currency)} />
            <Stat
              icon="swap-vertical"
              tone={r.summary.net >= 0 ? "green" : "red"}
              label="Net"
              value={signed(r.summary.net, currency)}
            />
            <Stat icon="list-outline" tone="blue" label="Transactions" value={String(r.summary.transactionCount)} />
          </StatGrid>
          <Card>
            <View style={styles.between}>
              <Txt bold size={17}>
                {METRICS[filters.metric]} by {GROUPS[filters.groupBy].toLowerCase()}
              </Txt>
            </View>
            <Segmented values={Object.keys(CHARTS)} labels={CHARTS} value={chart} onChange={setChart} />
            {series.length === 0 ? (
              <Empty title="No data for this period" />
            ) : chart === "pie" ? (
              <Donut
                data={(timeGrouped ? series : r.breakdown.map((b: any) => ({
                  key: b.key,
                  label: b.name,
                  value: Math.abs(b.metricValue),
                  color: b.color,
                }))).map((d: any) => ({ ...d, value: Math.abs(d.value) }))}
                currency={currency}
                centerLabel={METRICS[filters.metric]}
              />
            ) : chart === "line" ? (
              <AreaChart data={series} currency={currency} height={160} />
            ) : (
              <ColumnChart
                data={series}
                currency={currency}
                primaryLabel={filters.metric === "inOut" ? "Out" : undefined}
                secondaryLabel={filters.metric === "inOut" ? "In" : undefined}
              />
            )}
          </Card>
          <Section title={filters.groupBy === "merchant" ? "Merchants" : "Categories"}>
            <Card>
              {r.breakdown.length === 0 && <Empty title="Nothing to break down" />}
              <RankBars
                currency={currency}
                limit={12}
                data={r.breakdown.map((b: any) => ({
                  key: b.key,
                  label: `${b.name} · ${b.percentOfTotal}%`,
                  value: Number(b.metricValue),
                  color: b.color,
                }))}
                onSelect={(d) =>
                  setFilters((old: any) =>
                    filters.groupBy === "merchant"
                      ? { ...old, merchantKey: d.key }
                      : { ...old, categoryId: d.key },
                  )
                }
              />
            </Card>
          </Section>
          <Section
            title={`Transactions (${r.transactions.length})`}
            action="Share CSV"
            onAction={() =>
              void shareCsv(
                "fortuna-report.csv",
                [
                  "Date,Label,Description,Category,Merchant,In,Out",
                  ...r.transactions.map((t: any) =>
                    [
                      String(t.date).slice(0, 10),
                      t.label,
                      t.description,
                      t.category?.name,
                      t.merchant,
                      t.amountIn || 0,
                      t.amountOut || 0,
                    ]
                      .map(csvCell)
                      .join(","),
                  ),
                ].join("\n"),
              )
            }
          >
            <Card style={{ paddingVertical: 6, gap: 0 }}>
              {r.transactions.slice(0, 50).map((item: any) => (
                <TransactionRow
                  key={item.id}
                  item={item}
                  onPress={() => navigation.navigate("Transaction", { id: item.id, item })}
                />
              ))}
              {r.transactions.length > 50 && (
                <Txt muted size={12} style={{ padding: 10, textAlign: "center" }}>
                  Showing 50 of {r.transactions.length}. Share the CSV for all of them.
                </Txt>
              )}
            </Card>
          </Section>
        </>
      )}
      <Sheet
        visible={editing}
        onClose={() => setEditing(false)}
        title="Report filters"
        footer={
          <Button
            title="Apply filters"
            onPress={() => {
              setFilters(
                Object.fromEntries(
                  Object.entries(draft).filter(([, v]) => v !== "" && v != null),
                ),
              );
              setEditing(false);
            }}
          />
        }
      >
        <Choice
          label="Month"
          value={draft.month || r?.selectedMonth}
          options={(r?.importedMonths || []).map((m: string) => ({
            label: fmtMonth(m),
            value: m,
          }))}
          onChange={(month) => setDraft((d: any) => ({ ...d, month }))}
        />
        <Choice
          label="Period"
          value={draft.range}
          options={Object.entries(RANGES).map(([value, label]) => ({ value, label }))}
          onChange={(range) => setDraft((d: any) => ({ ...d, range }))}
        />
        {draft.range === "custom" && (
          <>
            <DateField
              label="From"
              value={draft.dateFrom || ""}
              onChange={(dateFrom) => setDraft((d: any) => ({ ...d, dateFrom }))}
            />
            <DateField
              label="To"
              value={draft.dateTo || ""}
              onChange={(dateTo) => setDraft((d: any) => ({ ...d, dateTo }))}
            />
          </>
        )}
        <Choice
          label="Category"
          value={draft.categoryId || ""}
          options={[
            { label: "All categories", value: "" },
            ...(r?.categories || []).map((c: any) => ({
              label: c.name,
              value: c.id,
              color: c.color,
            })),
          ]}
          onChange={(categoryId) => setDraft((d: any) => ({ ...d, categoryId }))}
        />
        <Choice
          label="Merchant"
          value={draft.merchantKey || ""}
          options={[
            { label: "All merchants", value: "" },
            ...(r?.merchants || []).map((m: any) => ({ label: m.name, value: m.key })),
          ]}
          onChange={(merchantKey) => setDraft((d: any) => ({ ...d, merchantKey }))}
        />
      </Sheet>
    </>
  );
}
function DeltaStat({ label, delta, currency }: any) {
  const n = Number(delta || 0);
  return (
    <Stat
      icon={n > 0 ? "trending-up" : "trending-down"}
      tone={n > 0 ? "red" : "green"}
      label={label}
      value={signed(n, currency)}
      detail={n > 0 ? "More spending" : n < 0 ? "Less spending" : "No change"}
    />
  );
}
function ChangeList({ rows, currency }: any) {
  if (!rows?.length) return <Empty title="No changes" />;
  return (
    <Group>
      {rows.map((row: any) => (
        <ListItem
          key={row.key}
          icon={row.delta > 0 ? "arrow-up" : "arrow-down"}
          tone={row.delta > 0 ? "red" : "green"}
          color={undefined}
          title={row.name}
          subtitle={`${money(row.previousTotalOut, currency)} → ${money(row.totalOut, currency)}`}
          value={signed(row.delta, currency)}
          valueTone={row.delta > 0 ? "red" : "green"}
          detail={row.percentDelta != null ? `${row.percentDelta > 0 ? "+" : ""}${row.percentDelta}%` : undefined}
        />
      ))}
    </Group>
  );
}
function InsightsTab({ navigation, currency }: any) {
  const [month, setMonth] = useState<string | undefined>();
  const insights = useResource("getAnalyticsInsights", month);
  const i = insights.data;
  return (
    <>
      {i?.importedMonths?.length > 0 && (
        <MonthStrip months={i.importedMonths} value={month || i.selectedMonth} onChange={setMonth} />
      )}
      <State {...insights} />
      {i && !i.hasTransactions && (
        <Card>
          <Empty title="No insights yet" message="Import a few months of statements to compare." />
        </Card>
      )}
      {i?.hasTransactions && (
        <>
          <Summary
            summary={i.monthlySummary}
            currency={currency}
            title={`Net cash flow · ${fmtMonth(i.selectedMonth)}`}
          />
          <StatGrid>
            <DeltaStat label={`Vs ${fmtMonth(i.monthlySummary.previousMonth, true)}`} delta={i.monthlySummary.spendingDelta} currency={currency} />
            <DeltaStat label="Vs 3-month average" delta={i.monthlySummary.threeMonthDelta} currency={currency} />
          </StatGrid>
          <Section title="Main spending drivers">
            <ChangeList rows={i.monthlySummary.mainDrivers} currency={currency} />
          </Section>
          <Section title="Top merchants">
            <Card>
              <RankBars
                currency={currency}
                data={(i.merchantInsights?.topMerchants || []).map((m: any) => ({
                  key: m.key,
                  label: m.name,
                  value: m.totalOut,
                }))}
                onSelect={(d) => navigation.navigate("Transactions", { search: d.label })}
              />
              {!i.merchantInsights?.topMerchants?.length && <Empty title="No merchants" />}
            </Card>
          </Section>
          {i.merchantInsights?.newMerchants?.length > 0 && (
            <Section title="New merchants this month">
              <Group>
                {i.merchantInsights.newMerchants.map((m: any) => (
                  <ListItem
                    key={m.key}
                    icon="sparkles-outline"
                    title={m.name}
                    value={money(m.totalOut, currency)}
                    onPress={() => navigation.navigate("Transactions", { search: m.name })}
                  />
                ))}
              </Group>
            </Section>
          )}
          <Section title="Category changes">
            <ChangeList rows={i.categoryChanges} currency={currency} />
          </Section>
          {i.anomalies?.length > 0 && (
            <Section title="Worth a second look">
              <Card style={{ paddingVertical: 6, gap: 0 }}>
                {i.anomalies.map((item: any) => (
                  <TransactionRow
                    key={item.id}
                    item={item}
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
function RecurringList({ rows, currency, navigation }: any) {
  if (!rows?.length) return <Empty title="No recurring spend found" />;
  return (
    <Group>
      {rows.map((m: any) => (
        <ListItem
          key={m.key}
          icon="repeat-outline"
          title={m.name}
          subtitle={`${m.frequency} · ${m.monthsSeen} months · ${m.stability}`}
          value={money(m.averageAmount, currency)}
          detail="average"
          onPress={() => navigation.navigate("Transactions", { search: m.name })}
        />
      ))}
    </Group>
  );
}
function OverallTab({ navigation, currency }: any) {
  const overview = useResource("getAnalyticsOverview");
  const o = overview.data;
  return (
    <>
      <State {...overview} />
      {o && (
        <>
          <Summary summary={o.summary} currency={currency} title="All-time net cash flow" />
          <StatGrid>
            <Stat icon="list-outline" tone="blue" label="Transactions" value={String(o.summary.transactionCount)} />
            <Stat icon="calendar-outline" label="Months" value={String(o.monthlyTrend?.length || 0)} />
          </StatGrid>
          <Section title="Long-term cash flow">
            <Card>
              <ColumnChart
                currency={currency}
                primaryLabel="Out"
                secondaryLabel="In"
                data={(o.monthlyTrend || []).map((t: any) => ({
                  key: t.month,
                  label: fmtMonth(t.month, true),
                  value: t.totalOut,
                  secondary: t.totalIn,
                }))}
              />
            </Card>
          </Section>
          <Section title="Top categories">
            <Card>
              <Donut
                currency={currency}
                centerLabel="Spent"
                data={(o.topCategories || []).map((c: any) => ({
                  key: c.key,
                  label: c.name,
                  value: c.totalOut,
                  color: c.color,
                }))}
              />
            </Card>
          </Section>
          <Section title="Top merchants">
            <Card>
              <RankBars
                currency={currency}
                data={(o.topMerchants || []).map((m: any) => ({
                  key: m.key,
                  label: m.name,
                  value: m.totalOut,
                }))}
                onSelect={(d) => navigation.navigate("Transactions", { search: d.label })}
              />
            </Card>
          </Section>
          <Section title="Recurring spend">
            <RecurringList rows={o.recurringMerchants} currency={currency} navigation={navigation} />
          </Section>
          {o.anomalies?.length > 0 && (
            <Section title="Large unusual transactions">
              <Card style={{ paddingVertical: 6, gap: 0 }}>
                {o.anomalies.map((item: any) => (
                  <TransactionRow
                    key={item.id}
                    item={item}
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
export function AnalyticsScreen({ navigation }: any) {
  const [tab, setTab] = useState("Reports");
  const user = useResource("getCurrentUser");
  const currency = user.data?.baseCurrency || "SGD";
  return (
    <Screen>
      <Heading title="The bigger picture" subtitle="Understand where your money goes." />
      <Segmented values={["Reports", "Insights", "Overall"]} value={tab} onChange={setTab} />
      {tab === "Reports" && <ReportTab navigation={navigation} currency={currency} />}
      {tab === "Insights" && <InsightsTab navigation={navigation} currency={currency} />}
      {tab === "Overall" && <OverallTab navigation={navigation} currency={currency} />}
    </Screen>
  );
}
