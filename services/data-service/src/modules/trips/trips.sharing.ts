import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { TripIouRepository } from "./trips.ious";

type Db = Prisma.TransactionClient | typeof prisma;
type Role = "owner" | "editor" | "viewer";

const roundMoney = (value: number) => Number(value.toFixed(4));
const SHARED_TRIP_FIELDS = ["name", "coverImageUrl", "startDate", "endDate", "status"] as const;

/**
 * Shared trips. A group links one Trip per member: each member's wallets, funding and
 * entries stay in their own trip, so every per-trip query keeps working unchanged and
 * nobody reads another member's ledger. The group adds membership, the shared trip
 * details, combined read-only views, and shares (which become IOUs in the other
 * member's trip).
 */
export class TripSharingRepository {
  /** The caller's active membership for one of their trips, or null for a personal trip. */
  static async membershipOf(db: Db, userId: string, tripId: string) {
    const [row] = await db.$queryRaw<
      Array<{ groupId: string; role: Role; ownerUserId: string; memberId: string }>
    >`
      SELECT m.group_id AS "groupId", m.role, g.owner_user_id AS "ownerUserId", m.id AS "memberId"
      FROM trip_members m
      INNER JOIN trip_groups g ON g.id = m.group_id
      INNER JOIN trips t ON t.id = m.trip_id
      WHERE m.trip_id = ${tripId} AND m.user_id = ${userId} AND m.status = 'active' AND t.user_id = ${userId}
      LIMIT 1
    `;
    return row ?? null;
  }

  private static async requireMembership(db: Db, userId: string, tripId: string) {
    const membership = await TripSharingRepository.membershipOf(db, userId, tripId);
    if (!membership) throw new Error("This trip isn't shared.");
    return membership;
  }

  private static async requireOwnTrip(db: Db, userId: string, tripId: string) {
    const [trip] = await db.$queryRaw<
      Array<{ id: string; name: string; coverImageUrl: string | null; baseCurrency: string; startDate: Date; endDate: Date | null; status: string; groupId: string | null }>
    >`
      SELECT id, name, cover_image_url AS "coverImageUrl", base_currency AS "baseCurrency",
        start_date AS "startDate", end_date AS "endDate", status, group_id AS "groupId"
      FROM trips WHERE id = ${tripId} AND user_id = ${userId} LIMIT 1
    `;
    if (!trip) throw new Error("Trip not found or unauthorized");
    return trip;
  }

  /** Invites an existing user (by username or email) to share one of the caller's trips. */
  static async invite(userId: string, tripId: string, input: { usernameOrEmail: string; role: "editor" | "viewer" }) {
    const trip = await TripSharingRepository.requireOwnTrip(prisma, userId, tripId);
    const handle = input.usernameOrEmail.trim();
    const invitee = await prisma.user.findFirst({
      where: { OR: [{ username: handle }, { email: { equals: handle, mode: "insensitive" } }] },
      select: { id: true },
    });
    if (!invitee) throw new Error("No Fortuna user has that username or email.");
    if (invitee.id === userId) throw new Error("You're already on this trip.");

    return prisma.$transaction(async (tx) => {
      let groupId = trip.groupId;
      if (groupId) {
        const membership = await TripSharingRepository.requireMembership(tx, userId, tripId);
        if (membership.role !== "owner") throw new Error("Only the trip owner can invite people.");
      } else {
        groupId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO trip_groups (id, owner_user_id, created_at, updated_at)
          VALUES (${groupId}, ${userId}, NOW(), NOW())
        `;
        await tx.$executeRaw`
          INSERT INTO trip_members (id, group_id, user_id, trip_id, role, status, created_at, updated_at)
          VALUES (${randomUUID()}, ${groupId}, ${userId}, ${tripId}, 'owner', 'active', NOW(), NOW())
        `;
        await tx.$executeRaw`UPDATE trips SET group_id = ${groupId} WHERE id = ${tripId}`;
      }
      const [member] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        INSERT INTO trip_members (id, group_id, user_id, role, status, invited_by, created_at, updated_at)
        VALUES (${randomUUID()}, ${groupId}, ${invitee.id}, ${input.role}, 'invited', ${userId}, NOW(), NOW())
        ON CONFLICT (group_id, user_id) DO UPDATE
          SET role = EXCLUDED.role, status = 'invited', invited_by = EXCLUDED.invited_by, updated_at = NOW()
          WHERE trip_members.status = 'declined'
        RETURNING id, status
      `;
      if (!member) throw Object.assign(new Error("That person is already invited or on this trip."), { status: 409 });
      return { groupId, memberId: member.id };
    });
  }

  static async listInvitations(userId: string) {
    return prisma.$queryRaw<
      Array<{ memberId: string; role: string; tripName: string; startDate: Date; endDate: Date | null; invitedBy: string | null }>
    >`
      SELECT
        m.id AS "memberId", m.role, t.name AS "tripName", t.start_date AS "startDate", t.end_date AS "endDate",
        COALESCE(inviter.name, inviter.username) AS "invitedBy"
      FROM trip_members m
      INNER JOIN trip_groups g ON g.id = m.group_id
      INNER JOIN trip_members owner_member ON owner_member.group_id = g.id AND owner_member.role = 'owner'
      INNER JOIN trips t ON t.id = owner_member.trip_id
      LEFT JOIN users inviter ON inviter.id = m.invited_by
      WHERE m.user_id = ${userId} AND m.status = 'invited'
      ORDER BY m.created_at DESC
    `;
  }

  /** Accepting creates the member's own trip in the group, with the shared details. */
  static async acceptInvitation(userId: string, memberId: string) {
    return prisma.$transaction(async (tx) => {
      const [invite] = await tx.$queryRaw<
        Array<{ groupId: string; name: string; coverImageUrl: string | null; baseCurrency: string; startDate: Date; endDate: Date | null; status: string }>
      >`
        SELECT m.group_id AS "groupId", t.name, t.cover_image_url AS "coverImageUrl", t.base_currency AS "baseCurrency",
          t.start_date AS "startDate", t.end_date AS "endDate", t.status
        FROM trip_members m
        INNER JOIN trip_members owner_member ON owner_member.group_id = m.group_id AND owner_member.role = 'owner'
        INNER JOIN trips t ON t.id = owner_member.trip_id
        WHERE m.id = ${memberId} AND m.user_id = ${userId} AND m.status = 'invited'
        FOR UPDATE OF m
      `;
      if (!invite) throw new Error("Invitation not found.");
      const tripId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO trips (id, user_id, name, cover_image_url, base_currency, start_date, end_date, status, group_id, created_at, updated_at)
        VALUES (${tripId}, ${userId}, ${invite.name}, ${invite.coverImageUrl}, ${invite.baseCurrency},
          ${invite.startDate}, ${invite.endDate}, ${invite.status}, ${invite.groupId}, NOW(), NOW())
      `;
      await tx.$executeRaw`
        UPDATE trip_members SET status = 'active', trip_id = ${tripId}, updated_at = NOW() WHERE id = ${memberId}
      `;
      return { tripId };
    });
  }

  static async declineInvitation(userId: string, memberId: string) {
    const updated = await prisma.$executeRaw`
      UPDATE trip_members SET status = 'declined', updated_at = NOW()
      WHERE id = ${memberId} AND user_id = ${userId} AND status = 'invited'
    `;
    if (!updated) throw new Error("Invitation not found.");
    return { success: true };
  }

  static async listMembers(userId: string, tripId: string) {
    const membership = await TripSharingRepository.requireMembership(prisma, userId, tripId);
    return prisma.$queryRaw<
      Array<{ memberId: string; userId: string; name: string; role: string; status: string; isMe: boolean }>
    >`
      SELECT m.id AS "memberId", m.user_id AS "userId", COALESCE(u.name, u.username) AS name, m.role, m.status,
        (m.user_id = ${userId}) AS "isMe"
      FROM trip_members m
      INNER JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ${membership.groupId} AND m.status IN ('active', 'invited')
      ORDER BY (m.role = 'owner') DESC, name ASC
    `;
  }

  static async updateMemberRole(userId: string, tripId: string, memberUserId: string, role: "editor" | "viewer") {
    const membership = await TripSharingRepository.requireMembership(prisma, userId, tripId);
    if (membership.role !== "owner") throw new Error("Only the trip owner can change roles.");
    if (memberUserId === userId) throw new Error("The owner's role can't change.");
    const updated = await prisma.$executeRaw`
      UPDATE trip_members SET role = ${role}, updated_at = NOW()
      WHERE group_id = ${membership.groupId} AND user_id = ${memberUserId} AND role <> 'owner'
    `;
    if (!updated) throw new Error("That person isn't on this trip.");
    return { success: true };
  }

  /**
   * Takes a member out of the group. Their own trip stays theirs as a personal trip,
   * and shares between them and the remaining members are kept as plain IOUs.
   */
  static async detachMemberTx(tx: Prisma.TransactionClient, groupId: string, memberUserId: string) {
    const [member] = await tx.$queryRaw<Array<{ id: string; tripId: string | null }>>`
      DELETE FROM trip_members WHERE group_id = ${groupId} AND user_id = ${memberUserId}
      RETURNING id, trip_id AS "tripId"
    `;
    if (member?.tripId) await tx.$executeRaw`UPDATE trips SET group_id = NULL WHERE id = ${member.tripId}`;
    return member ?? null;
  }

  static async removeMember(userId: string, tripId: string, memberUserId: string) {
    const membership = await TripSharingRepository.requireMembership(prisma, userId, tripId);
    if (membership.role !== "owner") throw new Error("Only the trip owner can remove people.");
    if (memberUserId === userId) throw new Error("The owner can't be removed; delete the trip instead.");
    const removed = await prisma.$transaction((tx) =>
      TripSharingRepository.detachMemberTx(tx, membership.groupId, memberUserId),
    );
    if (!removed) throw new Error("That person isn't on this trip.");
    return { success: true };
  }

  static async leave(userId: string, tripId: string) {
    const membership = await TripSharingRepository.requireMembership(prisma, userId, tripId);
    if (membership.role === "owner") throw new Error("The owner can't leave; delete the trip or remove the others.");
    await prisma.$transaction((tx) => TripSharingRepository.detachMemberTx(tx, membership.groupId, userId));
    return { success: true, tripId };
  }

  /**
   * Called before a trip is deleted. The owner deleting a shared trip ends the group;
   * every other member keeps their own trip as a personal trip. Anyone else just leaves.
   */
  static async beforeTripDeleteTx(tx: Prisma.TransactionClient, userId: string, tripId: string) {
    const membership = await TripSharingRepository.membershipOf(tx, userId, tripId);
    if (!membership) return;
    if (membership.role === "owner") {
      await tx.$executeRaw`UPDATE trips SET group_id = NULL WHERE group_id = ${membership.groupId}`;
      await tx.$executeRaw`DELETE FROM trip_groups WHERE id = ${membership.groupId}`;
    } else {
      await TripSharingRepository.detachMemberTx(tx, membership.groupId, userId);
    }
  }

  /**
   * Shared details (name, cover, dates, status) belong to the owner; their edits reach
   * every member's trip. Returns false when the caller may not change them.
   */
  static async beforeTripUpdateTx(
    tx: Prisma.TransactionClient,
    userId: string,
    tripId: string,
    data: Partial<Record<(typeof SHARED_TRIP_FIELDS)[number], unknown>> & { baseCurrency?: string | null },
  ) {
    const membership = await TripSharingRepository.membershipOf(tx, userId, tripId);
    if (!membership) return null;
    const touchesShared = SHARED_TRIP_FIELDS.some((field) => data[field] !== undefined) || !!data.baseCurrency;
    if (!touchesShared) return null;
    if (membership.role !== "owner") {
      throw new Error("Only the trip owner can change the shared trip's details.");
    }
    if (data.baseCurrency) {
      const [activity] = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id WHERE t.group_id = ${membership.groupId}
      `;
      if (activity.count > 0) {
        throw new Error("The base currency can't change once anyone on the trip has transactions.");
      }
    }
    return membership.groupId;
  }

  static async syncSharedDetailsTx(tx: Prisma.TransactionClient, groupId: string, sourceTripId: string) {
    await tx.$executeRaw`
      UPDATE trips member_trip
      SET name = src.name, cover_image_url = src.cover_image_url, start_date = src.start_date,
        end_date = src.end_date, status = src.status, base_currency = src.base_currency, updated_at = NOW()
      FROM trips src
      WHERE src.id = ${sourceTripId} AND member_trip.group_id = ${groupId} AND member_trip.id <> src.id
    `;
  }

  /**
   * Splits one of my entries with other members. Each share becomes an IOU in that
   * member's trip, owed to me, valued at my entry's rate until they settle it.
   */
  static async setShares(
    userId: string,
    tripId: string,
    entryId: string,
    shares: Array<{ userId: string; localAmount: number }>,
  ) {
    const membership = await TripSharingRepository.requireMembership(prisma, userId, tripId);
    if (membership.role === "viewer") throw new Error("Viewers can't share costs on this trip.");
    const [entry] = await prisma.$queryRaw<
      Array<{ id: string; type: string; sourceType: string; description: string; label: string | null; date: Date; localCurrency: string; localAmount: unknown; fxRate: unknown }>
    >`
      SELECT id, type, source_type AS "sourceType", description, label, transaction_date AS date,
        local_currency AS "localCurrency", local_amount AS "localAmount", fx_rate AS "fxRate"
      FROM trip_entries WHERE id = ${entryId} AND trip_id = ${tripId}
    `;
    if (!entry || entry.type !== "spending" || entry.sourceType === "iou") {
      throw new Error("Only your own spending can be shared.");
    }
    const total = shares.reduce((sum, share) => sum + share.localAmount, 0);
    if (total - Number(entry.localAmount) > 0.0001) {
      throw new Error(`Shares add up to more than ${Number(entry.localAmount)} ${entry.localCurrency}.`);
    }
    const [me] = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT COALESCE(name, username) AS name FROM users WHERE id = ${userId}
    `;

    await prisma.$transaction(async (tx) => {
      const members = await tx.$queryRaw<Array<{ userId: string; tripId: string; role: string }>>`
        SELECT user_id AS "userId", trip_id AS "tripId", role FROM trip_members
        WHERE group_id = ${membership.groupId} AND status = 'active' AND trip_id IS NOT NULL
      `;
      const existing = await tx.$queryRaw<Array<{ id: string; tripId: string; userId: string }>>`
        SELECT te.id, te.trip_id AS "tripId", t.user_id AS "userId"
        FROM trip_entries te INNER JOIN trips t ON t.id = te.trip_id
        WHERE te.shared_from_entry_id = ${entryId}
      `;
      const wanted = new Set(shares.filter((share) => share.localAmount > 0).map((share) => share.userId));
      for (const old of existing) {
        if (!wanted.has(old.userId)) {
          await tx.$executeRaw`DELETE FROM trip_entries WHERE id = ${old.id}`;
        }
      }
      for (const share of shares) {
        if (!(share.localAmount > 0)) continue;
        if (share.userId === userId) throw new Error("Your own part stays on your entry.");
        const member = members.find((row) => row.userId === share.userId);
        if (!member) throw new Error("That person isn't on this trip.");
        if (member.role === "viewer") throw new Error("Viewers can't be given a share.");

        const [participant] = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO trip_participants (id, trip_id, name, user_id, created_at)
          VALUES (${randomUUID()}, ${member.tripId}, ${me.name}, ${userId}, NOW())
          ON CONFLICT (trip_id, user_id) DO UPDATE SET name = trip_participants.name
          RETURNING id
        `;
        const estimate = Number(entry.fxRate);
        const current = existing.find((row) => row.userId === share.userId);
        if (current) {
          await tx.$executeRaw`
            UPDATE trip_entries
            SET local_amount = ${share.localAmount},
              metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{iou}', ${JSON.stringify({ estimateFxRate: estimate })}::jsonb)
            WHERE id = ${current.id}
          `;
          await TripIouRepository.recomputeIouCostsTx(tx, member.tripId, [current.id]);
        } else {
          await tx.$executeRaw`
            INSERT INTO trip_entries (
              id, trip_id, wallet_id, source_type, type, transaction_date, description, label,
              local_currency, local_amount, fx_rate, base_amount, counterparty_id,
              shared_from_entry_id, created_by, metadata, created_at
            ) VALUES (
              ${randomUUID()}, ${member.tripId}, NULL, 'iou', 'spending', ${entry.date}, ${entry.description},
              ${entry.label}, ${entry.localCurrency}, ${share.localAmount}, ${estimate},
              ${roundMoney(share.localAmount * estimate)}, ${participant.id}, ${entryId}, ${userId},
              ${{ iou: { estimateFxRate: estimate }, sharedBy: me.name } as Prisma.InputJsonValue}, NOW()
            )
          `;
        }
      }
    });
    return TripSharingRepository.getOverview(userId, tripId);
  }

  /**
   * What every member sees: members, combined and per-member totals, settle-up, and each
   * entry without its bank details, metadata, wallets or rates.
   */
  static async getOverview(userId: string, tripId: string) {
    const membership = await TripSharingRepository.requireMembership(prisma, userId, tripId);
    const groupId = membership.groupId;
    const members = await TripSharingRepository.listMembers(userId, tripId);
    const entries = await prisma.$queryRaw<
      Array<{
        id: string;
        memberUserId: string;
        type: string;
        date: Date;
        title: string;
        localCurrency: string;
        localAmount: unknown;
        baseAmount: unknown;
        categoryName: string | null;
        categoryColor: string | null;
        isIou: boolean;
        owedTo: string | null;
        sharedFromEntryId: string | null;
      }>
    >`
      SELECT
        te.id, t.user_id AS "memberUserId", te.type, te.transaction_date AS date,
        COALESCE(te.label, te.description) AS title,
        te.local_currency AS "localCurrency", te.local_amount AS "localAmount", te.base_amount AS "baseAmount",
        c.name AS "categoryName", c.color AS "categoryColor",
        (te.source_type = 'iou') AS "isIou", p.name AS "owedTo", te.shared_from_entry_id AS "sharedFromEntryId"
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      LEFT JOIN categories c ON c.id = te.category_id
      LEFT JOIN trip_participants p ON p.id = te.counterparty_id
      WHERE t.group_id = ${groupId} AND te.type IN ('spending', 'reimbursement')
      ORDER BY te.transaction_date DESC
    `;
    const reimbursedRows = await prisma.$queryRaw<Array<{ memberUserId: string; total: unknown }>>`
      SELECT t.user_id AS "memberUserId", COALESCE(SUM(a.amount_base), 0) AS total
      FROM trip_reimbursement_allocations a INNER JOIN trips t ON t.id = a.trip_id
      WHERE t.group_id = ${groupId}
      GROUP BY t.user_id
    `;
    const openRows = await prisma.$queryRaw<Array<{ debtor: string; creditor: string; openBase: unknown }>>`
      SELECT t.user_id AS debtor, te.created_by AS creditor,
        SUM((te.local_amount - COALESCE(s.local, 0)) * COALESCE((te.metadata->'iou'->>'estimateFxRate')::numeric, te.fx_rate)) AS "openBase"
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      LEFT JOIN (
        SELECT iou_entry_id, SUM(iou_local_amount) AS local FROM trip_settlement_allocations GROUP BY iou_entry_id
      ) s ON s.iou_entry_id = te.id
      WHERE t.group_id = ${groupId} AND te.shared_from_entry_id IS NOT NULL AND te.created_by IS NOT NULL
      GROUP BY t.user_id, te.created_by
    `;

    const sharesBySource = new Map<string, Array<{ userId: string; baseAmount: number }>>();
    for (const entry of entries) {
      if (!entry.sharedFromEntryId) continue;
      const list = sharesBySource.get(entry.sharedFromEntryId) || [];
      list.push({ userId: entry.memberUserId, baseAmount: Number(entry.baseAmount) });
      sharesBySource.set(entry.sharedFromEntryId, list);
    }
    const nameOf = new Map(members.map((member) => [member.userId, member.name]));
    const perMember = new Map(
      members
        .filter((member) => member.status === "active")
        .map((member) => [member.userId, { userId: member.userId, name: member.name, paid: 0, sharesGiven: 0, sharesReceived: 0, reimbursed: 0, net: 0 }]),
    );
    for (const entry of entries) {
      const totals = perMember.get(entry.memberUserId);
      if (!totals || entry.type !== "spending") continue;
      const base = Number(entry.baseAmount);
      if (entry.sharedFromEntryId) {
        totals.sharesReceived += base;
      } else {
        totals.paid += base;
        for (const share of sharesBySource.get(entry.id) || []) totals.sharesGiven += share.baseAmount;
      }
    }
    for (const row of reimbursedRows) {
      const totals = perMember.get(row.memberUserId);
      if (totals) totals.reimbursed += Number(row.total);
    }
    const memberTotals = [...perMember.values()].map((totals) => ({
      ...totals,
      paid: roundMoney(totals.paid),
      sharesGiven: roundMoney(totals.sharesGiven),
      sharesReceived: roundMoney(totals.sharesReceived),
      reimbursed: roundMoney(totals.reimbursed),
      net: roundMoney(totals.paid - totals.sharesGiven + totals.sharesReceived - totals.reimbursed),
    }));
    const combinedSpent = roundMoney(memberTotals.reduce((sum, row) => sum + row.paid, 0));
    const combinedReimbursed = roundMoney(memberTotals.reduce((sum, row) => sum + row.reimbursed, 0));
    const [trip] = await prisma.$queryRaw<Array<{ baseCurrency: string }>>`
      SELECT base_currency AS "baseCurrency" FROM trips WHERE id = ${tripId}
    `;

    return {
      groupId,
      role: membership.role,
      baseCurrency: trip.baseCurrency,
      members,
      totals: {
        combinedSpent,
        combinedReimbursed,
        combinedNet: roundMoney(combinedSpent - combinedReimbursed),
        members: memberTotals,
      },
      settleUp: openRows
        .map((row) => ({
          from: { userId: row.debtor, name: nameOf.get(row.debtor) ?? "Former member" },
          to: { userId: row.creditor, name: nameOf.get(row.creditor) ?? "Former member" },
          amountBase: roundMoney(Number(row.openBase)),
        }))
        .filter((row) => row.amountBase > 0.005),
      entries: entries.map((entry) => ({
        id: entry.id,
        member: { userId: entry.memberUserId, name: nameOf.get(entry.memberUserId) ?? "Former member" },
        type: entry.type,
        date: entry.date,
        title: entry.title,
        localCurrency: entry.localCurrency,
        localAmount: Number(entry.localAmount),
        baseAmount: Number(entry.baseAmount),
        category: entry.categoryName ? { name: entry.categoryName, color: entry.categoryColor } : null,
        isShare: !!entry.sharedFromEntryId,
        owedTo: entry.isIou ? entry.owedTo : null,
        shares: (sharesBySource.get(entry.id) || []).map((share) => ({
          userId: share.userId,
          name: nameOf.get(share.userId) ?? "Former member",
          baseAmount: share.baseAmount,
        })),
      })),
    };
  }

  /** Trips listed for a user carry who they're shared with and the user's role. */
  static async sharingSummaries(userId: string) {
    const rows = await prisma.$queryRaw<Array<{ tripId: string; groupId: string; role: string; memberCount: number }>>`
      SELECT m.trip_id AS "tripId", m.group_id AS "groupId", m.role,
        (SELECT COUNT(*)::int FROM trip_members other WHERE other.group_id = m.group_id AND other.status = 'active') AS "memberCount"
      FROM trip_members m
      WHERE m.user_id = ${userId} AND m.status = 'active' AND m.trip_id IS NOT NULL
    `;
    return new Map(rows.map((row) => [row.tripId, { groupId: row.groupId, role: row.role, memberCount: row.memberCount }]));
  }
}
