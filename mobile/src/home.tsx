import React, { useState } from "react";
import { RefreshControl, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useResource } from "./api";
import {
  Button,
  Card,
  Chips,
  Choice,
  Form,
  Heading,
  money,
  Screen,
  State,
  styles,
  TransactionRow,
  Txt,
  useTheme,
} from "./ui";
import { shareCsv } from "./sharing";

export function Summary({ summary, currency = "SGD" }: any) {
  return (
    <LinearGradient
      colors={["#5750F1", "#8136DA"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 24, padding: 24, gap: 22 }}
    >
      <View style={{ gap: 10 }}>
        <Txt style={{ color: "#E6E2FF" }}>Net cash flow</Txt>
        <Txt
          style={[
            styles.money,
            {
              fontSize: 34,
              lineHeight: 44,
              color: "#FFFFFF",
              letterSpacing: -1,
            },
          ]}
        >
          {money(summary.net, currency)}
        </Txt>
      </View>
      <View style={styles.between}>
        <View>
          <Txt size={12} style={{ color: "#E6E2FF" }}>
            ↓ Money in
          </Txt>
          <Txt bold style={{ color: "#FFFFFF", marginTop: 5 }}>
            {money(summary.totalIn, currency)}
          </Txt>
        </View>
        <View>
          <Txt size={12} style={{ color: "#E6E2FF" }}>
            ↑ Money out
          </Txt>
          <Txt bold style={{ color: "#FFFFFF", marginTop: 5 }}>
            {money(summary.totalOut, currency)}
          </Txt>
        </View>
      </View>
    </LinearGradient>
  );
}
export function Bars({ rows, currency = "SGD", onPress }: any) {
  const { colors } = useTheme();
  const max = Math.max(
    1,
    ...rows.map((r: any) =>
      Math.abs(Number(r.metricValue ?? r.totalOut ?? r.spending ?? 0)),
    ),
  );
  return (
    <View style={{ gap: 18 }}>
      {rows.map((r: any, i: number) => {
        const value = Number(r.metricValue ?? r.totalOut ?? r.spending ?? 0);
        return (
          <View key={r.key || r.month || i} style={{ gap: 8 }}>
            <View style={styles.between}>
              <Txt
                onPress={() => onPress?.(r)}
                style={{ flex: 1 }}
                numberOfLines={1}
              >
                {r.name ||
                  r.label ||
                  r.month ||
                  r.date ||
                  r.category?.name ||
                  "Uncategorized"}
              </Txt>
              <Txt style={[styles.money, { fontSize: 13 }]}>
                {money(value, currency)}
              </Txt>
            </View>
            <View
              style={{
                height: 7,
                borderRadius: 5,
                backgroundColor: colors.line,
              }}
            >
              <View
                style={{
                  height: 7,
                  borderRadius: 5,
                  width: `${(Math.abs(value) / max) * 100}%`,
                  backgroundColor: r.color || r.category?.color || "#5750F1",
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
export function HomeScreen({ navigation }: any) {
  const [month, setMonth] = useState<string | undefined>();
  const [tab, setTab] = useState("Overview");
  const overview = useResource("getDashboardOverview", month);
  const review = useResource("getDashboardReview");
  const user = useResource("getCurrentUser");
  const resource = tab === "Overview" ? overview : review;
  const o = overview.data;
  const r = review.data;
  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={resource.loading}
          onRefresh={resource.reload}
        />
      }
    >
      <Heading
        title={`Hello, ${user.data?.name?.split(" ")[0] || "you"}.`}
        subtitle="A little clarity for your money."
      />
      <Chips values={["Overview", "Review"]} value={tab} onChange={setTab} />
      <State {...resource} />
      {tab === "Overview" && o && (
        <>
          <Choice
            label="Month"
            value={month || o.selectedMonth}
            options={o.importedMonths.map((m: any) => ({
              label: m.month,
              value: m.month,
            }))}
            onChange={setMonth}
          />
          <Summary summary={o.summary} currency={user.data?.baseCurrency} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button
                title="Import"
                icon="add"
                onPress={() => navigation.navigate("Import")}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Analytics"
                icon="stats-chart-outline"
                secondary
                onPress={() => navigation.navigate("Analytics")}
              />
            </View>
          </View>
          {!o.hasTransactions && (
            <State empty="Import your first statement to see your money in one place." />
          )}
          <Card>
            <Txt bold size={18}>
              Spending over time
            </Txt>
            <Bars rows={o.trend} currency={user.data?.baseCurrency} />
          </Card>
          <Card>
            <View style={styles.between}>
              <Txt bold size={18}>
                Recent activity
              </Txt>
              <Txt
                onPress={() => navigation.navigate("Transactions")}
                style={{ color: "#5750F1" }}
              >
                See all
              </Txt>
            </View>
            {o.recentTransactions.map((item: any) => (
              <TransactionRow
                key={item.id}
                item={item}
                onPress={() => navigation.navigate("Transaction", { item })}
              />
            ))}
          </Card>
        </>
      )}
      {tab === "Review" && r && (
        <>
          <Card>
            <Txt bold size={18}>
              Your data, in good shape
            </Txt>
            <Txt>
              {r.dataHealth.categorizedPercent}% categorized ·{" "}
              {r.dataHealth.uncategorizedCount} to review
            </Txt>
            <Button
              title="Import history"
              secondary
              onPress={() => navigation.navigate("ImportHistory")}
            />
            <Button
              title="Agent drafts"
              secondary
              onPress={() => navigation.navigate("Drafts")}
            />
          </Card>
          {["uncategorized", "largeTransactions"].map((key) => (
            <Card key={key}>
              <Txt bold size={18}>
                {key === "uncategorized"
                  ? "Needs a category"
                  : "Larger transactions"}
              </Txt>
              {r.reviewQueue[key].length === 0 && (
                <Txt muted>All caught up.</Txt>
              )}
              {r.reviewQueue[key].map((item: any) => (
                <TransactionRow
                  key={item.id}
                  item={item}
                  onPress={() => navigation.navigate("Transaction", { item })}
                />
              ))}
            </Card>
          ))}
          <Card>
            <Txt bold size={18}>
              New merchants
            </Txt>
            {r.reviewQueue.newMerchants.map((m: any) => (
              <Txt key={m.key}>{m.name}</Txt>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
export function AnalyticsScreen({ navigation }: any) {
  const [tab, setTab] = useState("Report");
  const [filters, setFilters] = useState<any>({
    range: "month",
    metric: "expense",
    groupBy: "category",
  });
  const [showFilters, setShowFilters] = useState(false);
  const report = useResource("getAnalyticsReport", filters);
  const insights = useResource("getAnalyticsInsights", filters.month);
  const overview = useResource("getAnalyticsOverview");
  const r = report.data;
  const i = insights.data;
  const o = overview.data;
  return (
    <Screen>
      <Heading
        title="The bigger picture"
        subtitle="Understand where your money goes."
      />
      <Chips
        values={["Report", "Insights", "All time"]}
        value={tab}
        onChange={setTab}
      />
      <Button
        title={showFilters ? "Close filters" : "Change period & filters"}
        secondary
        icon="options-outline"
        onPress={() => setShowFilters(!showFilters)}
      />
      {showFilters && (
        <Card>
          <Form
            key={JSON.stringify(filters)}
            initial={filters}
            submit="Apply filters"
            fields={[
              {
                key: "month",
                label: "Month",
                options: (r?.importedMonths || []).map((m: string) => ({
                  label: m,
                  value: m,
                })),
              },
              {
                key: "range",
                label: "Period",
                options: ["month", "last3", "ytd", "last12", "custom"].map(
                  (value) => ({ label: value, value }),
                ),
              },
              { key: "dateFrom", label: "From", type: "date" },
              { key: "dateTo", label: "To", type: "date" },
              {
                key: "metric",
                label: "Measure",
                options: [
                  { label: "Spending", value: "expense" },
                  { label: "Income", value: "income" },
                  { label: "Net", value: "net" },
                ],
              },
              {
                key: "groupBy",
                label: "Group by",
                options: ["category", "merchant", "day", "month"].map(
                  (value) => ({ label: value, value }),
                ),
              },
              {
                key: "categoryId",
                label: "Category",
                options: [
                  { label: "All categories", value: "" },
                  ...(r?.categories || []).map((c: any) => ({
                    label: c.name,
                    value: c.id,
                  })),
                ],
              },
              {
                key: "merchantKey",
                label: "Merchant",
                options: [
                  { label: "All merchants", value: "" },
                  ...(r?.merchants || []).map((m: any) => ({
                    label: m.name,
                    value: m.key,
                  })),
                ],
              },
            ]}
            onSave={async (v) => {
              setFilters(v);
              setShowFilters(false);
            }}
          />
        </Card>
      )}
      <State
        {...(tab === "Report"
          ? report
          : tab === "Insights"
            ? insights
            : overview)}
      />
      {tab === "Report" && r && (
        <>
          <Summary summary={r.summary} />
          <Txt muted>
            {r.period.start.slice(0, 10)} — {r.period.end.slice(0, 10)}
          </Txt>
          <Card>
            <Txt bold size={18}>
              Breakdown
            </Txt>
            <Bars
              rows={r.breakdown}
              onPress={(row: any) =>
                navigation.navigate("Transactions", { search: row.name })
              }
            />
          </Card>
          <Card>
            <Txt bold size={18}>
              Over time
            </Txt>
            <Bars rows={r.chartSeries} />
          </Card>
          <Button
            title="Share report CSV"
            icon="share-outline"
            secondary
            onPress={() =>
              void shareCsv(
                "fortuna-report.csv",
                [
                  "Name,Income,Spending,Net",
                  ...r.breakdown.map(
                    (row: any) =>
                      `${JSON.stringify(row.name)},${row.totalIn},${row.totalOut},${row.net ?? row.totalIn - row.totalOut}`,
                  ),
                ].join("\n"),
              )
            }
          />
          {r.transactions.map((item: any) => (
            <TransactionRow
              key={item.id}
              item={item}
              onPress={() => navigation.navigate("Transaction", { item })}
            />
          ))}
        </>
      )}
      {tab === "Insights" && i && (
        <>
          <Summary summary={i.monthlySummary} />
          <Card>
            <Txt bold size={18}>
              What changed
            </Txt>
            <Bars rows={i.monthlySummary.mainDrivers} />
          </Card>
          <Card>
            <Txt bold size={18}>
              Recurring merchants
            </Txt>
            {i.recurringMerchants.map((m: any) => (
              <View key={m.key}>
                <Txt bold>{m.name}</Txt>
                <Txt muted>
                  {money(m.averageAmount)} · {m.frequency} · {m.monthsSeen}{" "}
                  months
                </Txt>
              </View>
            ))}
          </Card>
          <Card>
            <Txt bold size={18}>
              Category changes
            </Txt>
            <Bars rows={i.categoryChanges} />
          </Card>
          <Card>
            <Txt bold size={18}>
              Worth a second look
            </Txt>
            {i.anomalies.map((item: any) => (
              <TransactionRow
                key={item.id}
                item={item}
                onPress={() => navigation.navigate("Transaction", { item })}
              />
            ))}
          </Card>
        </>
      )}
      {tab === "All time" && o && (
        <>
          <Summary summary={o.summary} />
          <Card>
            <Txt bold size={18}>
              Monthly spending
            </Txt>
            <Bars rows={o.monthlyTrend} />
          </Card>
          <Card>
            <Txt bold size={18}>
              Top categories
            </Txt>
            <Bars rows={o.topCategories} />
          </Card>
          <Card>
            <Txt bold size={18}>
              Top merchants
            </Txt>
            <Bars rows={o.topMerchants} />
          </Card>
        </>
      )}
    </Screen>
  );
}
