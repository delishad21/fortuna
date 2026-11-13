import React from "react";
import { View } from "react-native";
import { Txt, useTheme } from "../ui";
import { parseMarkdown, type Span } from "./markdown";

/** Renders an assistant reply's markdown with the app's fonts and theme colours. */
export function Markdown({ text }: { text: string }) {
  const { colors } = useTheme();
  const spans = (list: Span[]) =>
    list.map((span, n) =>
      span.type === "bold" ? (
        <Txt key={n} bold>
          {span.text}
        </Txt>
      ) : span.type === "code" ? (
        <Txt
          key={n}
          size={13.5}
          style={{
            fontFamily: "DMMono_400Regular",
            backgroundColor: colors.line,
          }}
        >
          {span.text}
        </Txt>
      ) : (
        span.text
      ),
    );
  return (
    <View style={{ gap: 12 }}>
      {parseMarkdown(text).map((block, b) => {
        if (block.type === "heading")
          return (
            <Txt key={b} selectable bold>
              {spans(block.spans)}
            </Txt>
          );
        if (block.type === "list")
          return (
            <View key={b} style={{ gap: 4 }}>
              {block.items.map((item, n) => (
                <View key={n} style={{ flexDirection: "row", gap: 6 }}>
                  <Txt
                    muted={!block.ordered}
                    style={{ minWidth: block.ordered ? 20 : 12 }}
                  >
                    {block.ordered ? `${n + 1}.` : "•"}
                  </Txt>
                  <Txt selectable style={{ flex: 1 }}>
                    {spans(item)}
                  </Txt>
                </View>
              ))}
            </View>
          );
        return (
          <Txt key={b} selectable>
            {block.lines.map((line, n) => (
              <React.Fragment key={n}>
                {n > 0 && "\n"}
                {spans(line)}
              </React.Fragment>
            ))}
          </Txt>
        );
      })}
    </View>
  );
}
