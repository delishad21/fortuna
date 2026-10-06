import {
  getTrip,
  getTripAnalytics,
  getTripWalletSummaries,
} from "@/app/actions/trips";
import { getTripBalances } from "@/app/actions/tripSharing";
import { TripOverviewClient } from "@/components/trips/TripOverviewClient";

interface TripFundingPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripFundingPage({ params }: TripFundingPageProps) {
  const { tripId } = await params;
  const [trip, analytics, walletSummaries, balances] = await Promise.all([
    getTrip(tripId),
    getTripAnalytics(tripId),
    getTripWalletSummaries(tripId),
    getTripBalances(tripId),
  ]);

  return (
    <TripOverviewClient
      trip={trip}
      initialAnalytics={analytics}
      initialWallets={walletSummaries}
      initialBalances={balances.ok ? balances.data : null}
    />
  );
}
