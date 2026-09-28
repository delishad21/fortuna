import { databaseContext } from "./database-context";
import { PrismaClient } from "@prisma/client";

const prismaClientSingleton = () => {
  return new PrismaClient();
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

// Domain services may join an outer approval transaction without opening a second connection.
const scopedPrisma: PrismaClient = new Proxy(prisma, {
  get(target, property) {
    const context = databaseContext.getStore();
    const client = context?.client && context.client !== scopedPrisma ? context.client : target;
    if (property === "$transaction" && context?.transaction) {
      return (work: unknown) =>
        typeof work === "function"
          ? work(client)
          : Promise.all(work as Promise<unknown>[]);
    }
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
export default scopedPrisma;

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = prisma;
