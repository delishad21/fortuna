import { getTrip } from "@/app/actions/trips";
import { getTripSharedOverview } from "@/app/actions/tripSharing";
import { TripSharedOverviewClient } from "@/components/trips/TripSharedOverviewClient";

interface TripSharedPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripSharedPage({ params }: TripSharedPageProps) {
  const { tripId } = await params;
  const [trip, overview] = await Promise.all([
    getTrip(tripId),
    getTripSharedOverview(tripId),
  ]);

  return (
    <TripSharedOverviewClient
      trip={trip}
      overview={overview.ok ? overview.data : null}
      error={overview.ok ? null : overview.error}
    />
  );
}
