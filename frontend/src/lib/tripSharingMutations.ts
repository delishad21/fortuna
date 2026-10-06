import * as sharingActions from "@/app/actions/tripSharing";
import type { Trip, TripActionResult, TripEntry } from "@/app/actions/trips";
import type {
  TripPeopleEntry,
  TripSharingSummary,
} from "@/app/actions/tripSharing";

/**
 * People and shared-trip actions that throw the data-service message on failure.
 * The server actions return it as a value because Next.js hides thrown messages
 * in production.
 */
function unwrap<T>(result: TripActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** The trip's sharing info; GET /api/trips adds it, but the Trip type predates it. */
export const tripSharingOf = (trip: Trip): TripSharingSummary | null =>
  (trip as Trip & { sharing?: TripSharingSummary | null }).sharing ?? null;

/** A trip entry with its IOU and settlement fields. */
export const asPeopleEntry = (entry: TripEntry): TripPeopleEntry =>
  entry as unknown as TripPeopleEntry;

export const getTripParticipants = async (
  ...args: Parameters<typeof sharingActions.getTripParticipants>
) => unwrap(await sharingActions.getTripParticipants(...args));

export const createTripParticipant = async (
  ...args: Parameters<typeof sharingActions.createTripParticipant>
) => unwrap(await sharingActions.createTripParticipant(...args));

export const renameTripParticipant = async (
  ...args: Parameters<typeof sharingActions.renameTripParticipant>
) => unwrap(await sharingActions.renameTripParticipant(...args));

export const deleteTripParticipant = async (
  ...args: Parameters<typeof sharingActions.deleteTripParticipant>
) => unwrap(await sharingActions.deleteTripParticipant(...args));

export const getTripBalances = async (
  ...args: Parameters<typeof sharingActions.getTripBalances>
) => unwrap(await sharingActions.getTripBalances(...args));

export const setTripSettlementAllocations = async (
  ...args: Parameters<typeof sharingActions.setTripSettlementAllocations>
) => unwrap(await sharingActions.setTripSettlementAllocations(...args));

export const createTripPeopleEntry = async (
  ...args: Parameters<typeof sharingActions.createTripPeopleEntry>
) => unwrap(await sharingActions.createTripPeopleEntry(...args));

export const addBankSettlements = async (
  ...args: Parameters<typeof sharingActions.addBankSettlements>
) => unwrap(await sharingActions.addBankSettlements(...args));

export const getTripPeopleEntries = async (
  ...args: Parameters<typeof sharingActions.getTripPeopleEntries>
) => unwrap(await sharingActions.getTripPeopleEntries(...args));

export const inviteTripMember = async (
  ...args: Parameters<typeof sharingActions.inviteTripMember>
) => unwrap(await sharingActions.inviteTripMember(...args));

export const getTripMembers = async (
  ...args: Parameters<typeof sharingActions.getTripMembers>
) => unwrap(await sharingActions.getTripMembers(...args));

export const updateTripMemberRole = async (
  ...args: Parameters<typeof sharingActions.updateTripMemberRole>
) => unwrap(await sharingActions.updateTripMemberRole(...args));

export const removeTripMember = async (
  ...args: Parameters<typeof sharingActions.removeTripMember>
) => unwrap(await sharingActions.removeTripMember(...args));

export const leaveSharedTrip = async (
  ...args: Parameters<typeof sharingActions.leaveSharedTrip>
) => unwrap(await sharingActions.leaveSharedTrip(...args));

export const getTripInvitations = async (
  ...args: Parameters<typeof sharingActions.getTripInvitations>
) => unwrap(await sharingActions.getTripInvitations(...args));

export const acceptTripInvitation = async (
  ...args: Parameters<typeof sharingActions.acceptTripInvitation>
) => unwrap(await sharingActions.acceptTripInvitation(...args));

export const declineTripInvitation = async (
  ...args: Parameters<typeof sharingActions.declineTripInvitation>
) => unwrap(await sharingActions.declineTripInvitation(...args));

export const getTripSharedOverview = async (
  ...args: Parameters<typeof sharingActions.getTripSharedOverview>
) => unwrap(await sharingActions.getTripSharedOverview(...args));

export const setTripEntryShares = async (
  ...args: Parameters<typeof sharingActions.setTripEntryShares>
) => unwrap(await sharingActions.setTripEntryShares(...args));
