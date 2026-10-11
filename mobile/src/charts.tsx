import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { Dot, money, PALETTE, Progress, shortMoney, styles, tap, Txt, useTheme } from "./ui";

export type Datum = {
  key?: string;
  label: string;
  value: number;
  color?: string;
  secondary?: number;
  /** Small line under the label in legends, e.g. a change vs last month. */
  note?: string;
  noteTone?: "red" | "green";
};
const useWidth = () => {
  const [width, setWidth] = useState(0);
  return {
    width,
    onLayout: (e: any) => setWidth(Math.round(e.nativeEvent.layout.width)),
  };
};
/** Vertical columns; tap a column to read its value. */
export function ColumnChart({
  data,
  height = 160,
  currency = "SGD",
  color,
  secondaryColor,
  secondaryLabel,
  primaryLabel,
  onSelect,
  selectedKey,
  showLatest = true,
}: {
  data: Datum[];
  height?: number;
  currency?: string;
  color?: string;
  secondaryColor?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onSelect?: (d: Datum) => void;
  /** Column highlighted until one is tapped (defaults to the last). */
  selectedKey?: string;
  /** false: no column is highlighted (or dimmed) until one is tapped. */
  showLatest?: boolean;
}) {
  const { colors } = useTheme();
  const { width, onLayout } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const dataKey = data.map((d) => d.key ?? d.label).join("|");
  useEffect(() => setActive(null), [selectedKey, dataKey]);
  const paired = data.some((d) => d.secondary != null);
  const max = Math.max(
    1,
    ...data.map((d) => Math.max(Math.abs(d.value), Math.abs(d.secondary || 0))),
  );
  const n = Math.max(1, data.length);
  const slot = width / n;
  // Few columns get wide bars; many get thin ones.
  const barW = Math.max(3, Math.min(paired ? 20 : 36, slot * (paired ? 0.32 : 0.6)));
  const selectedIndex = selectedKey ? data.findIndex((d) => d.key === selectedKey) : -1;
  const shown =
    active ?? (selectedIndex >= 0 ? selectedIndex : showLatest && data.length ? data.length - 1 : null);
  const current = shown != null ? data[shown] : null;
  const labelEvery = Math.ceil(n / 6);
  const main = color || colors.purple;
  const second = secondaryColor || colors.green;
  return (
    <View style={{ gap: 10 }}>
      {current && (
        <View style={styles.between}>
          <Txt muted size={13}>
            {current.label}
          </Txt>
          <View style={[styles.row, { gap: 12 }]}>
            {paired && (
              <Txt mono size={13} style={{ color: second }}>
                {secondaryLabel ? `${secondaryLabel} ` : ""}
                {money(current.secondary, currency)}
              </Txt>
            )}
            <Txt mono size={13} style={{ color: paired ? main : colors.text }}>
              {primaryLabel ? `${primaryLabel} ` : ""}
              {money(current.value, currency)}
            </Txt>
          </View>
        </View>
      )}
      <View onLayout={onLayout} style={{ height }}>
        {width > 0 && (
          <Svg width={width} height={height}>
            {[0.25, 0.5, 0.75].map((f) => (
              <Line
                key={f}
                x1={0}
                x2={width}
                y1={height * f}
                y2={height * f}
                stroke={colors.line}
                strokeDasharray="3 5"
              />
            ))}
            {data.map((d, i) => {
              const h = Math.max(2, (Math.abs(d.value) / max) * (height - 6));
              const h2 = Math.max(2, (Math.abs(d.secondary || 0) / max) * (height - 6));
              const cx = slot * i + slot / 2;
              const dim = shown != null && shown !== i ? 0.35 : 1;
              return (
                <G key={d.key || i} opacity={dim}>
                  {paired && (
                    <Rect
                      x={cx - barW - 1}
                      y={height - h2}
                      width={barW}
                      height={h2}
                      rx={Math.min(4, barW / 2)}
                      fill={second}
                    />
                  )}
                  <Rect
                    x={paired ? cx + 1 : cx - barW / 2}
                    y={height - h}
                    width={barW}
                    height={h}
                    rx={Math.min(5, barW / 2)}
                    fill={d.color || main}
                  />
                </G>
              );
            })}
          </Svg>
        )}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" } as any}>
          {data.map((d, i) => (
            <Pressable
              key={d.key || i}
              accessibilityRole="button"
              accessibilityLabel={`${d.label}: ${money(d.value, currency)}`}
              style={{ flex: 1 }}
              onPress={() => {
                tap();
                setActive(i);
                onSelect?.(d);
              }}
            />
          ))}
        </View>
      </View>
      <View style={{ height: 14 }}>
        {width > 0 &&
          data.map((d, i) =>
            i % labelEvery === 0 ? (
              <Txt
                key={d.key || i}
                muted
                size={10}
                numberOfLines={1}
                style={{
                  position: "absolute",
                  left: Math.min(Math.max(slot * i + slot / 2 - 24, 0), width - 48),
                  width: 48,
                  textAlign: "center",
                }}
              >
                {slot * labelEvery < 48 || d.label.length > 6 ? d.label.split(" ")[0] : d.label}
              </Txt>
            ) : null,
          )}
      </View>
    </View>
  );
}
/** Smooth area line for a running series. */
export function AreaChart({
  data,
  height = 120,
  color,
  currency = "SGD",
}: {
  data: Datum[];
  height?: number;
  color?: string;
  currency?: string;
}) {
  const { colors } = useTheme();
  const { width, onLayout } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const stroke = color || colors.purple;
  const values = data.map((d) => d.value);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const pts = data.map((d, i) => [
    data.length === 1 ? width / 2 : (i / (data.length - 1)) * width,
    height - 4 - ((d.value - min) / span) * (height - 12),
  ]);
  const line = pts
    .map(([x, y], i) => {
      if (!i) return `M${x},${y}`;
      const [px, py] = pts[i - 1];
      const mx = (px + x) / 2;
      return `C${mx},${py} ${mx},${y} ${x},${y}`;
    })
    .join(" ");
  const shown = active ?? (data.length ? data.length - 1 : null);
  return (
    <View style={{ gap: 8 }}>
      {shown != null && data[shown] && (
        <View style={styles.between}>
          <Txt muted size={13}>
            {data[shown].label}
          </Txt>
          <Txt mono size={13}>
            {money(data[shown].value, currency)}
          </Txt>
        </View>
      )}
      <View onLayout={onLayout} style={{ height }}>
        {width > 0 && data.length > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={stroke} stopOpacity={0.28} />
                <Stop offset="1" stopColor={stroke} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={`${line} L${width},${height} L0,${height} Z`} fill="url(#area)" />
            <Path d={line} stroke={stroke} strokeWidth={2.5} fill="none" />
            {shown != null && pts[shown] && (
              <>
                <Line
                  x1={pts[shown][0]}
                  x2={pts[shown][0]}
                  y1={0}
                  y2={height}
                  stroke={colors.line}
                />
                <Circle
                  cx={pts[shown][0]}
                  cy={pts[shown][1]}
                  r={5}
                  fill={colors.card}
                  stroke={stroke}
                  strokeWidth={2.5}
                />
              </>
            )}
          </Svg>
        )}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row" } as any}>
          {data.map((d, i) => (
            <Pressable
              key={d.key || i}
              accessibilityLabel={`${d.label}: ${money(d.value, currency)}`}
              style={{ flex: 1 }}
              onPress={() => {
                tap();
                setActive(i);
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
};
/** Donut with a legend; tap a slice or legend row to focus it. */
export function Donut({
  data,
  currency = "SGD",
  size = 168,
  centerLabel = "Total",
  onSelect,
  limit = 6,
}: {
  data: Datum[];
  currency?: string;
  size?: number;
  centerLabel?: string;
  onSelect?: (d: Datum) => void;
  limit?: number;
}) {
  const { colors } = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const sorted = data
    .filter((d) => Math.abs(d.value) > 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const slices: Datum[] = [
    ...top.map((d, i) => ({ ...d, color: d.color || PALETTE[i % PALETTE.length] })),
    ...(rest.length
      ? [
          {
            key: "__other",
            label: `${rest.length} more`,
            value: rest.reduce((s, d) => s + Math.abs(d.value), 0),
            color: colors.faint,
          },
        ]
      : []),
  ];
  const total = slices.reduce((s, d) => s + Math.abs(d.value), 0) || 1;
  const stroke = 22;
  const r = (size - stroke) / 2;
  let angle = -Math.PI / 2;
  const focus = active != null ? slices[active] : null;
  return (
    <View style={{ gap: 18 }}>
      <View style={{ alignItems: "center" }}>
        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={colors.line}
              strokeWidth={stroke}
              fill="none"
            />
            {slices.map((d, i) => {
              const sweep = (Math.abs(d.value) / total) * Math.PI * 2;
              const gap = slices.length > 1 ? 0.03 : 0;
              const path =
                sweep >= Math.PI * 2 - 0.001
                  ? null
                  : arc(size / 2, size / 2, r, angle + gap / 2, angle + sweep - gap / 2);
              angle += sweep;
              return path ? (
                <Path
                  key={d.key || i}
                  d={path}
                  stroke={d.color}
                  strokeWidth={active === i ? stroke + 6 : stroke}
                  strokeLinecap="butt"
                  fill="none"
                  opacity={active == null || active === i ? 1 : 0.35}
                />
              ) : (
                <Circle
                  key={d.key || i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={d.color}
                  strokeWidth={stroke}
                  fill="none"
                />
              );
            })}
          </Svg>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: stroke + 8,
            } as any}
          >
            <Txt muted size={12} numberOfLines={1}>
              {focus ? focus.label : centerLabel}
            </Txt>
            <Txt mono size={17} numberOfLines={1} adjustsFontSizeToFit>
              {shortMoney(focus ? focus.value : total, currency)}
            </Txt>
            {focus && (
              <Txt muted size={12}>
                {Math.round((Math.abs(focus.value) / total) * 100)}%
              </Txt>
            )}
          </View>
        </View>
      </View>
      <View style={{ gap: 4 }}>
        {slices.map((d, i) => (
          <Pressable
            key={d.key || i}
            accessibilityRole="button"
            accessibilityLabel={`${d.label}: ${money(d.value, currency)}`}
            onPress={() => {
              tap();
              setActive(active === i ? null : i);
              if (d.key !== "__other") onSelect?.(d);
            }}
            style={({ pressed }) => [
              styles.between,
              {
                paddingVertical: 8,
                paddingHorizontal: 8,
                borderRadius: 8,
                backgroundColor:
                  active === i ? colors.sunken : pressed ? colors.sunken : "transparent",
              },
            ]}
          >
            <View style={[styles.row, { flex: 1, gap: 10 }]}>
              <Dot color={d.color!} size={10} />
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={1}>{d.label}</Txt>
                {!!d.note && (
                  <Txt size={11} tone={d.noteTone} muted={!d.noteTone} numberOfLines={1}>
                    {d.note}
                  </Txt>
                )}
              </View>
            </View>
            <Txt muted size={12} style={{ width: 40, textAlign: "right" }}>
              {Math.round((Math.abs(d.value) / total) * 100)}%
            </Txt>
            <Txt mono size={13} style={{ minWidth: 84, textAlign: "right" }}>
              {money(d.value, currency)}
            </Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
/** Ranked horizontal bars, e.g. top merchants. */
export function RankBars({
  data,
  currency = "SGD",
  onSelect,
  limit = 8,
}: {
  data: Datum[];
  currency?: string;
  onSelect?: (d: Datum) => void;
  limit?: number;
}) {
  const { colors } = useTheme();
  const rows = data.slice(0, limit);
  const max = Math.max(1, ...rows.map((d) => Math.abs(d.value)));
  return (
    <View style={{ gap: 14 }}>
      {rows.map((d, i) => (
        <Pressable
          key={d.key || i}
          accessibilityRole={onSelect ? "button" : undefined}
          accessibilityLabel={`${d.label}: ${money(d.value, currency)}`}
          disabled={!onSelect}
          onPress={() => onSelect?.(d)}
          style={{ gap: 6 }}
        >
          <View style={styles.between}>
            <Txt numberOfLines={1} style={{ flex: 1 }}>
              {d.label}
            </Txt>
            <Txt mono size={13}>
              {money(d.value, currency)}
            </Txt>
          </View>
          <Progress
            value={Math.abs(d.value) / max}
            color={d.color || colors.purple}
            height={7}
          />
        </Pressable>
      ))}
    </View>
  );
}
