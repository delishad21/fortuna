import { getTrip } from "@/app/actions/trips";
import { TripDetailsClient } from "@/components/trips/TripDetailsClient";

interface TripDetailsPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function TripDetailsPage({ params }: TripDetailsPageProps) {
  const { tripId } = await params;
  const trip = await getTrip(tripId);
  return <TripDetailsClient trip={trip} />;
}
