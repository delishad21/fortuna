import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { TripRepository } from "./trips.repository";

async function seed(db: PrismaClient) {
  const user = await db.user.create({ data: { username: `trips-${Date.now()}-${Math.random()}` } });
  const food = await db.category.create({ data: { userId: user.id, name: "Food", color: "#f00" } });
  const trip = await TripRepository.createTrip(user.id, {
    name: "Japan",
    baseCurrency: "SGD",
    startDate: new Date("2026-09-01"),
  });
  const wallet = (name: string, currency: string) =>
    TripRepository.createWallet(user.id, trip.id, { name, currency });
  const fund = (walletId: string, sgd: number, local: number, currency = "USD") =>
    TripRepository.createFunding(user.id, {
      tripId: trip.id,
      walletId,
      sourceType: "manual",
      sourceCurrency: "SGD",
      sourceAmount: sgd,
      destinationCurrency: currency,
      destinationAmount: local,
    });
  const spend = (walletId: string, local: number, extra: Record<string, unknown> = {}) =>
    TripRepository.createTripEntry(user.id, trip.id, {
      walletId,
      type: "spending",
      date: new Date("2026-09-02"),
      description: "Dinner",
      categoryId: food.id,
      localCurrency: "USD",
      localAmount: local,
      ...extra,
    } as never);
  const entry = (id: string) => db.tripEntry.findUniqueOrThrow({ where: { id } });
  return { user, food, trip, wallet, fund, spend, entry };
}

const entryIdOf = (created: unknown) => {
  const value = created as { entry?: { id: string }; id?: string };
  return (value.entry?.id ?? value.id) as string;
};

test("wallet recalculation keeps hand-set values and re-caps reimbursements", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, wallet, fund, spend, entry } = await seed(db);
      const usd = await wallet("Revolut", "USD");
      await fund(usd.id, 135, 100);

      const derived = entryIdOf(await spend(usd.id, 100));
      const locked = entryIdOf(await spend(usd.id, 10, { baseAmount: 20 }));
      assert.equal(Number((await entry(derived)).baseAmount), 135);

      const refund = entryIdOf(
        await TripRepository.createTripEntry(user.id, trip.id, {
          walletId: usd.id,
          type: "reimbursement",
          date: new Date("2026-09-03"),
          description: "Alex paid me back",
          localCurrency: "USD",
          localAmount: 100,
        } as never),
      );
      await TripRepository.createTripReimbursementLink(user.id, trip.id, refund, [
        { transactionId: derived, amountBase: 135 },
      ]);

      // A cheaper top-up moves the wallet rate from 1.35 to 1.30.
      await fund(usd.id, 125, 100);
      const [derivedAfter, lockedAfter, refundAfter] = await Promise.all([
        entry(derived),
        entry(locked),
        entry(refund),
      ]);
      assert.equal(Number(derivedAfter.baseAmount), 130);
      assert.equal(Number(lockedAfter.baseAmount), 20, "hand-set base survives");
      assert.equal(Number(refundAfter.baseAmount), 130, "reimbursement uses the same rate");

      const [allocation] = await db.tripReimbursementAllocation.findMany({ where: { reimbursementEntryId: refund } });
      assert.equal(Number(allocation.amountBase), 130, "allocation never exceeds the spend");
      assert.equal((derivedAfter.metadata as any).linkage.reimbursedByAllocations[0].amountBase, 130);

      const analytics = await TripRepository.getTripAnalytics(user.id, trip.id);
      assert.equal(analytics.totals.totalReimbursed, 130);
    }),
  ));

test("opening balances take the wallet average and conversions are not funding", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, wallet, fund } = await seed(db);
      const usd = await wallet("Revolut", "USD");
      const jpy = await wallet("Revolut JPY", "JPY");
      await fund(usd.id, 270, 200);
      const opening = await db.tripFunding.create({
        data: {
          tripId: trip.id,
          walletId: usd.id,
          sourceType: "opening_balance",
          sourceCurrency: "USD",
          sourceAmount: 100,
          destinationCurrency: "USD",
          destinationAmount: 100,
          fxRate: 1,
          metadata: { valuation: "wallet_average" },
        },
      });
      await TripRepository.recalculateWalletEntriesToBase(user.id, trip.id, usd.id, { mode: "weighted" });
      const openingAfter = await db.tripFunding.findUniqueOrThrow({ where: { id: opening.id } });
      assert.equal(Number(openingAfter.baseAmount), 135, "valued at the 1.35 average, not as 100 SGD");

      // Convert 100 USD into JPY inside the trip.
      await TripRepository.createTripEntry(user.id, trip.id, {
        walletId: usd.id,
        type: "funding_out",
        date: new Date("2026-09-04"),
        description: "USD to JPY",
        localCurrency: "USD",
        localAmount: 100,
        fundingOut: {
          destinationType: "wallet",
          destinationWalletId: jpy.id,
          destinationCurrency: "JPY",
          destinationAmount: 15000,
        },
      } as never);

      const { totals } = await TripRepository.getTripAnalytics(user.id, trip.id);
      assert.equal(totals.totalFundingIn, 270 + 135, "the conversion is not new money");
      assert.equal(totals.totalFundingOut, 0);
    }),
  ));

test("deleting one half of a conversion deletes the other, and funding goes with its entry", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, wallet, fund } = await seed(db);
      const usd = await wallet("Revolut", "USD");
      const jpy = await wallet("Revolut JPY", "JPY");
      const funded = await fund(usd.id, 135, 100);
      await TripRepository.createTripEntry(user.id, trip.id, {
        walletId: usd.id,
        type: "funding_out",
        date: new Date("2026-09-04"),
        description: "USD to JPY",
        localCurrency: "USD",
        localAmount: 50,
        fundingOut: {
          destinationType: "wallet",
          destinationWalletId: jpy.id,
          destinationCurrency: "JPY",
          destinationAmount: 7500,
        },
      } as never);
      const conversionIn = await db.tripFunding.findFirstOrThrow({
        where: { tripId: trip.id, walletId: jpy.id },
      });
      await TripRepository.bulkDeleteEntriesByIds(user.id, trip.id, [conversionIn.entryId as string]);
      assert.equal(await db.tripEntry.count({ where: { tripId: trip.id, type: "funding_out" } }), 0);
      assert.equal(await db.tripFunding.count({ where: { tripId: trip.id, walletId: jpy.id } }), 0);

      const fundingEntry = await db.tripFunding.findUniqueOrThrow({ where: { id: funded.funding.id } });
      await TripRepository.bulkDeleteEntriesByIds(user.id, trip.id, [fundingEntry.entryId as string]);
      assert.equal(await db.tripFunding.count({ where: { id: funded.funding.id } }), 0);
    }),
  ));

test("a bank transaction can back only one trip record", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, wallet } = await seed(db);
      const other = await TripRepository.createTrip(user.id, {
        name: "Korea",
        baseCurrency: "SGD",
        startDate: new Date("2026-09-10"),
      });
      const usd = await wallet("Revolut", "USD");
      const krw = await TripRepository.createWallet(user.id, other.id, { name: "Revolut", currency: "KRW" });
      const topUp = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-01"), description: "Top up", amountOut: 135, accountIdentifier: "DBS" },
      });
      await TripRepository.createFunding(user.id, {
        tripId: trip.id,
        walletId: usd.id,
        bankTransactionId: topUp.id,
        sourceType: "bank_wallet_topup",
        sourceCurrency: "SGD",
        sourceAmount: 135,
        destinationCurrency: "USD",
        destinationAmount: 100,
      });
      await assert.rejects(
        TripRepository.createFunding(user.id, {
          tripId: other.id,
          walletId: krw.id,
          bankTransactionId: topUp.id,
          sourceType: "bank_wallet_topup",
          sourceCurrency: "SGD",
          sourceAmount: 135,
          destinationCurrency: "KRW",
          destinationAmount: 130000,
        }),
        /already part of the trip "Japan"/,
      );
    }),
  ));

test("base currency is fixed once a trip has activity, and end dates follow start dates", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, wallet, fund } = await seed(db);
      await TripRepository.updateTrip(user.id, trip.id, { baseCurrency: "USD" });
      await TripRepository.updateTrip(user.id, trip.id, { baseCurrency: "SGD" });
      const usd = await wallet("Revolut", "USD");
      await fund(usd.id, 135, 100);
      await assert.rejects(
        TripRepository.updateTrip(user.id, trip.id, { baseCurrency: "USD" }),
        /can't change/,
      );
      await assert.rejects(
        TripRepository.updateTrip(user.id, trip.id, { endDate: new Date("2026-08-01") }),
        /end date/,
      );
    }),
  ));

test("syncing a trip reimbursement links the bank credit and unlinking restores it", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, food } = await seed(db);
      const dinner = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-02"), description: "Dinner", amountOut: 300, accountIdentifier: "DBS", categoryId: food.id },
      });
      const payback = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-05"), description: "PayNow from Alex", amountIn: 150, accountIdentifier: "DBS", categoryId: food.id },
      });
      await TripRepository.addEntriesFromSourceTransactions(user.id, trip.id, {
        transactionIds: [dinner.id],
        entryType: "spending",
        categoryId: food.id,
      });
      await TripRepository.addEntriesFromSourceTransactions(user.id, trip.id, {
        transactionIds: [payback.id],
        entryType: "reimbursement",
      });
      const spendEntry = await db.tripEntry.findFirstOrThrow({ where: { sourceTransactionId: dinner.id } });
      const refundEntry = await db.tripEntry.findFirstOrThrow({ where: { sourceTransactionId: payback.id } });

      await TripRepository.createTripReimbursementLink(
        user.id,
        trip.id,
        refundEntry.id,
        [{ transactionId: spendEntry.id, amountBase: 150 }],
        null,
        undefined,
        { syncToBankLedger: true },
      );
      const link = await db.reimbursementLink.findFirstOrThrow({ where: { reimbursementTransactionId: payback.id } });
      assert.equal(link.expenseTransactionId, dinner.id);
      assert.equal(Number(link.amount), 150);
      const synced = await db.transaction.findUniqueOrThrow({ where: { id: payback.id } });
      assert.equal((synced.linkage as any).detectionReason, "trip_sync");
      assert.equal((synced.linkage as any).leftoverAmount, 0);

      await TripRepository.clearTripEntryLinkage(user.id, trip.id, refundEntry.id);
      const released = await db.transaction.findUniqueOrThrow({ where: { id: payback.id } });
      assert.equal(released.linkage, null);
      assert.equal(released.categoryId, food.id, "the original category is back");
      assert.equal(await db.reimbursementLink.count({ where: { reimbursementTransactionId: payback.id } }), 0);
    }),
  ));

test("a rate change in the sending wallet reaches the next trip's funding and totals", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, wallet, fund } = await seed(db);
      const usd = await wallet("Revolut", "USD");
      await fund(usd.id, 1350, 1000);
      const next = await TripRepository.createTrip(user.id, {
        name: "USA",
        baseCurrency: "SGD",
        startDate: new Date("2026-10-01"),
      });
      const nextUsd = await TripRepository.createWallet(user.id, next.id, { name: "Revolut", currency: "USD" });
      await TripRepository.createTripEntry(user.id, trip.id, {
        walletId: usd.id,
        type: "funding_out",
        date: new Date("2026-09-30"),
        description: "Leftover to the USA trip",
        localCurrency: "USD",
        localAmount: 500,
        fundingOut: {
          destinationType: "trip",
          destinationTripId: next.id,
          destinationWalletId: nextUsd.id,
          destinationCurrency: "USD",
          destinationAmount: 500,
        },
      } as never);
      const received = await db.tripFunding.findFirstOrThrow({ where: { tripId: next.id } });
      assert.equal(received.walletId, nextUsd.id, "lands in the chosen wallet");
      assert.equal(Number(received.baseAmount), 675);

      // A cheaper top-up in the first trip lowers its USD cost to 1.30.
      await fund(usd.id, 1250, 1000);
      const receivedAfter = await db.tripFunding.findUniqueOrThrow({ where: { id: received.id } });
      const receivedEntry = await db.tripEntry.findUniqueOrThrow({ where: { id: receivedAfter.entryId as string } });
      assert.equal(Number(receivedAfter.baseAmount), 650);
      assert.equal(Number(receivedEntry.baseAmount), 650, "the funding entry follows its funding");
      const { totals } = await TripRepository.getTripAnalytics(user.id, next.id);
      assert.equal(totals.totalFundingIn, 650);
    }),
  ));

test("deleting or re-pricing a bank transaction reaches the trip", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, food, wallet } = await seed(db);
      const { TransactionService } = await import("../transactions/transactions.service");
      const usd = await wallet("Revolut", "USD");
      const topUp = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-01"), description: "Top up", amountOut: 135, accountIdentifier: "DBS" },
      });
      const hotel = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-02"), description: "Hotel", amountOut: 300, accountIdentifier: "DBS", categoryId: food.id },
      });
      const funded = await TripRepository.createFunding(user.id, {
        tripId: trip.id,
        walletId: usd.id,
        bankTransactionId: topUp.id,
        sourceType: "bank_wallet_topup",
        sourceCurrency: "SGD",
        sourceAmount: 135,
        destinationCurrency: "USD",
        destinationAmount: 100,
      });
      await TripRepository.addEntriesFromSourceTransactions(user.id, trip.id, {
        transactionIds: [hotel.id],
        entryType: "spending",
        categoryId: food.id,
      });

      await TransactionService.updateTransaction(hotel.id, user.id, { amountOut: 280 });
      const hotelEntry = await db.tripEntry.findFirstOrThrow({ where: { sourceTransactionId: hotel.id } });
      assert.equal(Number(hotelEntry.baseAmount), 280, "the trip follows the corrected bank amount");

      await TransactionService.deleteTransaction(topUp.id, user.id);
      const funding = await db.tripFunding.findUniqueOrThrow({ where: { id: funded.funding.id } });
      assert.equal(funding.bankTransactionId, null);
      assert.equal((funding.metadata as any).matchReviewState, "pending_review");
      assert.equal((funding.metadata as any).detachedBankTransaction.reason, "deleted");
    }),
  ));

test("re-importing a statement skips rows already imported but keeps repeats within it", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, wallet, fund } = await seed(db);
      const usd = await wallet("Revolut", "USD");
      await fund(usd.id, 135, 100);
      const usdRate = { currency: "USD", fxRate: 1.35, fxBaseCurrency: "USD", fxQuoteCurrency: "SGD" };
      const coffee = { date: "2026-09-03", description: "Coffee", amountOut: 5, metadata: usdRate };
      const first = await TripRepository.importTripSpendings(user.id, trip.id, usd.id, "manual_csv", [
        { ...coffee, metadata: { ...usdRate } },
        { ...coffee, metadata: { ...usdRate } },
      ] as never);
      assert.equal(first.importedSpendings, 2, "two identical coffees in one statement");
      const second = await TripRepository.importTripSpendings(user.id, trip.id, usd.id, "manual_csv", [
        { ...coffee, metadata: { ...usdRate } },
        { ...coffee, metadata: { ...usdRate } },
        { ...coffee, description: "Lunch", amountOut: 12, metadata: { ...usdRate } },
      ] as never);
      assert.equal(second.skippedDuplicates, 2);
      assert.equal(second.importedSpendings, 1);
      assert.equal(await db.tripEntry.count({ where: { tripId: trip.id, type: "spending" } }), 3);
    }),
  ));

test("bank rows assigned to a trip in a staged import become trip entries on commit", () =>
  withChatDb((db) =>
    withDatabase(db, async () => {
      const { user, trip, food } = await seed(db);
      const { applyTripAssignments } = await import("../imports/hermes-workflow.service");
      const { runInTransaction } = await import("../reimbursements/links.service");
      const dinner = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-02"), description: "Dinner", amountOut: 80, accountIdentifier: "DBS" },
      });
      const unrelated = await db.transaction.create({
        data: { userId: user.id, date: new Date("2026-09-02"), description: "Rent", amountOut: 2000, accountIdentifier: "DBS" },
      });
      const result = await runInTransaction((tx) =>
        applyTripAssignments(
          tx,
          user.id,
          [
            { tripId: trip.id, entryType: "spending", amountOut: 80, categoryId: food.id },
            { amountOut: 2000 },
          ],
          [dinner.id, unrelated.id],
        ),
      );
      assert.equal(result.applied.length, 1);
      const entry = await db.tripEntry.findFirstOrThrow({ where: { sourceTransactionId: dinner.id } });
      assert.equal(entry.tripId, trip.id);
      assert.equal(entry.categoryId, food.id);
    }),
  ));
