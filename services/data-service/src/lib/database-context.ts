import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";
type DatabaseContext = {
  client: Prisma.TransactionClient | PrismaClient;
  transaction: boolean;
  afterCommit: Array<() => Promise<void>>;
};
export const databaseContext = new AsyncLocalStorage<DatabaseContext>();
export function withDatabase<T>(client: PrismaClient, work: () => Promise<T>) {
  return databaseContext.run(
    { client, transaction: false, afterCommit: [] },
    work,
  );
}
export function withTransactionClient<T>(
  client: Prisma.TransactionClient,
  work: () => Promise<T>,
  afterCommit: Array<() => Promise<void>> = [],
) {
  return databaseContext.run({ client, transaction: true, afterCommit }, work);
}
export async function afterCommit(work: () => Promise<void>) {
  const context = databaseContext.getStore();
  if (context?.transaction) context.afterCommit.push(work);
  else await work();
}
