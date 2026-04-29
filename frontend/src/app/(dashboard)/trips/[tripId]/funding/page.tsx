import { redirect } from "next/navigation";

interface LegacyTripFundingPageProps {
  params: Promise<{ tripId: string }>;
}

export default async function LegacyTripFundingPage({ params }: LegacyTripFundingPageProps) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/manage/funding`);
}
