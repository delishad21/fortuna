import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { inferImportSourceFilename } from "../modules/imports/import-source";

const hasSourceFilename = (metadata: unknown) =>
  !!(
    metadata &&
    typeof metadata === "object" &&
    typeof (metadata as Record<string, unknown>).sourceFilename === "string" &&
    ((metadata as Record<string, unknown>).sourceFilename as string).trim()
  );

const toMetadataObject = (metadata: unknown) =>
  metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};

const main = async () => {
  const transactions = await prisma.transaction.findMany({
    where: { importBatchId: { not: null } },
    include: { importBatch: true },
    orderBy: [{ importBatchId: "asc" }, { date: "asc" }, { id: "asc" }],
  });

  let alreadyClassified = 0;
  let updated = 0;
  let unresolved = 0;
  const strategyCounts = new Map<string, number>();
  const unresolvedBatches = new Map<
    string,
    { filename: string; transactionCount: number }
  >();

  for (const transaction of transactions) {
    if (hasSourceFilename(transaction.metadata)) {
      alreadyClassified += 1;
      continue;
    }

    const importSource = inferImportSourceFilename({
      batchFilename: transaction.importBatch?.filename,
      transactionDate: transaction.date,
      metadata: transaction.metadata,
    });

    if (!importSource) {
      unresolved += 1;
      const key = transaction.importBatchId || "unknown";
      const current = unresolvedBatches.get(key) || {
        filename: transaction.importBatch?.filename || "Unknown import batch",
        transactionCount: 0,
      };
      current.transactionCount += 1;
      unresolvedBatches.set(key, current);
      continue;
    }

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        metadata: {
          ...toMetadataObject(transaction.metadata),
          sourceFilename: importSource.filename,
        } as Prisma.InputJsonValue,
      },
    });
    updated += 1;
    strategyCounts.set(
      importSource.strategy,
      (strategyCounts.get(importSource.strategy) || 0) + 1,
    );
  }

  console.log("Import source filename backfill complete");
  console.log(`Transactions scanned: ${transactions.length}`);
  console.log(`Already classified: ${alreadyClassified}`);
  console.log(`Updated: ${updated}`);
  console.log(`Unresolved: ${unresolved}`);
  console.log("Updated by strategy:");
  for (const [strategy, count] of strategyCounts.entries()) {
    console.log(`  ${strategy}: ${count}`);
  }
  if (unresolvedBatches.size > 0) {
    console.log("Unresolved batches:");
    for (const [batchId, batch] of unresolvedBatches.entries()) {
      console.log(`  ${batchId}: ${batch.transactionCount} - ${batch.filename}`);
    }
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
