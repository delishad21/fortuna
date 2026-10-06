import { getTrip, getTripEntries, getTripFundings } from "@/app/actions/trips";
import { getTripMembers } from "@/app/actions/tripSharing";
import { TripDetailsClient } from "@/components/trips/TripDetailsClient";
import { TripMembersPanel } from "@/components/trips/TripMembersPanel";
import { tripSharingOf } from "@/lib/tripSharingMutations";

interface TripDetailsPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripDetailsPage({ params }: TripDetailsPageProps) {
  const { tripId } = await params;
  const [trip, entries, fundings] = await Promise.all([
    getTrip(tripId),
    getTripEntries(tripId, { limit: 1 }),
    getTripFundings(tripId),
  ]);
  const hasActivity = entries.total > 0 || fundings.length > 0;
  const sharing = tripSharingOf(trip);
  const members = sharing ? await getTripMembers(tripId) : null;

  return (
    <div className="space-y-4">
      <TripDetailsClient trip={trip} hasActivity={hasActivity} />
      <div className="max-w-3xl">
        <TripMembersPanel
          tripId={trip.id}
          sharing={sharing}
          initialMembers={members?.ok ? members.data : []}
        />
      </div>
    </div>
  );
}
