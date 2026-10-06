import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

type Db = Prisma.TransactionClient | typeof prisma;

const roundMoney = (value: number) => Number(value.toFixed(4));

/**
 * IOUs: spending someone else paid for me (a `spending` entry with source_type `iou`,
 * no wallet, and a counterparty), settled later by `settlement` entries paid to that
 * person. A settlement's base value is split across the IOUs it pays off; an IOU's
 * cost is what was settled plus the unsettled rest at its estimate rate.
 */
export class TripIouRepository {
  static async assertTripOwned(db: Db, userId: string, tripId: string) {
    const [trip] = await db.$queryRaw<Array<{ id: string; baseCurrency: string }>>`
      SELECT id, base_currency AS "baseCurrency" FROM trips WHERE id = ${tripId} AND user_id = ${userId} LIMIT 1
    `;
    if (!trip) throw new Error("Trip not found or unauthorized");
    return trip;
  }

  static async assertParticipant(db: Db, tripId: string, participantId: string) {
    const [participant] = await db.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM trip_participants WHERE id = ${participantId} AND trip_id = ${tripId} LIMIT 1
    `;
    if (!participant) throw new Error("That person isn't part of this trip.");
    return participant;
  }

  static async listParticipants(userId: string, tripId: string) {
    await TripIouRepository.assertTripOwned(prisma, userId, tripId);
    return prisma.$queryRaw<Array<{ id: string; name: string; userId: string | null }>>`
      SELECT id, name, user_id AS "userId" FROM trip_participants WHERE trip_id = ${tripId} ORDER BY name ASC
    `;
  }

  static async createParticipant(userId: string, tripId: string, name: string) {
    await TripIouRepository.assertTripOwned(prisma, userId, tripId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A person needs a name.");
    const [created] = await prisma.$queryRaw<Array<{ id: string; name: string; userId: string | null }>>`
      INSERT INTO trip_participants (id, trip_id, name, created_at)
      VALUES (${randomUUID()}, ${tripId}, ${trimmed}, NOW())
      ON CONFLICT (trip_id, name) DO NOTHING
      RETURNING id, name, user_id AS "userId"
    `;
    if (!created) throw Object.assign(new Error(`${trimmed} is already on this trip.`), { status: 409 });
    return created;
  }

  static async renameParticipant(userId: string, tripId: string, participantId: string, name: string) {
    await TripIouRepository.assertTripOwned(prisma, userId, tripId);
    await TripIouRepository.assertParticipant(prisma, tripId, participantId);
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A person needs a name.");
    const [updated] = await prisma.$queryRaw<Array<{ id: string; name: string; userId: string | null }>>`
      UPDATE trip_participants SET name = ${trimmed}
      WHERE id = ${participantId} AND trip_id = ${tripId}
        AND NOT EXISTS (
          SELECT 1 FROM trip_participants other
          WHERE other.trip_id = ${tripId} AND other.name = ${trimmed} AND other.id <> ${participantId}
        )
      RETURNING id, name, user_id AS "userId"
    `;
    if (!updated) throw Object.assign(new Error(`${trimmed} is already on this trip.`), { status: 409 });
    return updated;
  }

  static async deleteParticipant(userId: string, tripId: string, participantId: string) {
    await TripIouRepository.assertTripOwned(prisma, userId, tripId);
    const participant = await TripIouRepository.assertParticipant(prisma, tripId, participantId);
    const [usage] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM trip_entries WHERE counterparty_id = ${participantId}
    `;
    if (usage.count > 0) {
      throw Object.assign(
        new Error(`${participant.name} still has ${usage.count} IOU or settlement entries.`),
        { status: 409 },
      );
    }
    await prisma.$executeRaw`DELETE FROM trip_participants WHERE id = ${participantId} AND trip_id = ${tripId}`;
    return { success: true };
  }

  /**
   * Sets which IOUs a settlement pays off. Without `items`, it clears everything still
   * owed to that person. Returns the IOUs whose cost changed.
   */
  static async allocateSettlementTx(
    tx: Prisma.TransactionClient,
    tripId: string,
    settlementId: string,
    items?: Array<{ iouEntryId: string; localAmount: number }>,
  ) {
    const [settlement] = await tx.$queryRaw<
      Array<{ id: string; type: string; counterpartyId: string | null; baseAmount: unknown }>
    >`
      SELECT id, type, counterparty_id AS "counterpartyId", base_amount AS "baseAmount"
      FROM trip_entries WHERE id = ${settlementId} AND trip_id = ${tripId}
      FOR UPDATE
    `;
    if (!settlement || settlement.type !== "settlement") throw new Error("Settlement not found.");
    if (!settlement.counterpartyId) throw new Error("A settlement needs the person it paid.");

    const previous = await tx.$queryRaw<Array<{ iouEntryId: string }>>`
      DELETE FROM trip_settlement_allocations
      WHERE settlement_entry_id = ${settlementId}
      RETURNING iou_entry_id AS "iouEntryId"
    `;
    const open = await TripIouRepository.openIousTx(tx, tripId, settlement.counterpartyId);
    const settlementBase = Number(settlement.baseAmount || 0);

    let chosen: Array<{ iouEntryId: string; localAmount: number; estimateRate: number }>;
    if (items) {
      chosen = items
        .filter((item) => item.localAmount > 0)
        .map((item) => {
          const iou = open.find((row) => row.id === item.iouEntryId);
          if (!iou) throw new Error("That IOU isn't open, or belongs to someone else.");
          if (item.localAmount - iou.remainingLocal > 0.0001) {
            throw new Error(`Only ${roundMoney(iou.remainingLocal)} ${iou.localCurrency} of "${iou.description}" is still owed.`);
          }
          return { iouEntryId: iou.id, localAmount: item.localAmount, estimateRate: iou.estimateRate };
        });
    } else {
      // Paying someone back usually clears what you owe them, at whatever the real rate
      // turned out to be; a partial payment is set explicitly with `items`.
      chosen = open.map((iou) => ({
        iouEntryId: iou.id,
        localAmount: roundMoney(iou.remainingLocal),
        estimateRate: iou.estimateRate,
      }));
    }

    await TripIouRepository.writeAllocationsTx(tx, tripId, settlementId, settlementBase, chosen);
    const touched = new Set([...previous.map((row) => row.iouEntryId), ...chosen.map((row) => row.iouEntryId)]);
    await TripIouRepository.recomputeIouCostsTx(tx, tripId, [...touched]);
    return [...touched];
  }

  /** A settlement's value changed (e.g. its wallet's rate): re-split it over the same IOUs. */
  static async reallocateSettlementsTx(tx: Prisma.TransactionClient, tripId: string, settlementIds: string[]) {
    if (!settlementIds.length) return [] as string[];
    const settlements = await tx.$queryRaw<Array<{ id: string; baseAmount: unknown }>>`
      SELECT id, base_amount AS "baseAmount" FROM trip_entries
      WHERE trip_id = ${tripId} AND type = 'settlement' AND id = ANY(${settlementIds})
    `;
    const touched = new Set<string>();
    for (const settlement of settlements) {
      const rows = await tx.$queryRaw<Array<{ iouEntryId: string; iouLocalAmount: unknown; estimateRate: unknown }>>`
        SELECT a.iou_entry_id AS "iouEntryId", a.iou_local_amount AS "iouLocalAmount",
          COALESCE((te.metadata->'iou'->>'estimateFxRate')::numeric, 1) AS "estimateRate"
        FROM trip_settlement_allocations a
        INNER JOIN trip_entries te ON te.id = a.iou_entry_id
        WHERE a.settlement_entry_id = ${settlement.id}
      `;
      await tx.$executeRaw`DELETE FROM trip_settlement_allocations WHERE settlement_entry_id = ${settlement.id}`;
      const chosen = rows.map((row) => ({
        iouEntryId: row.iouEntryId,
        localAmount: Number(row.iouLocalAmount),
        estimateRate: Number(row.estimateRate),
      }));
      await TripIouRepository.writeAllocationsTx(tx, tripId, settlement.id, Number(settlement.baseAmount || 0), chosen);
      chosen.forEach((row) => touched.add(row.iouEntryId));
    }
    await TripIouRepository.recomputeIouCostsTx(tx, tripId, [...touched]);
    return [...touched];
  }

  /** Settlement and IOU entries linked to any of `entryIds`, for cleanup after deletes. */
  static async linkedIouIdsTx(tx: Prisma.TransactionClient, tripId: string, entryIds: string[]) {
    if (!entryIds.length) return [] as string[];
    const rows = await tx.$queryRaw<Array<{ iouEntryId: string }>>`
      SELECT DISTINCT iou_entry_id AS "iouEntryId" FROM trip_settlement_allocations
      WHERE trip_id = ${tripId} AND settlement_entry_id = ANY(${entryIds})
    `;
    return rows.map((row) => row.iouEntryId);
  }

  /**
   * An IOU costs what was paid to settle it, plus the unsettled rest at its estimate.
   */
  static async recomputeIouCostsTx(tx: Prisma.TransactionClient, tripId: string, iouIds: string[]) {
    if (!iouIds.length) return;
    await tx.$executeRaw`
      UPDATE trip_entries te
      SET
        base_amount = ROUND(settled.base + (te.local_amount - settled.local) * COALESCE((te.metadata->'iou'->>'estimateFxRate')::numeric, te.fx_rate), 4),
        fx_rate = CASE WHEN te.local_amount > 0 THEN
          ROUND((settled.base + (te.local_amount - settled.local) * COALESCE((te.metadata->'iou'->>'estimateFxRate')::numeric, te.fx_rate)) / te.local_amount, 10)
          ELSE te.fx_rate END
      FROM (
        SELECT ious.id,
          COALESCE(SUM(a.amount_base), 0) AS base,
          COALESCE(SUM(a.iou_local_amount), 0) AS local
        FROM trip_entries ious
        LEFT JOIN trip_settlement_allocations a ON a.iou_entry_id = ious.id
        WHERE ious.trip_id = ${tripId} AND ious.id = ANY(${iouIds})
        GROUP BY ious.id
      ) settled
      WHERE te.id = settled.id AND te.source_type = 'iou'
    `;
  }

  private static async openIousTx(tx: Prisma.TransactionClient, tripId: string, counterpartyId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; description: string; localCurrency: string; localAmount: unknown; settledLocal: unknown; estimateRate: unknown }>
    >`
      SELECT
        te.id, te.description, te.local_currency AS "localCurrency", te.local_amount AS "localAmount",
        COALESCE(SUM(a.iou_local_amount), 0) AS "settledLocal",
        COALESCE((te.metadata->'iou'->>'estimateFxRate')::numeric, te.fx_rate) AS "estimateRate"
      FROM trip_entries te
      LEFT JOIN trip_settlement_allocations a ON a.iou_entry_id = te.id
      WHERE te.trip_id = ${tripId} AND te.source_type = 'iou' AND te.counterparty_id = ${counterpartyId}
      GROUP BY te.id
      ORDER BY te.transaction_date ASC, te.created_at ASC
    `;
    return rows
      .map((row) => ({
        id: row.id,
        description: row.description,
        localCurrency: row.localCurrency,
        estimateRate: Number(row.estimateRate || 0),
        remainingLocal: Number(row.localAmount) - Number(row.settledLocal),
      }))
      .filter((row) => row.remainingLocal > 0.0001);
  }

  private static async writeAllocationsTx(
    tx: Prisma.TransactionClient,
    tripId: string,
    settlementId: string,
    settlementBase: number,
    chosen: Array<{ iouEntryId: string; localAmount: number; estimateRate: number }>,
  ) {
    const weights = chosen.map((row) => roundMoney(row.localAmount * row.estimateRate));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let assigned = 0;
    for (const [index, row] of chosen.entries()) {
      const isLast = index === chosen.length - 1;
      const amountBase = isLast
        ? roundMoney(settlementBase - assigned)
        : roundMoney(totalWeight > 0 ? (settlementBase * weights[index]) / totalWeight : 0);
      assigned += amountBase;
      await tx.$executeRaw`
        INSERT INTO trip_settlement_allocations
          (id, trip_id, settlement_entry_id, iou_entry_id, iou_local_amount, weight_base, amount_base, created_at)
        VALUES
          (${randomUUID()}, ${tripId}, ${settlementId}, ${row.iouEntryId}, ${roundMoney(row.localAmount)}, ${weights[index]}, ${amountBase}, NOW())
      `;
    }
  }

  /** What I owe each person on the trip: IOUs, what's settled, and what's still open. */
  static async getBalances(userId: string, tripId: string) {
    const trip = await TripIouRepository.assertTripOwned(prisma, userId, tripId);
    const rows = await prisma.$queryRaw<
      Array<{
        participantId: string;
        name: string;
        currency: string | null;
        owedLocal: unknown;
        settledLocal: unknown;
        openBase: unknown;
        paidBase: unknown;
      }>
    >`
      SELECT
        p.id AS "participantId",
        p.name,
        ious.local_currency AS currency,
        COALESCE(SUM(ious.local_amount), 0) AS "owedLocal",
        COALESCE(SUM(settled.local), 0) AS "settledLocal",
        COALESCE(SUM((ious.local_amount - COALESCE(settled.local, 0))
          * COALESCE((ious.metadata->'iou'->>'estimateFxRate')::numeric, ious.fx_rate)), 0) AS "openBase",
        (SELECT COALESCE(SUM(s.base_amount), 0) FROM trip_entries s
          WHERE s.trip_id = ${tripId} AND s.type = 'settlement' AND s.counterparty_id = p.id) AS "paidBase"
      FROM trip_participants p
      LEFT JOIN trip_entries ious ON ious.counterparty_id = p.id AND ious.source_type = 'iou'
      LEFT JOIN (
        SELECT iou_entry_id, SUM(iou_local_amount) AS local
        FROM trip_settlement_allocations WHERE trip_id = ${tripId}
        GROUP BY iou_entry_id
      ) settled ON settled.iou_entry_id = ious.id
      WHERE p.trip_id = ${tripId}
      GROUP BY p.id, p.name, ious.local_currency
      ORDER BY p.name ASC
    `;
    const people = new Map<
      string,
      {
        participantId: string;
        name: string;
        paidBase: number;
        openBase: number;
        currencies: Array<{ currency: string; owed: number; settled: number; open: number }>;
      }
    >();
    for (const row of rows) {
      const person = people.get(row.participantId) || {
        participantId: row.participantId,
        name: row.name,
        paidBase: roundMoney(Number(row.paidBase || 0)),
        openBase: 0,
        currencies: [],
      };
      if (row.currency) {
        const owed = roundMoney(Number(row.owedLocal || 0));
        const settled = roundMoney(Number(row.settledLocal || 0));
        person.currencies.push({ currency: row.currency, owed, settled, open: roundMoney(owed - settled) });
        person.openBase = roundMoney(person.openBase + Number(row.openBase || 0));
      }
      people.set(row.participantId, person);
    }
    return { baseCurrency: trip.baseCurrency, people: [...people.values()] };
  }
}
