import {
  getTrip,
  getTripAnalytics,
  getTripWalletSummaries,
} from "@/app/actions/trips";
import { TripOverviewClient } from "@/components/trips/TripOverviewClient";

interface TripFundingPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripFundingPage({ params }: TripFundingPageProps) {
  const { tripId } = await params;
  const [trip, analytics, walletSummaries] = await Promise.all([
    getTrip(tripId),
    getTripAnalytics(tripId),
    getTripWalletSummaries(tripId),
  ]);

  return (
    <TripOverviewClient
      trip={trip}
      initialAnalytics={analytics}
      initialWallets={walletSummaries}
    />
  );
}
