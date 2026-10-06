"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Trash2, UserPlus, Users } from "lucide-react";
import type {
  TripMember,
  TripSharingSummary,
} from "@/app/actions/tripSharing";
import {
  getTripMembers,
  inviteTripMember,
  leaveSharedTrip,
  removeTripMember,
  updateTripMemberRole,
} from "@/lib/tripSharingMutations";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";

interface TripMembersPanelProps {
  tripId: string;
  sharing: TripSharingSummary | null;
  initialMembers: TripMember[];
}

const ROLE_OPTIONS = [
  { value: "editor", label: "Editor", description: "Adds their own spending" },
  { value: "viewer", label: "Viewer", description: "Can only look" },
];

const roleLabel = (role: string) =>
  role === "owner" ? "Owner" : role === "viewer" ? "Viewer" : "Editor";

/** Who the trip is shared with: invites, roles, removing people and leaving. */
export function TripMembersPanel({
  tripId,
  sharing,
  initialMembers,
}: TripMembersPanelProps) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [handle, setHandle] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<TripMember | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const role = sharing?.role ?? "owner";
  const isOwner = role === "owner";

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const reloadMembers = async () => {
    setMembers(await getTripMembers(tripId));
  };

  const handleInvite = async () => {
    const usernameOrEmail = handle.trim();
    if (!usernameOrEmail) return;
    const ok = await run(async () => {
      await inviteTripMember(tripId, { usernameOrEmail, role: inviteRole });
      await reloadMembers();
    }, `Invited ${usernameOrEmail}. They'll see it on their trips page.`);
    if (ok) {
      setHandle("");
      // The first invite turns this into a shared trip.
      if (!sharing) router.refresh();
    }
  };

  const handleRoleChange = (member: TripMember, next: string) =>
    run(async () => {
      await updateTripMemberRole(tripId, member.userId, next as "editor" | "viewer");
      await reloadMembers();
    });

  const handleRemove = (member: TripMember) =>
    run(async () => {
      await removeTripMember(tripId, member.userId);
      await reloadMembers();
      router.refresh();
    }, `${member.name} is no longer on this trip.`);

  const handleLeave = async () => {
    const ok = await run(() => leaveSharedTrip(tripId));
    if (ok) {
      setMembers([]);
      setNotice("You left the shared trip. This is now your own trip.");
      router.refresh();
    }
  };

  return (
    <div className="rounded-lg border border-stroke bg-white p-5 dark:border-dark-3 dark:bg-dark-2 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-dark dark:text-white">
            <Users className="h-4 w-4 text-primary" />
            Members
          </h3>
          <p className="text-xs text-dark-5 dark:text-dark-6">
            {sharing
              ? "Everyone keeps their own wallets and entries. Totals and entries are shared."
              : "Share this trip with other Fortuna users. They must accept the invite."}
          </p>
        </div>
        {sharing && (
          <Link href={`/trips/${tripId}/shared`}>
            <Button variant="secondary" size="sm">
              Shared overview
            </Button>
          </Link>
        )}
      </div>

      {sharing && !isOwner && (
        <p className="rounded-lg bg-gray-1 px-3 py-2 text-xs text-dark-5 dark:bg-dark-3 dark:text-dark-6">
          Trip details are managed by the owner.
          {role === "viewer" && " You can view this trip but not change it."}
        </p>
      )}

      {members.length > 0 && (
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.memberId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stroke px-3 py-2.5 dark:border-dark-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-dark dark:text-white">
                  {member.name}
                  {member.isMe && (
                    <span className="ml-1 text-xs font-normal text-dark-5 dark:text-dark-6">
                      (you)
                    </span>
                  )}
                </div>
                <div className="text-xs text-dark-5 dark:text-dark-6">
                  {roleLabel(member.role)}
                  {member.status === "invited" && " · Invited"}
                </div>
              </div>
              {isOwner && member.role !== "owner" && (
                <div className="flex items-center gap-2">
                  <Select
                    size="sm"
                    value={member.role}
                    onChange={(next) => {
                      if (next !== member.role) void handleRoleChange(member, next);
                    }}
                    options={ROLE_OPTIONS}
                    disabled={isBusy}
                    className="w-32"
                    buttonClassName="w-full"
                  />
                  <button
                    type="button"
                    onClick={() => setRemoving(member)}
                    disabled={isBusy}
                    className="rounded-md border border-stroke p-1.5 text-red transition-colors hover:bg-red/10 dark:border-dark-3"
                    aria-label={`Remove ${member.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isOwner && (
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9rem_auto]">
          <TextInput
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleInvite();
            }}
            placeholder="Username or email"
          />
          <Select
            value={inviteRole}
            onChange={(next) => setInviteRole(next as "editor" | "viewer")}
            options={ROLE_OPTIONS}
            className="w-full"
            buttonClassName="w-full"
          />
          <Button
            variant="primary"
            leftIcon={<UserPlus className="h-4 w-4" />}
            onClick={() => void handleInvite()}
            disabled={isBusy || !handle.trim()}
          >
            Invite
          </Button>
        </div>
      )}

      {sharing && !isOwner && members.length > 0 && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            leftIcon={<LogOut className="h-4 w-4" />}
            onClick={() => setConfirmLeave(true)}
            disabled={isBusy}
          >
            Leave trip
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red">{error}</p>}
      {notice && <p className="text-sm text-green">{notice}</p>}

      <Modal
        isOpen={!!removing}
        onClose={() => setRemoving(null)}
        type="warning"
        title={`Remove ${removing?.name ?? "this person"}?`}
        message="Their entries stay in their own copy of the trip. Shares between you become plain IOUs."
        confirmText="Remove"
        cancelText="Cancel"
        onConfirm={() => {
          if (removing) void handleRemove(removing);
        }}
      />

      <Modal
        isOpen={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        type="warning"
        title="Leave this trip?"
        message="Your entries stay in your own copy of the trip."
        confirmText="Leave"
        cancelText="Cancel"
        onConfirm={() => void handleLeave()}
      />
    </div>
  );
}
