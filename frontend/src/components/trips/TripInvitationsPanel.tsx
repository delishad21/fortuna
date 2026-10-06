"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Mail } from "lucide-react";
import type { TripInvitation } from "@/app/actions/tripSharing";
import {
  acceptTripInvitation,
  declineTripInvitation,
} from "@/lib/tripSharingMutations";
import { Button } from "@/components/ui/Button";

interface TripInvitationsPanelProps {
  initialInvitations: TripInvitation[];
}

const formatDate = (value: string) => format(new Date(value), "dd MMM yyyy");

/** Pending invitations to other people's trips. Accepting opens your copy of the trip. */
export function TripInvitationsPanel({ initialInvitations }: TripInvitationsPanelProps) {
  const router = useRouter();
  const [invitations, setInvitations] = useState(initialInvitations);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  if (invitations.length === 0) return null;

  const handleAccept = async (invitation: TripInvitation) => {
    setBusyId(invitation.memberId);
    setAccepting(true);
    setError("");
    try {
      const { tripId } = await acceptTripInvitation(invitation.memberId);
      router.push(`/trips/${tripId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept the invitation.");
      setBusyId(null);
      setAccepting(false);
    }
  };

  const handleDecline = async (invitation: TripInvitation) => {
    setBusyId(invitation.memberId);
    setError("");
    try {
      await declineTripInvitation(invitation.memberId);
      setInvitations((prev) =>
        prev.filter((item) => item.memberId !== invitation.memberId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decline the invitation.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-white p-4 dark:border-primary/60 dark:bg-dark-2 space-y-3">
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-white">
        <Mail className="h-4 w-4 text-primary" />
        Trip invitations
      </h3>
      {invitations.map((invitation) => (
        <div
          key={invitation.memberId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stroke px-3 py-2.5 dark:border-dark-3"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-dark dark:text-white">
              {invitation.tripName}
            </div>
            <div className="text-xs text-dark-5 dark:text-dark-6">
              {invitation.invitedBy ? `From ${invitation.invitedBy} · ` : ""}
              {formatDate(invitation.startDate)}
              {invitation.endDate ? ` – ${formatDate(invitation.endDate)}` : ""}
              {" · "}
              {invitation.role === "viewer" ? "Viewer" : "Editor"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleDecline(invitation)}
              disabled={busyId !== null}
            >
              Decline
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleAccept(invitation)}
              disabled={busyId !== null}
            >
              {accepting && busyId === invitation.memberId ? "Joining..." : "Accept"}
            </Button>
          </div>
        </div>
      ))}
      {error && <p className="text-sm text-red">{error}</p>}
    </div>
  );
}
