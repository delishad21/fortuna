import React, { useState } from "react";
import { View } from "react-native";
import { useApi } from "./api";
import { Button, fmtDate, Input, KeyValue, money, notice, plural, styles, toast, Txt } from "./ui";
import { decidedByLabel } from "../../frontend/shared/entrySource";
import {
  transactionTypeLabel,
  type AssistantDecision,
  type EntryClassification,
  type EntryQuestion,
  type ReviewPrecedent,
} from "../../frontend/shared/reviewTypes";

/**
 * How an assistant entry was classified (who decided, the assistant's
 * reasoning and the past entries it leaned on), and its open questions.
 */

const precedentAmount = (p: ReviewPrecedent) =>
  p.amountIn ? `+${money(p.amountIn)}` : p.amountOut ? `-${money(p.amountOut)}` : money(0);

export function DecisionBlock({
  classification,
  decision,
  merchant,
  transactionType,
  precedents,
}: {
  classification?: EntryClassification | null;
  decision?: AssistantDecision | null;
  merchant?: string | null;
  transactionType?: string | null;
  precedents?: ReviewPrecedent[];
}) {
  const decidedBy = decidedByLabel(classification?.decidedBy);
  const type = transactionTypeLabel(transactionType ?? decision?.transactionType);
  const shop = merchant ?? decision?.merchant;
  const confidence = decision?.confidence;
  if (!decidedBy && !type && !shop && confidence == null && !decision?.reason && !precedents?.length) return null;
  return (
    <View style={{ gap: 8 }}>
      {!!decidedBy && <KeyValue label="Decided by" value={decidedBy} />}
      {classification?.decidedBy === "rule" && !!classification.ruleName && (
        <KeyValue label="Rule" value={classification.ruleName} />
      )}
      {!!classification?.structural?.reason && <Txt muted size={13}>{classification.structural.reason}</Txt>}
      {!!classification?.conflict && (
        <Txt tone="amber" size={13}>
          Rule “{classification.conflict.rule}” won over the assistant's {classification.conflict.assistant}
        </Txt>
      )}
      {!!type && <KeyValue label="Type" value={type} />}
      {!!shop && <KeyValue label="Merchant" value={shop} />}
      {confidence != null && <KeyValue label="Confidence" value={`${Math.round(confidence * 100)}%`} />}
      {!!decision?.reason && <Txt size={13}>{decision.reason}</Txt>}
      {!!precedents?.length && (
        <View style={{ gap: 4 }}>
          <Txt muted size={13} bold>
            Based on {plural(precedents.length, "past entry", "past entries")}
          </Txt>
          {precedents.map((p) => (
            <View key={p.id} style={[styles.between, { gap: 8 }]}>
              <Txt size={13} numberOfLines={1} style={{ flex: 1 }}>
                {fmtDate(p.date, false)} · {p.label || p.description}
                {p.category ? ` · ${p.category}` : ""}
              </Txt>
              <Txt mono size={13} muted>
                {precedentAmount(p)}
              </Txt>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Question({
  transactionId,
  question,
  onAnswered,
}: {
  transactionId: string;
  question: EntryQuestion;
  onAnswered: () => Promise<any> | void;
}) {
  const { call } = useApi();
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (key: string, body: { option?: string; value?: string }) => {
    setBusy(key);
    try {
      const result = await call<{ alsoAnswered?: unknown[] }>("answerReviewQuestion", {
        transactionId,
        questionId: question.id,
        ...body,
      });
      const also = result?.alsoAnswered?.length || 0;
      toast(also ? `Answered, with ${plural(also, "other entry", "other entries")}` : "Answered");
      setOther("");
      await onAnswered();
    } catch (error) {
      notice(error);
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Txt size={14} bold>
        {question.prompt}
      </Txt>
      {question.options.length > 0 && (
        <View style={[styles.row, { gap: 6, flexWrap: "wrap" }]}>
          {question.options.map((option) => (
            <Button
              key={option.id}
              title={option.label}
              compact
              secondary
              loading={busy === option.id}
              disabled={!!busy}
              onPress={() => void answer(option.id, { option: option.id })}
            />
          ))}
        </View>
      )}
      {question.allowOther && (
        <View style={[styles.row, { gap: 6, alignItems: "flex-end" }]}>
          <View style={{ flex: 1 }}>
            <Input value={other} onChangeText={setOther} placeholder="Something else" />
          </View>
          <Button
            title="Send"
            compact
            loading={busy === "other"}
            disabled={!!busy || !other.trim()}
            onPress={() => void answer("other", { value: other.trim() })}
          />
        </View>
      )}
    </View>
  );
}

/** An entry's open questions, each answered with a tap or a typed answer. */
export function Questions({
  transactionId,
  questions,
  onAnswered,
}: {
  transactionId: string;
  questions: EntryQuestion[] | null | undefined;
  onAnswered: () => Promise<any> | void;
}) {
  if (!questions?.length) return null;
  return (
    <View style={{ gap: 12 }}>
      {questions.map((q) => (
        <Question key={q.id} transactionId={transactionId} question={q} onAnswered={onAnswered} />
      ))}
    </View>
  );
}
