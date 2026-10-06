import {
  getFundingCandidates,
  getTrip,
  getTripEntries,
  getTripFundings,
  getTrips,
  getWallets,
  getTripWalletSummaries,
} from "@/app/actions/trips";
import { getCategories } from "@/app/actions/categories";
import { getTripParticipants } from "@/app/actions/tripSharing";
import { TripTransactionsClient } from "@/components/trips/TripTransactionsClient";

interface TripManagePageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripManagePage({ params }: TripManagePageProps) {
  const { tripId } = await params;
  const [
    trip,
    fundings,
    wallets,
    walletSummaries,
    entries,
    fundingOutEntries,
    categories,
    fundingCandidates,
    allTrips,
    participants,
  ] = await Promise.all([
    getTrip(tripId),
    getTripFundings(tripId),
    getWallets(tripId),
    getTripWalletSummaries(tripId),
    getTripEntries(tripId, { limit: 20, offset: 0 }),
    getTripEntries(tripId, {
      type: "funding_out",
      limit: 200,
      offset: 0,
    }),
    getCategories({ scope: "trips" }),
    getFundingCandidates(tripId, { limit: 20, offset: 0 }),
    getTrips(),
    getTripParticipants(tripId),
  ]);

  return (
    <TripTransactionsClient
      trip={trip}
      fundings={fundings}
      wallets={wallets}
      walletSummaries={walletSummaries}
      categories={categories}
      initialEntries={entries.items}
      initialFundingOutEntries={fundingOutEntries.items}
      initialEntriesTotal={entries.total}
      initialFundingCandidates={fundingCandidates}
      allTrips={allTrips}
      initialParticipants={participants.ok ? participants.data : undefined}
    />
  );
}
