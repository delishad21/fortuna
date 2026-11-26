import { getReimbursementPeople } from "@/app/actions/reimbursables";
import { BackfillClient } from "@/components/reimbursables/BackfillClient";

export default async function ReimbursableBackfillPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string }>;
}) {
  const { person } = await searchParams;
  const people = await getReimbursementPeople()
    .then((result) => result.people.map((entry) => entry.person.name))
    .catch(() => [] as string[]);
  return <BackfillClient people={people} initialPerson={person || people[0] || ""} />;
}
