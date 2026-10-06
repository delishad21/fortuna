import { getTrips } from "@/app/actions/trips";
import { getTripInvitations } from "@/app/actions/tripSharing";
import { getCurrentUser } from "@/app/actions/user";
import { TripInvitationsPanel } from "@/components/trips/TripInvitationsPanel";
import { TripsClient } from "@/components/trips/TripsClient";

export default async function TripsPage() {
  const [trips, user, invitations] = await Promise.all([
    getTrips(),
    getCurrentUser(),
    getTripInvitations(),
  ]);
  const baseCurrency = user?.baseCurrency || "SGD";
  const pendingInvitations = invitations.ok ? invitations.data : [];

  return (
    <div className="flex flex-col gap-6">
      {pendingInvitations.length > 0 && (
        <TripInvitationsPanel initialInvitations={pendingInvitations} />
      )}
      <TripsClient trips={trips} baseCurrency={baseCurrency} />
    </div>
  );
}
