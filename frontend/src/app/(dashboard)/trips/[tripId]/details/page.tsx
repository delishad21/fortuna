import { getTrip, getTripEntries, getTripFundings } from "@/app/actions/trips";
import { TripDetailsClient } from "@/components/trips/TripDetailsClient";

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
  return <TripDetailsClient trip={trip} hasActivity={hasActivity} />;
}
