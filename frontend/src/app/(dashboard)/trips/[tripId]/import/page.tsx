import {
  getTrip,
  getTripFundings,
  getTrips,
  getWallets,
} from "@/app/actions/trips";
import { getCategories } from "@/app/actions/categories";
import { TripImportReviewClient } from "@/components/trips/TripImportReviewClient";
import { getParserOptions } from "@/lib/parsers";

interface TripImportPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripImportPage({ params }: TripImportPageProps) {
  const { tripId } = await params;
  const [trip, wallets, categories, tripParsers, allTrips, fundings] =
    await Promise.all([
      getTrip(tripId),
      getWallets(tripId),
      getCategories({ scope: "trips" }),
      getParserOptions("trip"),
      getTrips(),
      getTripFundings(tripId),
    ]);

  return (
    <TripImportReviewClient
      trip={trip}
      wallets={wallets}
      categories={categories}
      tripParserOptions={tripParsers}
      allTrips={allTrips}
      fundings={fundings}
    />
  );
}
