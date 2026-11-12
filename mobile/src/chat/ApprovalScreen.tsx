import React, { useEffect, useRef, useState } from "react";
import { Switch, View } from "react-native";
import { Button, Card, Screen, Txt, useTheme } from "../ui";
import {
  useChatApi,
  Conversation,
  Proposal,
  previewHasChanges,
  proposalState,
  timeLeft,
} from "./api";
import { ProposalView } from "./ProposalView";
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
    state = proposal ? proposalState(proposal) : null,
    pending = !!state?.pending,
    left = pending ? timeLeft(proposal!.expiresAt) : "";
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
            : result.status === "expired"
              ? "This proposal expired; no changes were applied."
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
      {proposal && <ProposalView proposal={proposal} />}
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
      {state && (
        <Txt bold style={{ color: pending ? colors.purple : colors.muted }}>
          {state.label}
          {left ? ` · ${left}` : ""}
        </Txt>
      )}
      {proposal && state && ["expired", "stale"].includes(state.status) && (
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
      {pending && (
        <>
          <Button
            title="Confirm changes"
            disabled={
              busy ||
              preview.valid === false ||
              !previewHasChanges(proposal!) ||
              (duplicates && !override)
            }
            onPress={() => void decide("approve")}
          />
          <Button
            title="Reject"
            secondary
            disabled={busy}
            onPress={() => void decide("reject")}
          />
        </>
      )}
      <Button
        title="Back to conversation"
        secondary
        disabled={busy}
        onPress={() => navigation.goBack()}
      />
    </Screen>
  );
}
