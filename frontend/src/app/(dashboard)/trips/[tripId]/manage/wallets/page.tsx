import {
  getTrip,
  getTripFundings,
  getTripWalletSummaries,
  getWallets,
  getSourceTransactionCandidates,
} from "@/app/actions/trips";
import { TripWalletsManagementClient } from "@/components/trips/TripWalletsManagementClient";

interface TripManageWalletsPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripManageWalletsPage({
  params,
}: TripManageWalletsPageProps) {
  const { tripId } = await params;
  const [trip, wallets, walletSummaries, fundings, sourceCandidates] =
    await Promise.all([
      getTrip(tripId),
      getWallets(tripId),
      getTripWalletSummaries(tripId),
      getTripFundings(tripId),
      getSourceTransactionCandidates(tripId, { limit: 20, offset: 0 }),
    ]);

  return (
    <TripWalletsManagementClient
      trip={trip}
      wallets={wallets}
      walletSummaries={walletSummaries}
      fundings={fundings}
      initialSourceCandidates={sourceCandidates}
    />
  );
}
