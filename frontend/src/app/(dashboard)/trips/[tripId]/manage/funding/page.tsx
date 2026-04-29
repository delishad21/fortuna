import {
  getFundingCandidates,
  getTrip,
  getTripEntries,
  getTripFundings,
  getWallets,
  getTripWalletSummaries,
} from "@/app/actions/trips";
import { getCategories } from "@/app/actions/categories";
import { TripManageFundingClient } from "@/components/trips/TripManageFundingClient";
import { getParserOptions } from "@/lib/parsers";

interface TripManageFundingPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripManageFundingPage({
  params,
}: TripManageFundingPageProps) {
  const { tripId } = await params;
  const [
    trip,
    fundings,
    wallets,
    walletSummaries,
    entries,
    categories,
    fundingCandidates,
    tripParsers,
  ] = await Promise.all([
    getTrip(tripId),
    getTripFundings(tripId),
    getWallets(tripId),
    getTripWalletSummaries(tripId),
    getTripEntries(tripId, { limit: 20, offset: 0 }),
    getCategories({ scope: "trips" }),
    getFundingCandidates(tripId, { limit: 20, offset: 0 }),
    getParserOptions("trip"),
  ]);

  return (
    <TripManageFundingClient
      trip={trip}
      fundings={fundings}
      wallets={wallets}
      walletSummaries={walletSummaries}
      categories={categories}
      initialEntries={entries.items}
      initialEntriesTotal={entries.total}
      initialFundingCandidates={fundingCandidates}
      tripParserOptions={tripParsers}
      viewMode="funding"
    />
  );
}
