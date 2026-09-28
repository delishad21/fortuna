import React, { useEffect, useRef, useState } from "react";
import { Switch, View } from "react-native";
import { Button, Card, Screen, Txt, useTheme } from "../ui";
import {
  useChatApi,
  Conversation,
  Proposal,
  changedFields,
  fieldLabel,
  displayValue,
} from "./api";
import { Details } from "./Details";
export function ChatApprovalScreen({ route, navigation }: any) {
  const { id, conversationId } = route.params,
    api = useChatApi(),
    { colors } = useTheme(),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [busy, setBusy] = useState(false),
    [override, setOverride] = useState(false),
    [message, setMessage] = useState(""),
    locked = useRef(false);
  useEffect(() => {
    void api<Conversation>(`/conversations/${conversationId}`)
      .then((c) => {
        const found = c.runs
          .flatMap((r) => r.proposals)
          .find((p) => p.id === id);
        if (!found)
          throw new Error(
            "This proposal is no longer available. Return to the conversation.",
          );
        setProposal(found);
      })
      .catch((e) => setMessage(e.message));
  }, [api, id, conversationId]);
  const preview = proposal?.preview || {},
    duplicates =
      Array.isArray(preview.duplicates) && preview.duplicates.length > 0,
    pending =
      proposal?.status === "pending" &&
      new Date(proposal.expiresAt) > new Date();
  async function decide(decision: "approve" | "reject") {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const result = await api(`/proposals/${proposal!.id}/${decision}`, {
        method: "POST",
        body: { duplicateOverride: override },
      });
      setProposal((p) => (p ? { ...p, status: result.status } : null));
      setMessage(
        result.status === "applied"
          ? "Changes applied"
          : result.status === "stale"
            ? "Records changed. Return to the conversation and ask for a fresh preview. No changes were applied."
            : "Proposal rejected.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  return (
    <Screen>
      <Txt bold size={25}>
        {preview.title || "Review changes"}
      </Txt>
      <Txt muted>
        Only these changes will be applied. Changed records require a fresh
        preview.
      </Txt>
      {preview.changes?.map((change: any) => (
        <Card key={change.id}>
          <Txt bold>{change.before.description || change.id}</Txt>
          {changedFields(change.before, change.after).map((key) => (
            <View
              key={key}
              style={{
                gap: 8,
                borderTopWidth: 1,
                borderColor: colors.line,
                paddingTop: 12,
              }}
            >
              <Txt bold>{fieldLabel(key)}</Txt>
              <Txt muted size={12}>
                Before
              </Txt>
              <Txt selectable>{displayValue(change.before[key])}</Txt>
              <Txt muted size={12}>
                After
              </Txt>
              <View
                style={{
                  backgroundColor: colors.tint,
                  padding: 12,
                  borderRadius: 8,
                }}
              >
                <Txt selectable>{displayValue(change.after[key])}</Txt>
              </View>
            </View>
          ))}
        </Card>
      ))}
      {proposal && !preview.changes && (
        <Card>
          <Details value={preview} />
        </Card>
      )}
      {duplicates && (
        <Card>
          <Txt>
            I reviewed the duplicate matches and want to commit them anyway.
          </Txt>
          <Switch
            accessibilityLabel="Commit duplicate matches anyway"
            value={override}
            onValueChange={setOverride}
          />
        </Card>
      )}
      {!!message && <Txt accessibilityRole="alert">{message}</Txt>}
      {proposal && !pending && (
        <Txt muted>
          Status: {proposal.status === "pending" ? "expired" : proposal.status}
        </Txt>
      )}
      {proposal &&
        !pending &&
        ["pending", "stale"].includes(proposal.status) && (
          <Button
            title="Refresh preview"
            secondary
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void api<Proposal>(`/proposals/${proposal.id}/refresh`, {
                method: "POST",
                body: {},
              })
                .then((fresh) => {
                  setProposal(fresh);
                  setOverride(false);
                  setMessage("Review the refreshed preview.");
                  navigation.setParams({ id: fresh.id });
                })
                .catch((e) => setMessage(e.message))
                .finally(() => setBusy(false));
            }}
          />
        )}
      <Button
        title="Confirm changes"
        disabled={
          busy ||
          !pending ||
          preview.valid === false ||
          (duplicates && !override)
        }
        onPress={() => void decide("approve")}
      />
      <Button
        title="Reject"
        secondary
        disabled={busy || !pending}
        onPress={() => void decide("reject")}
      />
      <Button
        title="Back to conversation"
        secondary
        disabled={busy}
        onPress={() => navigation.goBack()}
      />
    </Screen>
  );
}
