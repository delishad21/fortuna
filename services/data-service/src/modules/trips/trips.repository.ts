import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import {
  calculateReimbursementLeftoverBase,
  collectImpactedReimbursementEntryIds,
  hasFundingCoreValueChanged,
  normalizeCurrencyCode,
  normalizeOptionalCurrencyUpdate,
  normalizeFundingValues as normalizeAccountingFundingValues,
  resolveFundingOutFeeBaseAmount,
  resolveTripImportBaseAmount,
  shouldPreserveFundingBaseAmount,
  validateFundingInBankMatch,
  validateFundingOutFeeCurrency,
} from "./trips.accounting";
import { TripIouRepository } from "./trips.ious";
import { TripSharingRepository } from "./trips.sharing";
import {
  deleteRoleLinks,
  replaceLinks,
  syncTransactionCaches,
} from "../reimbursements/links.service";
import { LinkError } from "../reimbursements/links.core";

type PropagationTraceStep = {
  phase: "recalculate_wallet" | "sync_linked_fundings";
  tripId: string;
  walletId: string;
  updatedEntryCount?: number;
  updatedFundingCount?: number;
  queuedWallets?: Array<{ tripId: string; walletId: string }>;
};

type PropagationTrace = {
  startedAt: string;
  finishedAt: string;
  seedWallets: Array<{ tripId: string; walletId: string }>;
  totalWalletRecalculations: number;
  totalFundingRowsUpdated: number;
  steps: PropagationTraceStep[];
  truncated: boolean;
};

type TripReimbursementAllocationInput = {
  transactionId?: string;
  pendingBatchIndex?: number;
  amountBase: number;
};

type TripEntryLinkage = {
  type: "reimbursement" | "reimbursed";
  reimbursesAllocations?: Array<{
    transactionId?: string;
    pendingBatchIndex?: number;
    amountBase: number;
    reimbursingLocalAmount?: number;
    reimbursedLocalAmount?: number;
    reimbursingCurrency?: string;
    reimbursedCurrency?: string;
    reimbursingFxRate?: number;
    reimbursedFxRate?: number;
  }>;
  reimbursedByAllocations?: Array<{
    transactionId: string;
    amountBase: number;
    reimbursingLocalAmount?: number;
    reimbursedLocalAmount?: number;
    reimbursingCurrency?: string;
    reimbursedCurrency?: string;
    reimbursingFxRate?: number;
    reimbursedFxRate?: number;
  }>;
  leftoverBaseAmount?: number;
  leftoverCategoryId?: string | null;
};

export class TripRepository {
  private static readonly FUNDING_REVIEW_STATES = [
    "pending_review",
    "linked_confirmed",
    "external_confirmed",
    "rejected",
  ] as const;

  private static isFundingReviewState(value: unknown): value is (typeof TripRepository.FUNDING_REVIEW_STATES)[number] {
    return (
      typeof value === "string" &&
      (TripRepository.FUNDING_REVIEW_STATES as readonly string[]).includes(value)
    );
  }

  private static getFundingReviewState(input: {
    metadata: Record<string, unknown> | null | undefined;
    sourceType: string;
    bankTransactionId?: string | null;
  }): (typeof TripRepository.FUNDING_REVIEW_STATES)[number] {
    const metadata =
      input.metadata && typeof input.metadata === "object"
        ? (input.metadata as Record<string, unknown>)
        : {};
    const explicitState = metadata.matchReviewState;
    if (TripRepository.isFundingReviewState(explicitState)) {
      return explicitState;
    }

    const legacyStatus = String(metadata.matchReviewStatus || "").toLowerCase();
    if (legacyStatus === "pending" || legacyStatus === "unmatched") {
      return "pending_review";
    }
    if (legacyStatus === "accepted" || legacyStatus === "replaced") {
      return "linked_confirmed";
    }
    if (legacyStatus === "confirmed") {
      return input.bankTransactionId ? "linked_confirmed" : "external_confirmed";
    }
    if (legacyStatus === "rejected") {
      return "rejected";
    }

    const sourceType = String(input.sourceType || "").toLowerCase();
    if (sourceType === "imported_topup" || sourceType === "opening_balance") {
      return "pending_review";
    }
    return input.bankTransactionId ? "linked_confirmed" : "external_confirmed";
  }

  private static setFundingReviewState(
    metadata: Record<string, unknown>,
    state: (typeof TripRepository.FUNDING_REVIEW_STATES)[number],
    options?: { legacyStatus?: string },
  ) {
    metadata.matchReviewState = state;

    if (options?.legacyStatus) {
      metadata.matchReviewStatus = options.legacyStatus;
      return;
    }

    if (state === "pending_review") {
      metadata.matchReviewStatus = "pending";
    } else if (state === "linked_confirmed") {
      metadata.matchReviewStatus = "accepted";
    } else if (state === "external_confirmed") {
      metadata.matchReviewStatus = "confirmed";
    } else if (state === "rejected") {
      metadata.matchReviewStatus = "rejected";
    }
  }

  private static readonly WALLET_COLOR_PALETTE = [
    "#60a5fa",
    "#34d399",
    "#f59e0b",
    "#f87171",
    "#a78bfa",
    "#22d3ee",
    "#f472b6",
    "#84cc16",
    "#fb7185",
    "#38bdf8",
  ];

  private static pickWalletColor(seed: string) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return TripRepository.WALLET_COLOR_PALETTE[
      hash % TripRepository.WALLET_COLOR_PALETTE.length
    ];
  }

  private static resolveFundingFeeBaseAmount(input: {
    feeAmount: number;
    feeCurrency: string;
    baseCurrency?: string | null;
    sourceCurrency: string;
    destinationCurrency: string;
    fxRate: number | null;
  }) {
    const feeAmount = Number(input.feeAmount || 0);
    if (!(feeAmount > 0)) return 0;

    const feeCurrency = String(input.feeCurrency || "").toUpperCase();
    const baseCurrency = String(input.baseCurrency || "").toUpperCase();
    const sourceCurrency = String(input.sourceCurrency || "").toUpperCase();
    const destinationCurrency = String(input.destinationCurrency || "").toUpperCase();
    const fxRate = Number(input.fxRate || 0);

    if (feeCurrency === baseCurrency) return feeAmount;
    if (!(fxRate > 0)) return feeAmount;

    if (feeCurrency === sourceCurrency && sourceCurrency === baseCurrency) {
      return feeAmount;
    }
    if (feeCurrency === destinationCurrency && sourceCurrency === baseCurrency) {
      return feeAmount * fxRate;
    }
    if (feeCurrency === sourceCurrency && destinationCurrency === baseCurrency) {
      return feeAmount / fxRate;
    }
    if (feeCurrency === destinationCurrency && destinationCurrency === baseCurrency) {
      return feeAmount;
    }

    return feeAmount;
  }

  private static async getUserBaseCurrency(userId: string) {
    const [row] = await prisma.$queryRaw<Array<{ currency: string | null }>>`
      SELECT currency
      FROM user_settings
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    return normalizeCurrencyCode(row?.currency, "SGD");
  }

  private static buildTripCategoryFilterSql(categoryId: string) {
    const normalized = String(categoryId || "").trim().toLowerCase();
    if (!normalized) return Prisma.sql`TRUE`;
    if (normalized === "__reimbursement__" || normalized === "reimbursement") {
      return Prisma.sql`te.type = 'reimbursement'`;
    }
    if (normalized === "__funding_in__" || normalized === "funding_in") {
      return Prisma.sql`te.type = 'funding_in'`;
    }
    if (normalized === "__funding_out__" || normalized === "funding_out") {
      return Prisma.sql`te.type = 'funding_out'`;
    }
    return Prisma.sql`te.category_id = ${categoryId}`;
  }

  private static normalizeFundingValues(input: {
    sourceCurrency: string;
    sourceAmount: number;
    destinationCurrency: string;
    destinationAmount?: number | null;
    fxRate?: number | null;
    feeAmount?: number | null;
    feeCurrency?: string | null;
    baseCurrency: string;
    baseAmount?: number | null;
  }) {
    return normalizeAccountingFundingValues(input);
  }

  private static async normalizeFundingOutConfig(
    tx: Prisma.TransactionClient,
    userId: string,
    input: {
      tripBaseCurrency: string;
      sourceCurrency: string;
      sourceAmount: number;
      sourceBaseAmount: number;
      fundingOut?: {
        destinationType?: "bank" | "trip" | "wallet" | "external";
        destinationTripId?: string | null;
        destinationWalletId?: string | null;
        bankTransactionId?: string | null;
        destinationCurrency?: string | null;
        destinationAmount?: number | null;
        fxRate?: number | null;
        feeAmount?: number | null;
        feeCurrency?: string | null;
      } | null;
    },
  ) {
    const tripBaseCurrency = String(input.tripBaseCurrency || "SGD").toUpperCase();
    const sourceCurrency = String(input.sourceCurrency || tripBaseCurrency).toUpperCase();
    const sourceAmount = Number(input.sourceAmount || 0);
    const sourceBaseAmount = Number(input.sourceBaseAmount || 0);

    if (!(sourceAmount > 0)) {
      throw new Error("Funding out source amount must be greater than 0.");
    }

    const rawType = String(input.fundingOut?.destinationType || "external").toLowerCase();
    const destinationType: "bank" | "trip" | "wallet" | "external" =
      rawType === "bank" || rawType === "trip" || rawType === "wallet" || rawType === "external"
        ? rawType
        : "external";
    // "wallet" moves money into another wallet of the same trip (e.g. cash from an ATM).
    const destinationWalletId =
      destinationType === "wallet" || destinationType === "trip"
        ? input.fundingOut?.destinationWalletId
          ? String(input.fundingOut.destinationWalletId)
          : null
        : null;

    const destinationTripId =
      destinationType === "trip"
        ? input.fundingOut?.destinationTripId
          ? String(input.fundingOut.destinationTripId)
          : null
        : null;

    const linkedBankTransactionId = input.fundingOut?.bankTransactionId
      ? String(input.fundingOut.bankTransactionId)
      : null;

    let destinationCurrency = String(
      input.fundingOut?.destinationCurrency || sourceCurrency,
    ).toUpperCase();
    if (destinationType === "bank") {
      destinationCurrency = tripBaseCurrency;
    }

    let destinationAmount = Number(input.fundingOut?.destinationAmount || 0);
    let fxRate = Number(input.fundingOut?.fxRate || 0);
    const hasRequestedDestinationAmount = destinationAmount > 0;
    const hasRequestedFxRate = fxRate > 0;

    const feeRaw = Number(input.fundingOut?.feeAmount || 0);
    const feeAmount = feeRaw > 0 ? feeRaw : null;
    const feeCurrency =
      feeAmount && feeAmount > 0
        ? String(
            input.fundingOut?.feeCurrency ||
              (destinationType === "bank" ? tripBaseCurrency : destinationCurrency),
          ).toUpperCase()
        : null;

    validateFundingOutFeeCurrency({
      feeCurrency,
      sourceCurrency,
      destinationCurrency,
      tripBaseCurrency,
    });

    if (linkedBankTransactionId) {
      const linkedRows = await tx.$queryRaw<Array<{ amountIn: unknown }>>`
        SELECT amount_in AS "amountIn"
        FROM transactions
        WHERE id = ${linkedBankTransactionId} AND user_id = ${userId}
        LIMIT 1
      `;
      if (!linkedRows[0]) {
        throw new Error("Linked bank transaction not found or unauthorized.");
      }

      const linkedAmountIn = Number(linkedRows[0].amountIn || 0);
      if (!(linkedAmountIn > 0)) {
        throw new Error(
          "Linked bank transaction must be a positive bank credit (amount in).",
        );
      }

      if (destinationType !== "bank") {
        throw new Error(
          "Linked bank transaction can only be used when funding out destination is bank.",
        );
      }

      destinationCurrency = tripBaseCurrency;
      destinationAmount = linkedAmountIn;
    }

    if (!linkedBankTransactionId && hasRequestedDestinationAmount && hasRequestedFxRate) {
      const derivedDestinationAmount = sourceAmount / fxRate;
      if (Math.abs(derivedDestinationAmount - destinationAmount) > 0.01) {
        throw new Error(
          "Funding out destination amount and FX rate are inconsistent with source amount.",
        );
      }
    }

    if (!(destinationAmount > 0)) {
      if (fxRate > 0) {
        destinationAmount = sourceAmount / fxRate;
      } else if (destinationType === "bank" && sourceBaseAmount > 0) {
        destinationAmount = sourceBaseAmount;
      } else {
        destinationAmount = sourceAmount;
      }
    }

    if (!(destinationAmount > 0)) {
      throw new Error("Funding out destination amount must be greater than 0.");
    }

    if (!(fxRate > 0)) {
      fxRate = sourceAmount / destinationAmount;
    }
    if (!(fxRate > 0)) {
      throw new Error("Funding out FX rate must be greater than 0.");
    }

    if (destinationType === "bank" && destinationCurrency !== tripBaseCurrency) {
      throw new Error(
        `Bank funding out destination currency must be ${tripBaseCurrency}.`,
      );
    }

    if (destinationType === "trip" && !destinationTripId) {
      throw new Error("Destination trip must be selected for trip funding out.");
    }
    if (destinationType === "wallet" && !destinationWalletId) {
      throw new Error("Choose the wallet the money moves into.");
    }

    const feeBaseAmount =
      feeAmount && feeCurrency
        ? resolveFundingOutFeeBaseAmount({
            feeAmount,
            feeCurrency,
            baseCurrency: tripBaseCurrency,
            sourceCurrency,
            destinationCurrency,
            sourceAmount,
            sourceBaseAmount,
            fxRate,
          })
        : null;

    return {
      destinationType,
      destinationTripId,
      destinationWalletId,
      bankTransactionId: linkedBankTransactionId,
      destinationCurrency,
      destinationAmount,
      fxRate,
      feeAmount,
      feeCurrency,
      feeBaseAmount,
    };
  }

  private static deriveFundingEntrySourceType(input: {
    sourceType: string;
    bankTransactionId?: string | null;
  }) {
    if (input.bankTransactionId) return "funding_in_bank";

    switch (String(input.sourceType || "").toLowerCase()) {
      case "imported_topup":
        return "funding_in_imported_topup";
      case "opening_balance":
        return "funding_in_opening_balance";
      case "wallet_conversion":
        return "funding_in_wallet_conversion";
      case "from_trip_outgoing":
        return "funding_in_trip";
      default:
        return "funding_in_manual";
    }
  }

  private static deriveFundingEntryLabel(input: {
    sourceType: string;
    destinationCurrency: string;
    metadata: Record<string, unknown>;
  }) {
    const sourceType = String(input.sourceType || "").toLowerCase();

    if (typeof input.metadata.originalLabel === "string") {
      return input.metadata.originalLabel;
    }

    switch (sourceType) {
      case "imported_topup":
        return `Funding In · ${String(input.destinationCurrency || "").toUpperCase()}`;
      case "opening_balance":
        return "Opening Balance";
      case "wallet_conversion":
        return "Wallet Conversion In";
      case "from_trip_outgoing":
        return "Funding In from Trip";
      default:
        return "Funding In";
    }
  }

  private static deriveFundingEntryDescription(input: {
    sourceType: string;
    metadata: Record<string, unknown>;
    bankTransactionDescription?: string | null;
    walletName?: string | null;
    destinationCurrency: string;
  }) {
    if (typeof input.metadata.originalDescription === "string") {
      return input.metadata.originalDescription;
    }
    if (input.bankTransactionDescription) {
      return input.bankTransactionDescription;
    }

    const sourceType = String(input.sourceType || "").toLowerCase();
    switch (sourceType) {
      case "opening_balance":
        return `Opening balance for ${input.walletName || input.destinationCurrency}`;
      case "wallet_conversion":
        return `Wallet conversion into ${input.walletName || input.destinationCurrency}`;
      case "from_trip_outgoing":
        return typeof input.metadata.sourceTripDescription === "string"
          ? input.metadata.sourceTripDescription
          : `Funding imported from ${String(input.metadata.sourceTripName || "another trip")}`;
      case "imported_topup":
        return "Imported top-up";
      default:
        return `Funding into ${input.walletName || input.destinationCurrency}`;
    }
  }

  private static deriveFundingEntryDate(input: {
    metadata: Record<string, unknown>;
    bankTransactionDate?: Date | null;
    createdAt?: Date | null;
  }) {
    const parseDate = (value: unknown) => {
      if (!value) return null;
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    return (
      parseDate(input.metadata.originalDate) ||
      parseDate(input.metadata.basisTransactionDate) ||
      input.bankTransactionDate ||
      input.createdAt ||
      new Date()
    );
  }

  private static buildFundingEntryMetadata(input: {
    fundingId: string;
    sourceType: string;
    sourceCurrency: string;
    sourceAmount: number;
    destinationCurrency: string;
    destinationAmount: number;
    baseAmount: number;
    fxRate: number;
    feeAmount: number | null;
    feeCurrency: string | null;
    walletId?: string | null;
    walletName?: string | null;
    walletColor?: string | null;
    bankTransactionId?: string | null;
    bankTransactionDate?: Date | null;
    bankTransactionDescription?: string | null;
    bankTransactionAmountIn?: number | null;
    bankTransactionAmountOut?: number | null;
    metadata: Record<string, unknown>;
  }) {
    return {
      ...input.metadata,
      fundingId: input.fundingId,
      fundingDirection: "in",
      sourceType: TripRepository.deriveFundingEntrySourceType({
        sourceType: input.sourceType,
        bankTransactionId: input.bankTransactionId,
      }),
      fundingSourceType: input.sourceType,
      sourceCurrency: input.sourceCurrency,
      sourceAmount: input.sourceAmount,
      destinationCurrency: input.destinationCurrency,
      destinationAmount: input.destinationAmount,
      baseAmount: input.baseAmount,
      fxRate: input.fxRate,
      feeAmount: input.feeAmount,
      feeCurrency: input.feeCurrency,
      walletId: input.walletId ?? null,
      walletName: input.walletName ?? null,
      walletColor: input.walletColor ?? "#ffffff",
      bankTransactionId: input.bankTransactionId ?? null,
      bankTransactionDate: input.bankTransactionDate
        ? input.bankTransactionDate.toISOString()
        : null,
      bankTransactionDescription: input.bankTransactionDescription ?? null,
      bankTransactionAmountIn: input.bankTransactionAmountIn ?? null,
      bankTransactionAmountOut: input.bankTransactionAmountOut ?? null,
    } satisfies Record<string, unknown>;
  }

  private static async upsertFundingEntryTx(
    tx: Prisma.TransactionClient,
    userId: string,
    tripId: string,
    fundingId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        entryId: string | null;
        walletId: string | null;
        sourceType: string;
        sourceCurrency: string;
        sourceAmount: unknown;
        destinationCurrency: string;
        destinationAmount: unknown;
        fxRate: unknown;
        baseAmount: unknown;
        feeAmount: unknown;
        feeCurrency: string | null;
        metadata: unknown;
        createdAt: Date;
        walletName: string | null;
        walletColor: string | null;
        bankTransactionId: string | null;
        bankTransactionDate: Date | null;
        bankTransactionDescription: string | null;
        bankTransactionAmountIn: unknown;
        bankTransactionAmountOut: unknown;
        tripBaseCurrency: string;
      }>
    >`
      SELECT
        tf.id,
        tf.entry_id AS "entryId",
        tf.wallet_id AS "walletId",
        tf.source_type AS "sourceType",
        tf.source_currency AS "sourceCurrency",
        tf.source_amount AS "sourceAmount",
        tf.destination_currency AS "destinationCurrency",
        tf.destination_amount AS "destinationAmount",
        tf.fx_rate AS "fxRate",
        tf.base_amount AS "baseAmount",
        tf.fee_amount AS "feeAmount",
        tf.fee_currency AS "feeCurrency",
        tf.metadata,
        tf.created_at AS "createdAt",
        w.name AS "walletName",
        w.color AS "walletColor",
        bt.id AS "bankTransactionId",
        bt.date AS "bankTransactionDate",
        bt.description AS "bankTransactionDescription",
        bt.amount_in AS "bankTransactionAmountIn",
        bt.amount_out AS "bankTransactionAmountOut",
        t.base_currency AS "tripBaseCurrency"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      LEFT JOIN wallets w ON w.id = tf.wallet_id
      LEFT JOIN transactions bt ON bt.id = tf.bank_transaction_id
      WHERE tf.id = ${fundingId} AND tf.trip_id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;

    const funding = rows[0];
    if (!funding) {
      throw new Error("Funding not found or unauthorized");
    }

    const metadata =
      funding.metadata && typeof funding.metadata === "object"
        ? { ...(funding.metadata as Record<string, unknown>) }
        : {};

    const localAmount = Number(funding.destinationAmount || 0);
    // Without a stored base value, only an amount already in the trip's currency can stand in.
    const baseAmount =
      funding.baseAmount !== null && funding.baseAmount !== undefined
        ? Number(funding.baseAmount)
        : funding.sourceCurrency.toUpperCase() === funding.tripBaseCurrency.toUpperCase()
          ? Number(funding.sourceAmount || 0)
          : funding.destinationCurrency.toUpperCase() === funding.tripBaseCurrency.toUpperCase()
            ? localAmount
            : 0;
    const fxRate = localAmount > 0 ? baseAmount / localAmount : 1;
    const entryId = funding.entryId || randomUUID();
    const sourceType = TripRepository.deriveFundingEntrySourceType({
      sourceType: funding.sourceType,
      bankTransactionId: funding.bankTransactionId,
    });
    const entryMetadata = TripRepository.buildFundingEntryMetadata({
      fundingId: funding.id,
      sourceType: funding.sourceType,
      sourceCurrency: funding.sourceCurrency,
      sourceAmount: Number(funding.sourceAmount || 0),
      destinationCurrency: funding.destinationCurrency,
      destinationAmount: localAmount,
      baseAmount,
      fxRate,
      feeAmount:
        funding.feeAmount !== null && funding.feeAmount !== undefined
          ? Number(funding.feeAmount)
          : null,
      feeCurrency: funding.feeCurrency,
      walletId: funding.walletId,
      walletName: funding.walletName,
      walletColor: funding.walletColor,
      bankTransactionId: funding.bankTransactionId,
      bankTransactionDate: funding.bankTransactionDate,
      bankTransactionDescription: funding.bankTransactionDescription,
      bankTransactionAmountIn:
        funding.bankTransactionAmountIn !== null &&
        funding.bankTransactionAmountIn !== undefined
          ? Number(funding.bankTransactionAmountIn)
          : null,
      bankTransactionAmountOut:
        funding.bankTransactionAmountOut !== null &&
        funding.bankTransactionAmountOut !== undefined
          ? Number(funding.bankTransactionAmountOut)
          : null,
      metadata,
    });
    const date = TripRepository.deriveFundingEntryDate({
      metadata,
      bankTransactionDate: funding.bankTransactionDate,
      createdAt: funding.createdAt,
    });
    const label = TripRepository.deriveFundingEntryLabel({
      sourceType: funding.sourceType,
      destinationCurrency: funding.destinationCurrency,
      metadata,
    });
    const description = TripRepository.deriveFundingEntryDescription({
      sourceType: funding.sourceType,
      metadata,
      bankTransactionDescription: funding.bankTransactionDescription,
      walletName: funding.walletName,
      destinationCurrency: funding.destinationCurrency,
    });

    await tx.$executeRaw`
      INSERT INTO trip_entries (
        id,
        trip_id,
        wallet_id,
        source_type,
        source_transaction_id,
        type,
        transaction_date,
        description,
        label,
        local_currency,
        local_amount,
        fx_rate,
        base_amount,
        fee_amount,
        fee_currency,
        category_id,
        linked_entry_id,
        metadata,
        created_at
      )
      VALUES (
        ${entryId},
        ${tripId},
        ${funding.walletId},
        ${sourceType},
        ${funding.bankTransactionId},
        'funding_in',
        ${date},
        ${description},
        ${label},
        ${funding.destinationCurrency},
        ${localAmount},
        ${fxRate},
        ${baseAmount},
        ${null},
        ${null},
        NULL,
        NULL,
        ${entryMetadata as Prisma.InputJsonValue},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE
      SET
        wallet_id = EXCLUDED.wallet_id,
        source_type = EXCLUDED.source_type,
        source_transaction_id = EXCLUDED.source_transaction_id,
        type = EXCLUDED.type,
        transaction_date = EXCLUDED.transaction_date,
        description = EXCLUDED.description,
        label = EXCLUDED.label,
        local_currency = EXCLUDED.local_currency,
        local_amount = EXCLUDED.local_amount,
        fx_rate = EXCLUDED.fx_rate,
        base_amount = EXCLUDED.base_amount,
        fee_amount = EXCLUDED.fee_amount,
        fee_currency = EXCLUDED.fee_currency,
        metadata = EXCLUDED.metadata
    `;

    await tx.$executeRaw`
      UPDATE trip_fundings
      SET entry_id = ${entryId}
      WHERE id = ${fundingId} AND trip_id = ${tripId}
    `;

    return entryId;
  }

  private static async deleteFundingEntryTx(
    tx: Prisma.TransactionClient,
    tripId: string,
    fundingId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ entryId: string | null }>>`
      SELECT entry_id AS "entryId"
      FROM trip_fundings
      WHERE id = ${fundingId} AND trip_id = ${tripId}
      LIMIT 1
    `;
    const entryId = rows[0]?.entryId;
    if (!entryId) return;

    await tx.$executeRaw`
      DELETE FROM trip_entries
      WHERE id = ${entryId} AND trip_id = ${tripId}
    `;
  }

  private static async upsertFundingFromTripOutgoingTx(
    tx: Prisma.TransactionClient,
    userId: string,
    input: {
      sourceTripId: string;
      sourceTripName: string;
      sourceEntryId: string;
      sourceDate: Date;
      sourceDescription: string;
      sourceLabel: string | null;
      destinationTripId: string;
      destinationCurrency: string;
      destinationAmount: number;
      sourceCurrency: string;
      sourceAmount: number;
      fxRate: number;
      baseAmount: number;
      feeAmount?: number | null;
      feeCurrency?: string | null;
      sourceMetadata?: Record<string, unknown> | null;
      /** `wallet_conversion` when the money stays in the same trip. */
      fundingSourceType?: "from_trip_outgoing" | "wallet_conversion";
      destinationWalletId?: string | null;
    },
  ) {
    const destinationCurrency = String(input.destinationCurrency || "").toUpperCase();
    if (!destinationCurrency) return null;
    const fundingSourceType = input.fundingSourceType ?? "from_trip_outgoing";

    const [destinationTrip] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM trips
      WHERE id = ${input.destinationTripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!destinationTrip) {
      throw new Error("Destination trip not found or unauthorized.");
    }

    const [existingLinkedFunding] = await tx.$queryRaw<
      Array<{ id: string; walletId: string | null }>
    >`
      SELECT
        tf.id,
        tf.wallet_id AS "walletId"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE
        tf.trip_id = ${input.destinationTripId}
        AND tf.source_type = ${fundingSourceType}
        AND COALESCE(tf.metadata->>'sourceTripEntryId', '') = ${input.sourceEntryId}
        AND t.user_id = ${userId}
      LIMIT 1
    `;

    let destinationWalletId = input.destinationWalletId || existingLinkedFunding?.walletId || null;
    // Money moving between trips stays in the same account (Revolut USD to Revolut USD).
    const [sourceAccount] = await tx.$queryRaw<Array<{ id: string | null; name: string | null }>>`
      SELECT a.id, a.name
      FROM trip_entries te
      LEFT JOIN wallets w ON w.id = te.wallet_id
      LEFT JOIN wallet_accounts a ON a.id = w.account_id
      WHERE te.id = ${input.sourceEntryId}
      LIMIT 1
    `;
    if (input.destinationWalletId) {
      const [wallet] = await tx.$queryRaw<Array<{ currency: string }>>`
        SELECT currency FROM wallets
        WHERE id = ${input.destinationWalletId} AND trip_id = ${input.destinationTripId}
        LIMIT 1
      `;
      if (!wallet) throw new Error("Destination wallet not found in that trip.");
      if (wallet.currency.toUpperCase() !== destinationCurrency) {
        throw new Error(`The destination wallet holds ${wallet.currency}, not ${destinationCurrency}.`);
      }
    }
    if (!destinationWalletId) {
      const [existingWallet] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM wallets
        WHERE trip_id = ${input.destinationTripId} AND currency = ${destinationCurrency}
        ORDER BY (account_id IS NOT DISTINCT FROM ${sourceAccount?.id ?? null}) DESC, created_at ASC
        LIMIT 1
      `;
      if (existingWallet) {
        destinationWalletId = existingWallet.id;
      } else {
        const walletName = sourceAccount?.name
          ? `${sourceAccount.name} ${destinationCurrency}`
          : `Trip Transfer ${destinationCurrency}`;
        const [createdWallet] = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO wallets (
            id,
            trip_id,
            user_id,
            account_id,
            name,
            currency,
            color,
            created_at,
            updated_at
          )
          VALUES (
            ${randomUUID()},
            ${input.destinationTripId},
            ${userId},
            ${sourceAccount?.id ?? null},
            ${walletName},
            ${destinationCurrency},
            ${TripRepository.pickWalletColor(
              `${input.destinationTripId}::${walletName}::${destinationCurrency}`,
            )},
            NOW(),
            NOW()
          )
          ON CONFLICT (trip_id, name, currency) DO UPDATE SET updated_at = NOW()
          RETURNING id
        `;
        destinationWalletId = createdWallet.id;
      }
    }

    const baseMetadata = {
      importedFromTripOutgoing: true,
      sourceTripEntryId: input.sourceEntryId,
      sourceTripId: input.sourceTripId,
      sourceTripName: input.sourceTripName,
      sourceTripDate: input.sourceDate,
      sourceTripDescription: input.sourceDescription,
      sourceTripLabel: input.sourceLabel,
      sourceMetadata: input.sourceMetadata ?? null,
      matchReviewState: "external_confirmed",
      matchReviewStatus: "confirmed",
      autoLinkedFromFundingOut: true,
    } as Record<string, unknown>;

    const fundingId = existingLinkedFunding?.id || randomUUID();
    if (existingLinkedFunding) {
      await tx.$executeRaw`
        UPDATE trip_fundings
        SET
          wallet_id = ${destinationWalletId},
          source_currency = ${input.sourceCurrency},
          source_amount = ${input.sourceAmount},
          destination_currency = ${destinationCurrency},
          destination_amount = ${input.destinationAmount},
          fx_rate = ${input.fxRate},
          base_amount = ${input.baseAmount},
          fee_amount = ${input.feeAmount ?? null},
          fee_currency = ${input.feeCurrency ?? null},
          metadata = ${baseMetadata as Prisma.InputJsonValue}
        WHERE id = ${fundingId} AND trip_id = ${input.destinationTripId}
      `;
    } else {
      await tx.$executeRaw`
        INSERT INTO trip_fundings (
          id,
          trip_id,
          wallet_id,
          entry_id,
          bank_transaction_id,
          source_type,
          source_currency,
          source_amount,
          destination_currency,
          destination_amount,
          fx_rate,
          base_amount,
          fee_amount,
          fee_currency,
          metadata,
          created_at
        )
        VALUES (
          ${fundingId},
          ${input.destinationTripId},
          ${destinationWalletId},
          NULL,
          NULL,
          ${fundingSourceType},
          ${input.sourceCurrency},
          ${input.sourceAmount},
          ${destinationCurrency},
          ${input.destinationAmount},
          ${input.fxRate},
          ${input.baseAmount},
          ${input.feeAmount ?? null},
          ${input.feeCurrency ?? null},
          ${baseMetadata as Prisma.InputJsonValue},
          NOW()
        )
      `;
    }

    await TripRepository.upsertFundingEntryTx(
      tx,
      userId,
      input.destinationTripId,
      fundingId,
    );

    return {
      fundingId,
      walletId: destinationWalletId,
    };
  }

  private static async deleteLinkedFundingsFromTripOutgoingTx(
    tx: Prisma.TransactionClient,
    userId: string,
    sourceEntryIds: string[],
  ) {
    const uniqueSourceEntryIds = Array.from(new Set(sourceEntryIds.filter(Boolean)));
    if (uniqueSourceEntryIds.length === 0) {
      return [] as Array<{ tripId: string; walletId: string }>;
    }

    const rows = await tx.$queryRaw<
      Array<{ id: string; tripId: string; walletId: string | null }>
    >`
      SELECT
        tf.id,
        tf.trip_id AS "tripId",
        tf.wallet_id AS "walletId"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE
        tf.source_type IN ('from_trip_outgoing', 'wallet_conversion')
        AND COALESCE(tf.metadata->>'sourceTripEntryId', '') IN (${Prisma.join(uniqueSourceEntryIds)})
        AND t.user_id = ${userId}
    `;

    const recalcTargets = new Map<string, { tripId: string; walletId: string }>();
    for (const row of rows) {
      await TripRepository.deleteFundingEntryTx(tx, row.tripId, row.id);
      await tx.$executeRaw`
        DELETE FROM trip_fundings
        WHERE id = ${row.id} AND trip_id = ${row.tripId}
      `;
      if (row.walletId) {
        recalcTargets.set(`${row.tripId}:${row.walletId}`, {
          tripId: row.tripId,
          walletId: row.walletId,
        });
      }
    }

    return Array.from(recalcTargets.values());
  }

  private static mapTrip(row: any) {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      coverImageUrl: row.coverImageUrl ?? null,
      baseCurrency: row.baseCurrency,
      startDate: row.startDate,
      endDate: row.endDate,
      status: row.status,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private static mapWallet(row: any) {
    return {
      id: row.id,
      tripId: row.tripId,
      accountId: row.accountId ?? null,
      accountName: row.accountName ?? null,
      name: row.name,
      currency: row.currency,
      color: row.color ?? "#60a5fa",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private static mapFunding(row: any) {
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? ({ ...(row.metadata as Record<string, unknown>) } as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const reviewState = TripRepository.getFundingReviewState({
      metadata,
      sourceType: row.sourceType,
      bankTransactionId: row.bankTransactionId,
    });
    TripRepository.setFundingReviewState(metadata, reviewState);

    return {
      id: row.id,
      tripId: row.tripId,
      walletId: row.walletId,
      entryId: row.entryId ?? null,
      bankTransactionId: row.bankTransactionId,
      sourceType: row.sourceType,
      sourceCurrency: row.sourceCurrency,
      sourceAmount: row.sourceAmount,
      destinationCurrency: row.destinationCurrency,
      destinationAmount: row.destinationAmount,
      fxRate: row.fxRate,
      baseAmount: row.baseAmount,
      feeAmount: row.feeAmount,
      feeCurrency: row.feeCurrency,
      metadata,
      reviewState,
      createdAt: row.createdAt,
      wallet: row.walletId
        ? {
            id: row.walletId,
            name: row.walletName,
            currency: row.walletCurrency,
            color: row.walletColor ?? "#60a5fa",
          }
        : null,
      bankTransaction: row.bankTransactionId
        ? {
            id: row.bankTransactionId,
            date: row.bankTransactionDate,
            description: row.bankTransactionDescription,
            amountIn: row.bankTransactionAmountIn,
            amountOut: row.bankTransactionAmountOut,
          }
        : null,
      suggestedBankTransaction: row.suggestedBankTransactionId
        ? {
            id: row.suggestedBankTransactionId,
            date: row.suggestedBankTransactionDate,
            description: row.suggestedBankTransactionDescription,
            amountIn: row.suggestedBankTransactionAmountIn,
            amountOut: row.suggestedBankTransactionAmountOut,
          }
        : null,
      trip: {
        id: row.tripId,
        name: row.tripName,
      },
    };
  }

  private static async syncLinkedFundingBaseAmountsFromWalletOutflows(
    userId: string,
    tripId: string,
    walletId: string,
  ) {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; tripId: string; walletId: string | null }>
    >`
      UPDATE trip_fundings tf
      SET base_amount = te.base_amount
      FROM trip_entries te
      INNER JOIN trips source_trip ON source_trip.id = te.trip_id,
      trips destination_trip
      WHERE
        destination_trip.id = tf.trip_id
        AND tf.source_type IN ('from_trip_outgoing', 'wallet_conversion')
        AND COALESCE(tf.metadata->>'sourceTripEntryId', '') = te.id
        AND te.trip_id = ${tripId}
        AND te.wallet_id = ${walletId}
        AND te.type = 'funding_out'
        AND source_trip.user_id = ${userId}
        AND destination_trip.user_id = ${userId}
        AND (
          tf.base_amount IS NULL
          OR ABS(tf.base_amount - te.base_amount) > 0.0001
        )
      RETURNING tf.id, tf.trip_id AS "tripId", tf.wallet_id AS "walletId"
    `;

    // Trip totals read the funding entries, so they must follow the funding rows.
    if (rows.length) {
      await prisma.$transaction(async (tx) => {
        for (const row of rows) {
          await TripRepository.upsertFundingEntryTx(tx, userId, row.tripId, row.id);
        }
      });
    }

    const downstreamWallets = Array.from(
      new Map(
        rows
          .filter((row) => Boolean(row.tripId && row.walletId))
          .map((row) => [
            `${row.tripId}:${row.walletId}`,
            { tripId: row.tripId, walletId: row.walletId as string },
          ]),
      ).values(),
    );

    return {
      downstreamWallets,
      updatedFundingCount: rows.length,
    };
  }

  private static async propagateFundingBaseAmountsAcrossTrips(
    userId: string,
    seedWallets: Array<{ tripId: string; walletId: string }>,
  ): Promise<PropagationTrace> {
    const startedAt = new Date().toISOString();
    const traceSteps: PropagationTraceStep[] = [];
    let totalWalletRecalculations = 0;
    let totalFundingRowsUpdated = 0;
    let truncated = false;

    const queue: Array<{ tripId: string; walletId: string; recalculate: boolean }> =
      seedWallets
        .filter((item) => item.tripId && item.walletId)
        .map((item) => ({
          tripId: item.tripId,
          walletId: item.walletId,
          recalculate: false,
        }));

    const seenIterations = new Map<string, number>();
    let iterationBudget = 400;

    while (queue.length > 0 && iterationBudget > 0) {
      iterationBudget -= 1;
      const current = queue.shift()!;
      const key = `${current.tripId}:${current.walletId}:${current.recalculate ? "1" : "0"}`;
      const seen = seenIterations.get(key) || 0;
      if (seen >= 6) {
        continue;
      }
      seenIterations.set(key, seen + 1);

      if (current.recalculate) {
        const recalcResult = await TripRepository.recalculateWalletEntriesToBase(
          userId,
          current.tripId,
          current.walletId,
          { mode: "weighted" },
          false,
        ).catch(TripRepository.recalcFailed);
        totalWalletRecalculations += 1;
        traceSteps.push({
          phase: "recalculate_wallet",
          tripId: current.tripId,
          walletId: current.walletId,
          updatedEntryCount: recalcResult?.updatedCount ?? 0,
        });
      }

      const syncResult = await TripRepository.syncLinkedFundingBaseAmountsFromWalletOutflows(
        userId,
        current.tripId,
        current.walletId,
      );
      totalFundingRowsUpdated += syncResult.updatedFundingCount;
      traceSteps.push({
        phase: "sync_linked_fundings",
        tripId: current.tripId,
        walletId: current.walletId,
        updatedFundingCount: syncResult.updatedFundingCount,
        queuedWallets: syncResult.downstreamWallets,
      });

      for (const wallet of syncResult.downstreamWallets) {
        queue.push({
          tripId: wallet.tripId,
          walletId: wallet.walletId,
          recalculate: true,
        });
      }
    }

    if (iterationBudget <= 0) {
      truncated = true;
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      seedWallets,
      totalWalletRecalculations,
      totalFundingRowsUpdated,
      steps: traceSteps,
      truncated,
    };
  }

  private static roundMoney(value: number) {
    return Number(value.toFixed(4));
  }

  /**
   * Automatic recalculations must not undo the change that triggered them, but their
   * failures should not vanish either. A wallet with nothing to average yet is expected.
   */
  private static recalcFailed(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("Unable to derive weighted FX")) {
      console.warn("[trips] wallet recalculation failed:", message);
    }
    return null;
  }

  // Rates for currencies like IDR need more places than money amounts.
  private static roundRate(value: number) {
    return Number(value.toFixed(10));
  }

  /** Entries whose base amount the user set; wallet recalculation leaves them alone. */
  private static readonly LOCKED_BASE_SQL = Prisma.sql`(
    COALESCE(te.metadata->>'baseAmountLocked', '') = 'true'
    OR COALESCE(te.metadata->>'manualBaseAmount', '') <> ''
    OR COALESCE(te.metadata->>'manualFxRate', '') <> ''
  )`;

  /**
   * Re-values reimbursement allocations touching `entryIds` after either side's base
   * amount changed. Each allocation keeps the local amounts it covered, takes the lower
   * of the two sides' current base values, and is scaled down if a side is over-allocated.
   * Returns every entry whose linkage cache needs rebuilding.
   */
  private static async reconcileReimbursementAllocationsTx(
    tx: Prisma.TransactionClient,
    tripId: string,
    entryIds: string[],
  ) {
    if (!entryIds.length) return [] as string[];
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        reimbursementEntryId: string;
        reimbursedEntryId: string;
        reimbursingLocalAmount: unknown;
        reimbursedLocalAmount: unknown;
        sourceBase: unknown;
        sourceLocal: unknown;
        targetBase: unknown;
        targetLocal: unknown;
      }>
    >`
      SELECT
        a.id,
        a.reimbursement_entry_id AS "reimbursementEntryId",
        a.reimbursed_entry_id AS "reimbursedEntryId",
        a.reimbursing_local_amount AS "reimbursingLocalAmount",
        a.reimbursed_local_amount AS "reimbursedLocalAmount",
        re.base_amount AS "sourceBase",
        re.local_amount AS "sourceLocal",
        te.base_amount AS "targetBase",
        te.local_amount AS "targetLocal"
      FROM trip_reimbursement_allocations a
      INNER JOIN trip_entries re ON re.id = a.reimbursement_entry_id
      INNER JOIN trip_entries te ON te.id = a.reimbursed_entry_id
      WHERE
        a.trip_id = ${tripId}
        AND a.id IN (
          SELECT id FROM trip_reimbursement_allocations
          WHERE trip_id = ${tripId}
            AND (reimbursement_entry_id = ANY(${entryIds}) OR reimbursed_entry_id = ANY(${entryIds}))
        )
      FOR UPDATE OF a
    `;
    if (!rows.length) return [] as string[];

    const rateOf = (base: unknown, local: unknown) => {
      const localAmount = Number(local || 0);
      return localAmount > 0 ? Number(base || 0) / localAmount : 1;
    };
    const next = rows.map((row) => {
      const sourceFx = rateOf(row.sourceBase, row.sourceLocal);
      const targetFx = rateOf(row.targetBase, row.targetLocal);
      const amountBase = Math.max(
        Math.min(
          Number(row.reimbursingLocalAmount || 0) * sourceFx,
          Number(row.reimbursedLocalAmount || 0) * targetFx,
        ),
        0,
      );
      return { ...row, sourceFx, targetFx, amountBase };
    });

    // Neither side may end up allocating more than its own base amount.
    const scaleBy = (key: "reimbursementEntryId" | "reimbursedEntryId", capOf: (row: (typeof next)[number]) => number) => {
      const totals = new Map<string, number>();
      for (const row of next) totals.set(row[key], (totals.get(row[key]) || 0) + row.amountBase);
      for (const row of next) {
        const total = totals.get(row[key]) || 0;
        const cap = capOf(row);
        if (total - cap > 0.0001 && total > 0) row.amountBase = (row.amountBase * cap) / total;
      }
    };
    scaleBy("reimbursementEntryId", (row) => Number(row.sourceBase || 0));
    scaleBy("reimbursedEntryId", (row) => Number(row.targetBase || 0));

    for (const row of next) {
      const amountBase = TripRepository.roundMoney(row.amountBase);
      await tx.$executeRaw`
        UPDATE trip_reimbursement_allocations
        SET
          amount_base = ${amountBase},
          reimbursing_local_amount = ${TripRepository.roundMoney(row.sourceFx > 0 ? amountBase / row.sourceFx : 0)},
          reimbursed_local_amount = ${TripRepository.roundMoney(row.targetFx > 0 ? amountBase / row.targetFx : 0)},
          reimbursing_fx_rate = ${TripRepository.roundRate(row.sourceFx)},
          reimbursed_fx_rate = ${TripRepository.roundRate(row.targetFx)}
        WHERE id = ${row.id}
      `;
    }
    return Array.from(
      new Set(next.flatMap((row) => [row.reimbursementEntryId, row.reimbursedEntryId])),
    );
  }

  /**
   * Rebuilds the `metadata.linkage` cache of the given entries from the allocations
   * table. Reimbursement entries keep their leftover category; spending entries lose
   * the cache when nothing reimburses them any more.
   */
  private static async rebuildEntryLinkageCachesTx(
    tx: Prisma.TransactionClient,
    tripId: string,
    entryIds: string[],
  ) {
    const ids = Array.from(new Set(entryIds.filter(Boolean)));
    if (!ids.length) return;
    const entries = await tx.$queryRaw<
      Array<{ id: string; type: string; baseAmount: unknown; localCurrency: string; metadata: unknown }>
    >`
      SELECT id, type, base_amount AS "baseAmount", local_currency AS "localCurrency", metadata
      FROM trip_entries
      WHERE trip_id = ${tripId} AND id = ANY(${ids})
    `;
    const allocations = await tx.$queryRaw<
      Array<{
        reimbursementEntryId: string;
        reimbursedEntryId: string;
        amountBase: unknown;
        reimbursingLocalAmount: unknown;
        reimbursedLocalAmount: unknown;
        reimbursingFxRate: unknown;
        reimbursedFxRate: unknown;
        reimbursingCurrency: string;
        reimbursedCurrency: string;
      }>
    >`
      SELECT
        a.reimbursement_entry_id AS "reimbursementEntryId",
        a.reimbursed_entry_id AS "reimbursedEntryId",
        a.amount_base AS "amountBase",
        a.reimbursing_local_amount AS "reimbursingLocalAmount",
        a.reimbursed_local_amount AS "reimbursedLocalAmount",
        a.reimbursing_fx_rate AS "reimbursingFxRate",
        a.reimbursed_fx_rate AS "reimbursedFxRate",
        re.local_currency AS "reimbursingCurrency",
        te.local_currency AS "reimbursedCurrency"
      FROM trip_reimbursement_allocations a
      INNER JOIN trip_entries re ON re.id = a.reimbursement_entry_id
      INNER JOIN trip_entries te ON te.id = a.reimbursed_entry_id
      WHERE a.trip_id = ${tripId}
        AND (a.reimbursement_entry_id = ANY(${ids}) OR a.reimbursed_entry_id = ANY(${ids}))
      ORDER BY a.created_at ASC
    `;
    const allocationView = (row: (typeof allocations)[number], counterpartId: string) => ({
      transactionId: counterpartId,
      amountBase: Number(row.amountBase || 0),
      reimbursingLocalAmount: Number(row.reimbursingLocalAmount || 0),
      reimbursedLocalAmount: Number(row.reimbursedLocalAmount || 0),
      reimbursingCurrency: row.reimbursingCurrency,
      reimbursedCurrency: row.reimbursedCurrency,
      reimbursingFxRate: Number(row.reimbursingFxRate || 0),
      reimbursedFxRate: Number(row.reimbursedFxRate || 0),
    });

    for (const entry of entries) {
      const metadata =
        entry.metadata && typeof entry.metadata === "object"
          ? { ...(entry.metadata as Record<string, unknown>) }
          : {};
      const previous = TripRepository.parseTripEntryLinkage(metadata.linkage);
      if (entry.type === "reimbursement") {
        const own = allocations.filter((row) => row.reimbursementEntryId === entry.id);
        if (!own.length && !previous) continue;
        const allocatedBase = own.reduce((sum, row) => sum + Number(row.amountBase || 0), 0);
        metadata.linkage = {
          type: "reimbursement",
          reimbursesAllocations: own.map((row) => allocationView(row, row.reimbursedEntryId)),
          leftoverBaseAmount: calculateReimbursementLeftoverBase({
            reimbursementBaseAmount: Number(entry.baseAmount || 0),
            allocationBaseAmounts: [allocatedBase],
          }),
          leftoverCategoryId: previous?.leftoverCategoryId ?? null,
        } as TripEntryLinkage;
      } else {
        const own = allocations.filter((row) => row.reimbursedEntryId === entry.id);
        if (own.length) {
          metadata.linkage = {
            type: "reimbursed",
            reimbursedByAllocations: own.map((row) => allocationView(row, row.reimbursementEntryId)),
          } satisfies TripEntryLinkage;
        } else if (previous?.type === "reimbursed") {
          delete metadata.linkage;
        } else {
          continue;
        }
      }
      await tx.$executeRaw`
        UPDATE trip_entries
        SET metadata = ${metadata as Prisma.InputJsonValue}
        WHERE id = ${entry.id} AND trip_id = ${tripId}
      `;
    }
  }

  private static parseTripEntryLinkage(raw: unknown): TripEntryLinkage | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Record<string, unknown>;
    const type = String(candidate.type || "").toLowerCase();
    if (type !== "reimbursement" && type !== "reimbursed") return null;
    return {
      type,
      reimbursesAllocations: Array.isArray(candidate.reimbursesAllocations)
        ? (candidate.reimbursesAllocations as TripEntryLinkage["reimbursesAllocations"])
        : undefined,
      reimbursedByAllocations: Array.isArray(candidate.reimbursedByAllocations)
        ? (candidate.reimbursedByAllocations as TripEntryLinkage["reimbursedByAllocations"])
        : undefined,
      leftoverBaseAmount:
        candidate.leftoverBaseAmount !== undefined
          ? Number(candidate.leftoverBaseAmount)
          : undefined,
      leftoverCategoryId:
        candidate.leftoverCategoryId === null ||
        candidate.leftoverCategoryId === undefined
          ? null
          : String(candidate.leftoverCategoryId),
    };
  }

  private static normalizeTripReimbursementAllocations(
    allocations: TripReimbursementAllocationInput[],
  ) {
    const byTargetKey = new Map<string, number>();
    for (const item of allocations || []) {
      const amountBase = Number(item.amountBase || 0);
      if (!(amountBase > 0)) continue;
      const key = item.transactionId
        ? `tx:${item.transactionId}`
        : typeof item.pendingBatchIndex === "number"
          ? `batch:${item.pendingBatchIndex}`
          : "";
      if (!key) continue;
      byTargetKey.set(
        key,
        Number(((byTargetKey.get(key) || 0) + amountBase).toFixed(4)),
      );
    }
    return Array.from(byTargetKey.entries()).map(([key, amountBase]) => {
      if (key.startsWith("tx:")) {
        return { transactionId: key.slice(3), amountBase };
      }
      return { pendingBatchIndex: Number(key.slice(6)), amountBase };
    });
  }

  private static async getTripTargetReimbursementCapacityBase(
    tx: Prisma.TransactionClient,
    tripId: string,
    reimbursedEntryId: string,
    excludeReimbursementEntryId?: string,
  ) {
    const [target] = await tx.$queryRaw<Array<{ baseAmount: unknown; type: string }>>`
      SELECT base_amount AS "baseAmount", type
      FROM trip_entries
      WHERE id = ${reimbursedEntryId} AND trip_id = ${tripId}
      LIMIT 1
    `;
    if (!target) {
      throw new Error(`Target trip entry ${reimbursedEntryId} not found`);
    }
    if (target.type !== "spending") {
      throw new Error("Only spending trip entries can be reimbursed");
    }

    const [allocated] = await tx.$queryRaw<Array<{ allocated: unknown }>>`
      SELECT COALESCE(SUM(amount_base), 0) AS allocated
      FROM trip_reimbursement_allocations
      WHERE
        trip_id = ${tripId}
        AND reimbursed_entry_id = ${reimbursedEntryId}
        AND (${excludeReimbursementEntryId || null}::text IS NULL OR reimbursement_entry_id <> ${excludeReimbursementEntryId || null})
    `;
    // Parts of the entry shared with other members are theirs to be reimbursed for.
    const [shared] = await tx.$queryRaw<Array<{ shared: unknown }>>`
      SELECT COALESCE(SUM(base_amount), 0) AS shared FROM trip_entries WHERE shared_from_entry_id = ${reimbursedEntryId}
    `;
    const targetBase = Math.max(Number(target.baseAmount || 0) - Number(shared?.shared || 0), 0);
    const allocatedBase = Number(allocated?.allocated || 0);
    return {
      targetBase,
      allocatedBase,
      remainingBase: Number(Math.max(targetBase - allocatedBase, 0).toFixed(4)),
    };
  }

  private static async ensureMainReimbursementCategoryTx(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const [existing] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM categories
      WHERE user_id = ${userId} AND LOWER(name) = 'reimbursement'
      LIMIT 1
    `;
    if (existing?.id) return existing.id;

    const [created] = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO categories (
        id,
        user_id,
        name,
        color,
        created_at,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${userId},
        ${"Reimbursement"},
        ${"#22c55e"},
        NOW(),
        NOW()
      )
      RETURNING id
    `;
    return created.id;
  }

  /**
   * Marks the bank credit behind a trip reimbursement as a main-ledger reimbursement and
   * links it, through the links service, to the bank expenses behind the trip entries it
   * reimburses. The previous category is kept so the sync can be undone. Credits the user
   * already linked or marked internal are left alone.
   */
  private static async syncTripReimbursementToBankLedgerTx(
    tx: Prisma.TransactionClient,
    userId: string,
    bankTransactionId: string,
    source: { tripId: string; tripEntryId: string },
  ) {
    const transaction = await tx.transaction.findFirst({
      where: { id: bankTransactionId, userId },
      select: { id: true, amountIn: true, linkage: true, categoryId: true, currency: true },
    });
    if (!transaction || !(Number(transaction.amountIn || 0) > 0)) return false;

    const existing =
      transaction.linkage && typeof transaction.linkage === "object" && !Array.isArray(transaction.linkage)
        ? (transaction.linkage as Record<string, unknown>)
        : null;
    const existingSync =
      existing?.detectionReason === "trip_sync" && existing.tripSync && typeof existing.tripSync === "object"
        ? (existing.tripSync as Record<string, unknown>)
        : null;
    if (existing && !existingSync) return false;

    const [trip] = await tx.$queryRaw<Array<{ baseCurrency: string }>>`
      SELECT base_currency AS "baseCurrency" FROM trips WHERE id = ${source.tripId} AND user_id = ${userId}
    `;
    const expenses = await tx.$queryRaw<Array<{ transactionId: string; amountBase: unknown }>>`
      SELECT te.source_transaction_id AS "transactionId", SUM(a.amount_base) AS "amountBase"
      FROM trip_reimbursement_allocations a
      INNER JOIN trip_entries te ON te.id = a.reimbursed_entry_id
      WHERE a.trip_id = ${source.tripId}
        AND a.reimbursement_entry_id = ${source.tripEntryId}
        AND te.source_transaction_id IS NOT NULL
      GROUP BY te.source_transaction_id
    `;

    const reimbursementCategoryId = await TripRepository.ensureMainReimbursementCategoryTx(tx, userId);
    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        categoryId: reimbursementCategoryId,
        linkage: {
          type: "reimbursement",
          leftoverCategoryId: null,
          autoDetected: false,
          detectionReason: "trip_sync",
          tripSync: {
            tripId: source.tripId,
            tripEntryId: source.tripEntryId,
            previousCategoryId: existingSync
              ? (existingSync.previousCategoryId ?? null)
              : transaction.categoryId,
          },
        } as Prisma.InputJsonValue,
      },
    });

    // Amounts only carry across when the trip and the bank account share a currency.
    const sameCurrency =
      !!trip && trip.baseCurrency.toUpperCase() === String(transaction.currency || "").toUpperCase();
    const links = sameCurrency
      ? expenses
          .map((row) => ({ other: { transactionId: row.transactionId }, amount: Number(row.amountBase || 0) }))
          .filter((row) => row.amount > 0)
      : [];
    try {
      await replaceLinks(tx, userId, {
        subject: { transactionId: transaction.id },
        role: "reimbursement",
        links,
      });
    } catch (error) {
      // An expense already reimbursed elsewhere keeps its links; the credit stays leftover.
      if (!(error instanceof LinkError)) throw error;
      await replaceLinks(tx, userId, {
        subject: { transactionId: transaction.id },
        role: "reimbursement",
        links: [],
      });
    }
    await syncTransactionCaches(tx, userId, [transaction.id]);
    return true;
  }

  /**
   * Undoes `syncTripReimbursementToBankLedgerTx` for bank credits synced from the given
   * trip entries: removes their links and restores the category they had before.
   */
  private static async releaseTripSyncedBankTransactionsTx(
    tx: Prisma.TransactionClient,
    userId: string,
    tripId: string,
    tripEntryIds: string[],
  ) {
    if (!tripEntryIds.length) return;
    const synced = await tx.$queryRaw<Array<{ id: string; linkage: unknown }>>`
      SELECT id, linkage
      FROM transactions
      WHERE user_id = ${userId}
        AND linkage->>'detectionReason' = 'trip_sync'
        AND linkage->'tripSync'->>'tripId' = ${tripId}
        AND linkage->'tripSync'->>'tripEntryId' = ANY(${tripEntryIds})
    `;
    for (const row of synced) {
      const tripSync = ((row.linkage as Record<string, unknown>)?.tripSync || {}) as Record<string, unknown>;
      await deleteRoleLinks(tx, userId, { transactionId: row.id }, "reimbursement");
      await tx.transaction.update({
        where: { id: row.id },
        data: {
          categoryId: (tripSync.previousCategoryId as string | null | undefined) ?? null,
          linkage: Prisma.DbNull,
        },
      });
    }
  }

  private static async applyTripReimbursementAllocations(
    tx: Prisma.TransactionClient,
    userId: string,
    tripId: string,
    reimbursementEntryId: string,
    allocations: Array<{ transactionId: string; amountBase: number }>,
    leftoverCategoryId?: string | null,
    valuation?: {
      reimbursementBaseAmount?: number | null;
      reimbursingFxRate?: number | null;
    },
    options?: {
      syncToBankLedger?: boolean;
    },
  ) {
    const [reimbursementRow] = await tx.$queryRaw<
      Array<{
        id: string;
        type: string;
        baseAmount: unknown;
        localAmount: unknown;
        localCurrency: string;
        fxRate: unknown;
        metadata: unknown;
      }>
    >`
      SELECT
        id,
        type,
        base_amount AS "baseAmount",
        local_amount AS "localAmount",
        local_currency AS "localCurrency",
        fx_rate AS "fxRate",
        metadata
      FROM trip_entries
      WHERE id = ${reimbursementEntryId} AND trip_id = ${tripId}
      LIMIT 1
      FOR UPDATE
    `;
    if (!reimbursementRow) {
      throw new Error("Reimbursement entry not found");
    }
    if (reimbursementRow.type !== "reimbursement") {
      throw new Error("Only reimbursement entries can reimburse other entries");
    }

    const reimbursementLocalAmount = Number(reimbursementRow.localAmount || 0);
    const requestedBaseAmount =
      valuation?.reimbursementBaseAmount === null ||
      valuation?.reimbursementBaseAmount === undefined
        ? null
        : Number(valuation.reimbursementBaseAmount);
    const requestedFxRate =
      valuation?.reimbursingFxRate === null ||
      valuation?.reimbursingFxRate === undefined
        ? null
        : Number(valuation.reimbursingFxRate);

    if (requestedBaseAmount !== null && !(requestedBaseAmount > 0)) {
      throw new Error("Reimbursement base amount must be greater than 0");
    }
    if (requestedFxRate !== null && !(requestedFxRate > 0)) {
      throw new Error("Reimbursement FX rate must be greater than 0");
    }
    if (requestedFxRate !== null && !(reimbursementLocalAmount > 0)) {
      throw new Error(
        "Cannot apply reimbursement FX rate because local amount is not greater than 0",
      );
    }
    if (
      requestedBaseAmount !== null &&
      requestedFxRate !== null &&
      reimbursementLocalAmount > 0 &&
      Math.abs(requestedBaseAmount - reimbursementLocalAmount * requestedFxRate) > 0.01
    ) {
      throw new Error(
        "Reimbursement base amount and FX rate are inconsistent with local amount",
      );
    }

    let reimbursementBase = Number(reimbursementRow.baseAmount || 0);
    if (requestedBaseAmount !== null) {
      reimbursementBase = requestedBaseAmount;
    } else if (requestedFxRate !== null && reimbursementLocalAmount > 0) {
      reimbursementBase = reimbursementLocalAmount * requestedFxRate;
    }

    let reimbursementFxRate =
      reimbursementLocalAmount > 0
        ? reimbursementBase / reimbursementLocalAmount
        : Number(reimbursementRow.fxRate || 1) || 1;
    if (requestedFxRate !== null) {
      reimbursementFxRate = requestedFxRate;
    }

    const valuationRequested = requestedBaseAmount !== null || requestedFxRate !== null;
    if (
      valuationRequested ||
      Math.abs(Number(reimbursementRow.baseAmount || 0) - reimbursementBase) > 0.0001 ||
      Math.abs((Number(reimbursementRow.fxRate || 1) || 1) - reimbursementFxRate) > 0.0000001
    ) {
      await tx.$executeRaw`
        UPDATE trip_entries
        SET
          base_amount = ${TripRepository.roundMoney(reimbursementBase)},
          fx_rate = ${TripRepository.roundRate(reimbursementFxRate)}
        WHERE id = ${reimbursementEntryId} AND trip_id = ${tripId}
      `;
    }

    if (!(reimbursementBase > 0)) {
      throw new Error("Reimbursement entry has no allocatable base amount");
    }
    const reimbursingLocalAmount = reimbursementLocalAmount;
    const reimbursingFxRate = reimbursementFxRate;

    const normalized = TripRepository.normalizeTripReimbursementAllocations(
      allocations.map((item) => ({
        transactionId: item.transactionId,
        amountBase: item.amountBase,
      })),
    ).filter(
      (item): item is { transactionId: string; amountBase: number } =>
        !!item.transactionId && item.amountBase > 0,
    );

    const totalRequestedBase = normalized.reduce(
      (sum, item) => sum + item.amountBase,
      0,
    );
    if (totalRequestedBase - reimbursementBase > 0.0001) {
      throw new Error(
        "Total reimbursed base amount cannot exceed reimbursement base amount",
      );
    }

    const previousAllocationRows = await tx.$queryRaw<
      Array<{ reimbursedEntryId: string }>
    >`
      SELECT reimbursed_entry_id AS "reimbursedEntryId"
      FROM trip_reimbursement_allocations
      WHERE trip_id = ${tripId} AND reimbursement_entry_id = ${reimbursementEntryId}
    `;
    const impactedEntryIds = collectImpactedReimbursementEntryIds({
      reimbursementEntryId,
      previousTargetIds: previousAllocationRows.map((row) => row.reimbursedEntryId),
      nextTargetIds: normalized.map((row) => row.transactionId),
    });

    await tx.$executeRaw`
      DELETE FROM trip_reimbursement_allocations
      WHERE trip_id = ${tripId} AND reimbursement_entry_id = ${reimbursementEntryId}
    `;

    // Lock the targets so concurrent links cannot both pass the capacity check.
    const targetIds = normalized.map((item) => item.transactionId);
    if (targetIds.length) {
      await tx.$queryRaw`
        SELECT id FROM trip_entries
        WHERE trip_id = ${tripId} AND id = ANY(${targetIds})
        ORDER BY id
        FOR UPDATE
      `;
    }

    for (const item of normalized) {
      if (item.transactionId === reimbursementEntryId) {
        throw new Error("A trip entry cannot reimburse itself");
      }

      const capacity = await TripRepository.getTripTargetReimbursementCapacityBase(
        tx,
        tripId,
        item.transactionId,
        reimbursementEntryId,
      );
      if (item.amountBase - capacity.remainingBase > 0.0001) {
        throw new Error(
          `Reimbursed base amount exceeds remaining amount for entry ${item.transactionId}`,
        );
      }

      const [target] = await tx.$queryRaw<
        Array<{
          baseAmount: unknown;
          localAmount: unknown;
          localCurrency: string;
          fxRate: unknown;
          metadata: unknown;
        }>
      >`
        SELECT
          base_amount AS "baseAmount",
          local_amount AS "localAmount",
          local_currency AS "localCurrency",
          fx_rate AS "fxRate",
          metadata
        FROM trip_entries
        WHERE id = ${item.transactionId} AND trip_id = ${tripId}
        LIMIT 1
      `;
      if (!target) {
        throw new Error("Reimbursed entry not found");
      }

      const reimbursedLocalAmountRaw = Number(target.localAmount || 0);
      const reimbursedBaseAmountRaw = Number(target.baseAmount || 0);
      const reimbursedFxRate =
        reimbursedLocalAmountRaw > 0
          ? reimbursedBaseAmountRaw / reimbursedLocalAmountRaw
          : Number(target.fxRate || 1) || 1;
      const reimbursingLocalUsed =
        reimbursingFxRate > 0 ? item.amountBase / reimbursingFxRate : 0;
      const reimbursedLocalCovered =
        reimbursedFxRate > 0 ? item.amountBase / reimbursedFxRate : 0;

      await tx.$executeRaw`
        INSERT INTO trip_reimbursement_allocations (
          id,
          trip_id,
          reimbursement_entry_id,
          reimbursed_entry_id,
          amount_base,
          reimbursing_local_amount,
          reimbursed_local_amount,
          reimbursing_fx_rate,
          reimbursed_fx_rate,
          created_at
        )
        VALUES (
          ${randomUUID()},
          ${tripId},
          ${reimbursementEntryId},
          ${item.transactionId},
          ${TripRepository.roundMoney(item.amountBase)},
          ${TripRepository.roundMoney(reimbursingLocalUsed)},
          ${TripRepository.roundMoney(reimbursedLocalCovered)},
          ${TripRepository.roundRate(reimbursingFxRate)},
          ${TripRepository.roundRate(reimbursedFxRate)},
          NOW()
        )
      `;
    }

    const [allocationRows] = await Promise.all([
      tx.$queryRaw<
        Array<{
          reimbursedEntryId: string;
          amountBase: unknown;
          reimbursingLocalAmount: unknown;
          reimbursedLocalAmount: unknown;
          reimbursingFxRate: unknown;
          reimbursedFxRate: unknown;
          reimbursedCurrency: string;
        }>
      >`
        SELECT
          a.reimbursed_entry_id AS "reimbursedEntryId",
          a.amount_base AS "amountBase",
          a.reimbursing_local_amount AS "reimbursingLocalAmount",
          a.reimbursed_local_amount AS "reimbursedLocalAmount",
          a.reimbursing_fx_rate AS "reimbursingFxRate",
          a.reimbursed_fx_rate AS "reimbursedFxRate",
          te.local_currency AS "reimbursedCurrency"
        FROM trip_reimbursement_allocations a
        INNER JOIN trip_entries te ON te.id = a.reimbursed_entry_id
        WHERE a.trip_id = ${tripId} AND a.reimbursement_entry_id = ${reimbursementEntryId}
      `,
    ]);

    const allocatedBase = allocationRows.reduce(
      (sum, row) => sum + Number(row.amountBase || 0),
      0,
    );
    const reimbursementMetadata =
      reimbursementRow.metadata && typeof reimbursementRow.metadata === "object"
        ? { ...(reimbursementRow.metadata as Record<string, unknown>) }
        : {};
    // A value the user chose must survive later wallet recalculations.
    if (valuationRequested) reimbursementMetadata.baseAmountLocked = true;
    reimbursementMetadata.linkage = {
      type: "reimbursement",
      reimbursesAllocations: allocationRows.map((row) => ({
        transactionId: row.reimbursedEntryId,
        amountBase: Number(row.amountBase || 0),
        reimbursingLocalAmount: Number(row.reimbursingLocalAmount || 0),
        reimbursedLocalAmount: Number(row.reimbursedLocalAmount || 0),
        reimbursingCurrency: reimbursementRow.localCurrency,
        reimbursedCurrency: row.reimbursedCurrency,
        reimbursingFxRate: Number(row.reimbursingFxRate || 0),
        reimbursedFxRate: Number(row.reimbursedFxRate || 0),
      })),
      leftoverBaseAmount: calculateReimbursementLeftoverBase({
        reimbursementBaseAmount: reimbursementBase,
        allocationBaseAmounts: [allocatedBase],
      }),
      leftoverCategoryId: leftoverCategoryId ?? null,
    } as TripEntryLinkage;

    await tx.$executeRaw`
      UPDATE trip_entries
      SET metadata = ${reimbursementMetadata as Prisma.InputJsonValue}
      WHERE id = ${reimbursementEntryId} AND trip_id = ${tripId}
    `;

    const impactedTargetIds = impactedEntryIds.filter(
      (id) => id !== reimbursementEntryId,
    );
    for (const targetId of impactedTargetIds) {
      const targetMetadataRow = await tx.$queryRaw<Array<{ metadata: unknown; localCurrency: string }>>`
        SELECT metadata, local_currency AS "localCurrency"
        FROM trip_entries
        WHERE id = ${targetId} AND trip_id = ${tripId}
        LIMIT 1
      `;
      const targetMetadata =
        targetMetadataRow[0]?.metadata &&
        typeof targetMetadataRow[0].metadata === "object"
          ? { ...(targetMetadataRow[0].metadata as Record<string, unknown>) }
          : {};
      const targetAllocRows = await tx.$queryRaw<
        Array<{
          reimbursementEntryId: string;
          amountBase: unknown;
          reimbursingLocalAmount: unknown;
          reimbursedLocalAmount: unknown;
          reimbursingFxRate: unknown;
          reimbursedFxRate: unknown;
          reimbursingCurrency: string;
        }>
      >`
        SELECT
          a.reimbursement_entry_id AS "reimbursementEntryId",
          a.amount_base AS "amountBase",
          a.reimbursing_local_amount AS "reimbursingLocalAmount",
          a.reimbursed_local_amount AS "reimbursedLocalAmount",
          a.reimbursing_fx_rate AS "reimbursingFxRate",
          a.reimbursed_fx_rate AS "reimbursedFxRate",
          re.local_currency AS "reimbursingCurrency"
        FROM trip_reimbursement_allocations a
        INNER JOIN trip_entries re ON re.id = a.reimbursement_entry_id
        WHERE a.trip_id = ${tripId} AND a.reimbursed_entry_id = ${targetId}
      `;

      if (targetAllocRows.length > 0) {
        targetMetadata.linkage = {
          type: "reimbursed",
          reimbursedByAllocations: targetAllocRows.map((row) => ({
            transactionId: row.reimbursementEntryId,
            amountBase: Number(row.amountBase || 0),
            reimbursingLocalAmount: Number(row.reimbursingLocalAmount || 0),
            reimbursedLocalAmount: Number(row.reimbursedLocalAmount || 0),
            reimbursingCurrency: row.reimbursingCurrency,
            reimbursedCurrency: targetMetadataRow[0]?.localCurrency,
            reimbursingFxRate: Number(row.reimbursingFxRate || 0),
            reimbursedFxRate: Number(row.reimbursedFxRate || 0),
          })),
        } satisfies TripEntryLinkage;
      } else {
        delete targetMetadata.linkage;
      }

      await tx.$executeRaw`
        UPDATE trip_entries
        SET metadata = ${targetMetadata as Prisma.InputJsonValue}
        WHERE id = ${targetId} AND trip_id = ${tripId}
      `;
    }

    if (options?.syncToBankLedger) {
      const [sourceRow] = await tx.$queryRaw<
        Array<{ sourceTransactionId: string | null }>
      >`
        SELECT source_transaction_id AS "sourceTransactionId"
        FROM trip_entries
        WHERE id = ${reimbursementEntryId} AND trip_id = ${tripId}
        LIMIT 1
      `;
      if (sourceRow?.sourceTransactionId) {
        await TripRepository.syncTripReimbursementToBankLedgerTx(
          tx,
          userId,
          sourceRow.sourceTransactionId,
          { tripId, tripEntryId: reimbursementEntryId },
        );
      }
    }
  }

  static async createTrip(userId: string, data: {
    name: string;
    coverImageUrl?: string | null;
    baseCurrency: string;
    startDate: Date;
    endDate?: Date | null;
    status?: string;
    notes?: string | null;
  }) {
    const userBaseCurrency = await TripRepository.getUserBaseCurrency(userId);
    const baseCurrency = normalizeCurrencyCode(
      data.baseCurrency,
      userBaseCurrency,
    );
    const id = randomUUID();
    const [trip] = await prisma.$queryRaw<any[]>`
      INSERT INTO trips (
        id,
        user_id,
        name,
        cover_image_url,
        base_currency,
        start_date,
        end_date,
        status,
        notes,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${userId},
        ${data.name},
        ${data.coverImageUrl ?? null},
        ${baseCurrency},
        ${data.startDate},
        ${data.endDate ?? null},
        ${data.status ?? "active"},
        ${data.notes ?? null},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        user_id AS "userId",
        name,
        cover_image_url AS "coverImageUrl",
        base_currency AS "baseCurrency",
        start_date AS "startDate",
        end_date AS "endDate",
        status,
        notes,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    return TripRepository.mapTrip(trip);
  }

  static async findMany(userId: string) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        id,
        user_id AS "userId",
        name,
        cover_image_url AS "coverImageUrl",
        base_currency AS "baseCurrency",
        start_date AS "startDate",
        end_date AS "endDate",
        status,
        notes,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM trips
      WHERE user_id = ${userId}
      ORDER BY start_date DESC
    `;
    const sharing = await TripSharingRepository.sharingSummaries(userId);
    return rows.map((row) => ({ ...TripRepository.mapTrip(row), sharing: sharing.get(row.id) ?? null }));
  }

  static async findById(userId: string, tripId: string) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        id,
        user_id AS "userId",
        name,
        cover_image_url AS "coverImageUrl",
        base_currency AS "baseCurrency",
        start_date AS "startDate",
        end_date AS "endDate",
        status,
        notes,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!rows[0]) return null;
    const sharing = await TripSharingRepository.sharingSummaries(userId);
    return { ...TripRepository.mapTrip(rows[0]), sharing: sharing.get(tripId) ?? null };
  }

  static async updateTrip(
    userId: string,
    tripId: string,
    data: {
      name?: string;
      coverImageUrl?: string | null;
      baseCurrency?: string | null;
      startDate?: Date;
      endDate?: Date | null;
      status?: string;
      notes?: string | null;
    },
  ) {
    const existing = await prisma.$queryRaw<
      Array<{ id: string; baseCurrency: string; startDate: Date; endDate: Date | null; hasActivity: boolean }>
    >`
      SELECT
        t.id,
        t.base_currency AS "baseCurrency",
        t.start_date AS "startDate",
        t.end_date AS "endDate",
        (
          EXISTS (SELECT 1 FROM trip_entries te WHERE te.trip_id = t.id)
          OR EXISTS (SELECT 1 FROM trip_fundings tf WHERE tf.trip_id = t.id)
        ) AS "hasActivity"
      FROM trips t
      WHERE t.id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;
    if (!existing[0]) {
      throw new Error("Trip not found or unauthorized");
    }

    const baseCurrency = normalizeOptionalCurrencyUpdate(data.baseCurrency);
    const sharedGroupId = await TripSharingRepository.beforeTripUpdateTx(prisma, userId, tripId, {
      ...data,
      baseCurrency,
    });
    // Stored base amounts are in the trip's currency; relabelling them would be wrong.
    if (
      baseCurrency &&
      baseCurrency !== existing[0].baseCurrency.toUpperCase() &&
      existing[0].hasActivity
    ) {
      throw Object.assign(
        new Error("The base currency can't change once the trip has transactions or funding."),
        { status: 409 },
      );
    }
    const nextStart = data.startDate ?? existing[0].startDate;
    const nextEnd = data.endDate === undefined ? existing[0].endDate : data.endDate;
    if (nextEnd && nextEnd.getTime() < new Date(nextStart).getTime()) {
      throw Object.assign(new Error("The end date can't be before the start date."), { status: 400 });
    }

    const [trip] = await prisma.$queryRaw<any[]>`
      UPDATE trips
      SET
        name = COALESCE(${data.name ?? null}, name),
        cover_image_url = ${data.coverImageUrl === undefined ? Prisma.sql`cover_image_url` : data.coverImageUrl},
        base_currency = ${baseCurrency ? baseCurrency : Prisma.sql`base_currency`},
        start_date = COALESCE(${data.startDate ?? null}, start_date),
        end_date = ${data.endDate === undefined ? Prisma.sql`end_date` : data.endDate},
        status = COALESCE(${data.status ?? null}, status),
        notes = ${data.notes === undefined ? Prisma.sql`notes` : data.notes},
        updated_at = NOW()
      WHERE id = ${tripId} AND user_id = ${userId}
      RETURNING
        id,
        user_id AS "userId",
        name,
        cover_image_url AS "coverImageUrl",
        base_currency AS "baseCurrency",
        start_date AS "startDate",
        end_date AS "endDate",
        status,
        notes,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
    if (sharedGroupId) {
      await prisma.$transaction((tx) => TripSharingRepository.syncSharedDetailsTx(tx, sharedGroupId, tripId));
    }

    return TripRepository.mapTrip(trip);
  }

  static async deleteTrip(userId: string, tripId: string) {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!existing[0]) {
      throw new Error("Trip not found or unauthorized");
    }

    const recalcTargets = await prisma.$transaction(async (tx) => {
      await TripSharingRepository.beforeTripDeleteTx(tx, userId, tripId);
      const entryIds = (
        await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM trip_entries WHERE trip_id = ${tripId}`
      ).map((row) => row.id);
      await TripRepository.releaseTripSyncedBankTransactionsTx(tx, userId, tripId, entryIds);
      // Money this trip sent to other trips no longer exists there either.
      const linkedTargets = (
        await TripRepository.deleteLinkedFundingsFromTripOutgoingTx(tx, userId, entryIds)
      ).filter((target) => target.tripId !== tripId);
      // Trips that sent money here keep the outflow, now pointing nowhere in particular.
      await tx.$executeRaw`
        UPDATE trip_entries src
        SET metadata = jsonb_set(
          jsonb_set(src.metadata, '{fundingOut,destinationType}', '"external"'::jsonb),
          '{fundingOut,destinationTripId}', 'null'::jsonb
        )
        FROM trip_fundings tf
        WHERE
          tf.trip_id = ${tripId}
          AND tf.source_type = 'from_trip_outgoing'
          AND src.id = tf.metadata->>'sourceTripEntryId'
          AND src.trip_id <> ${tripId}
          AND src.metadata ? 'fundingOut'
      `;
      await tx.$executeRaw`
        DELETE FROM trip_entries
        WHERE trip_id = ${tripId}
      `;
      await tx.$executeRaw`
        DELETE FROM trip_fundings
        WHERE trip_id = ${tripId}
      `;
      await tx.$executeRaw`
        DELETE FROM wallets
        WHERE trip_id = ${tripId}
      `;
      await tx.$executeRaw`
        DELETE FROM trips
        WHERE id = ${tripId} AND user_id = ${userId}
      `;
      return linkedTargets;
    });

    await Promise.all(
      recalcTargets.map((target) =>
        TripRepository.recalculateWalletEntriesToBase(userId, target.tripId, target.walletId, {
          mode: "weighted",
        }).catch(TripRepository.recalcFailed),
      ),
    );

    return { success: true };
  }

  static async getFundingsByTrip(userId: string, tripId: string) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        tf.id,
        tf.trip_id AS "tripId",
        tf.wallet_id AS "walletId",
        tf.entry_id AS "entryId",
        tf.bank_transaction_id AS "bankTransactionId",
        tf.source_type AS "sourceType",
        tf.source_currency AS "sourceCurrency",
        tf.source_amount AS "sourceAmount",
        tf.destination_currency AS "destinationCurrency",
        tf.destination_amount AS "destinationAmount",
        tf.fx_rate AS "fxRate",
        tf.base_amount AS "baseAmount",
        tf.fee_amount AS "feeAmount",
        tf.fee_currency AS "feeCurrency",
        tf.metadata,
        tf.created_at AS "createdAt",
        t.name AS "tripName",
        w.name AS "walletName",
        w.currency AS "walletCurrency",
        w.color AS "walletColor",
        bt.date AS "bankTransactionDate",
        bt.description AS "bankTransactionDescription",
        bt.amount_in AS "bankTransactionAmountIn",
        bt.amount_out AS "bankTransactionAmountOut",
        sbt.id AS "suggestedBankTransactionId",
        sbt.date AS "suggestedBankTransactionDate",
        sbt.description AS "suggestedBankTransactionDescription",
        sbt.amount_in AS "suggestedBankTransactionAmountIn",
        sbt.amount_out AS "suggestedBankTransactionAmountOut"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      LEFT JOIN wallets w ON w.id = tf.wallet_id
      LEFT JOIN transactions bt ON bt.id = tf.bank_transaction_id
      LEFT JOIN transactions sbt ON sbt.id = NULLIF(tf.metadata->>'autoMatchedBankTransactionId', '')
      WHERE tf.trip_id = ${tripId} AND t.user_id = ${userId}
      ORDER BY tf.created_at DESC
    `;
    return rows.map(TripRepository.mapFunding);
  }

  /**
   * A bank transaction can stand behind only one trip record: a funding, an entry, or
   * the bank side of money sent back. Counting it twice would double trip totals.
   */
  private static async assertBankTransactionAvailable(
    db: Prisma.TransactionClient | typeof prisma,
    userId: string,
    bankTransactionId: string,
    ignore: { fundingId?: string | null; entryIds?: string[] } = {},
  ) {
    const ignoredEntryIds = ignore.entryIds?.length ? ignore.entryIds : ["-"];
    const [used] = await db.$queryRaw<Array<{ tripName: string }>>`
      SELECT t.name AS "tripName"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE t.user_id = ${userId}
        AND tf.bank_transaction_id = ${bankTransactionId}
        AND tf.id <> ${ignore.fundingId || "-"}
      UNION ALL
      SELECT t.name AS "tripName"
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      LEFT JOIN trip_fundings own ON own.entry_id = te.id
      WHERE t.user_id = ${userId}
        AND (
          te.source_transaction_id = ${bankTransactionId}
          OR te.metadata->'fundingOut'->>'bankTransactionId' = ${bankTransactionId}
        )
        AND NOT (te.id = ANY(${ignoredEntryIds}))
        AND (own.id IS NULL OR own.id <> ${ignore.fundingId || "-"})
      LIMIT 1
    `;
    if (used) {
      throw Object.assign(
        new Error(`This bank transaction is already part of the trip "${used.tripName}".`),
        { status: 409 },
      );
    }
  }

  static async createFunding(userId: string, input: {
    tripId: string;
    walletId?: string | null;
    bankTransactionId?: string | null;
    sourceType: string;
    sourceCurrency: string;
    sourceAmount: number;
    destinationCurrency: string;
    destinationAmount: number;
    fxRate?: number | null;
    feeAmount?: number | null;
    feeCurrency?: string | null;
    baseAmount?: number | null;
    metadata?: Prisma.InputJsonValue | null;
  }) {
    const id = randomUUID();
    const trip = await prisma.$queryRaw<Array<{ id: string; baseCurrency: string }>>`
      SELECT id, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${input.tripId} AND user_id = ${userId}
      LIMIT 1
    `;

    if (!trip[0]) {
      throw new Error("Trip not found or unauthorized");
    }

    let bankTransactionDate: Date | null = null;
    let bankTransactionAmountOut: number | null = null;
    let bankTransactionCurrency: string | null = null;
    if (input.bankTransactionId) {
      const transaction = await prisma.$queryRaw<
      Array<{
        id: string;
        date: Date;
        description: string;
        amountOut: unknown;
        currency: string | null;
      }>
      >`
        SELECT
          id,
          date,
          description,
          amount_out AS "amountOut",
          currency
        FROM transactions
        WHERE id = ${input.bankTransactionId} AND user_id = ${userId}
        LIMIT 1
      `;
      if (!transaction[0]) {
        throw new Error("Bank transaction not found or unauthorized");
      }
      await TripRepository.assertBankTransactionAvailable(prisma, userId, input.bankTransactionId);
      const txAmountOut = Number(transaction[0].amountOut || 0);
      if (!(txAmountOut > 0)) {
        throw new Error(
          "Linked bank transaction must be a debit (amount out) for funding in.",
        );
      }
      const txCurrency = String(transaction[0].currency || trip[0].baseCurrency).toUpperCase();
      if (Math.abs(Number(input.sourceAmount || 0) - txAmountOut) > 0.01) {
        throw new Error(
          "Source amount must match the linked bank transaction amount out.",
        );
      }
      if (
        String(input.sourceCurrency || txCurrency).toUpperCase() !== txCurrency
      ) {
        throw new Error(
          "Source currency must match the linked bank transaction currency.",
        );
      }
      bankTransactionDate = transaction[0].date;
      bankTransactionAmountOut = txAmountOut;
      bankTransactionCurrency = txCurrency;
    }

    let walletCurrency: string | null = null;
    if (input.walletId) {
      const wallet = await prisma.$queryRaw<Array<{ id: string; currency: string }>>`
        SELECT w.id
        , w.currency
        FROM wallets w
        INNER JOIN trips t ON t.id = w.trip_id
        WHERE
          w.id = ${input.walletId}
          AND w.trip_id = ${input.tripId}
          AND t.user_id = ${userId}
        LIMIT 1
      `;
      if (!wallet[0]) {
        throw new Error("Wallet not found or unauthorized");
      }
      walletCurrency = String(wallet[0].currency || "").toUpperCase();
    }

    // A wallet holds one currency; funding it in another would skew its average rate.
    if (
      walletCurrency &&
      String(input.destinationCurrency || walletCurrency).toUpperCase() !== walletCurrency
    ) {
      throw new Error("Destination currency must match the destination wallet currency.");
    }

    const metadata: Record<string, unknown> =
      input.metadata && typeof input.metadata === "object"
        ? { ...(input.metadata as Record<string, unknown>) }
        : {};
    const normalizedReviewState = TripRepository.getFundingReviewState({
      metadata,
      sourceType: input.sourceType,
      bankTransactionId: input.bankTransactionId ?? null,
    });
    TripRepository.setFundingReviewState(metadata, normalizedReviewState);

    const normalized = TripRepository.normalizeFundingValues({
      sourceCurrency: bankTransactionCurrency || input.sourceCurrency,
      sourceAmount: bankTransactionAmountOut ?? input.sourceAmount,
      destinationCurrency:
        input.bankTransactionId && walletCurrency
          ? walletCurrency
          : input.destinationCurrency,
      destinationAmount: input.destinationAmount,
      fxRate: input.fxRate ?? null,
      feeAmount: input.feeAmount ?? null,
      feeCurrency: input.feeCurrency ?? null,
      baseCurrency: trip[0].baseCurrency,
      baseAmount: input.baseAmount ?? null,
    });

    const [row] = await prisma.$transaction(async (tx) => {
      const inserted = await tx.$queryRaw<any[]>`
        INSERT INTO trip_fundings (
          id,
          trip_id,
          wallet_id,
          entry_id,
          bank_transaction_id,
          source_type,
          source_currency,
          source_amount,
          destination_currency,
          destination_amount,
          fx_rate,
          base_amount,
          fee_amount,
          fee_currency,
          metadata,
          created_at
        )
        VALUES (
          ${id},
          ${input.tripId},
          ${input.walletId ?? null},
          NULL,
          ${input.bankTransactionId ?? null},
          ${input.sourceType},
          ${normalized.sourceCurrency},
          ${normalized.sourceAmount},
          ${normalized.destinationCurrency},
          ${normalized.destinationAmount},
          ${normalized.fxRate},
          ${normalized.baseAmount},
          ${normalized.feeAmount},
          ${normalized.feeCurrency},
          ${metadata as Prisma.InputJsonValue},
          NOW()
        )
        RETURNING id
      `;

      await TripRepository.upsertFundingEntryTx(tx, userId, input.tripId, id);
      return inserted;
    });

    let propagationTrace: PropagationTrace | null = null;
    if (input.walletId) {
      const recalcResult = await TripRepository.recalculateWalletEntriesToBase(
        userId,
        input.tripId,
        input.walletId,
        {
          mode: "weighted",
        },
      ).catch(TripRepository.recalcFailed);
      propagationTrace = recalcResult?.propagationTrace ?? null;
    }

    const created = await TripRepository.getFundingsByTrip(userId, input.tripId);
    const match = created.find((item) => item.id === row.id);
    if (!match) {
      throw new Error("Failed to create funding");
    }
    return {
      funding: match,
      propagationTrace,
    };
  }

  static async reviewFundingMatch(
    userId: string,
    tripId: string,
    fundingId: string,
    input: {
      action: "accept" | "reject" | "replace";
      bankTransactionId?: string | null;
    },
  ) {
    const fundingRows = await prisma.$queryRaw<
      Array<{
        id: string;
        sourceType: string;
        bankTransactionId: string | null;
        sourceAmount: unknown;
        sourceCurrency: string;
        baseCurrency: string;
        metadata: unknown;
      }>
    >`
      SELECT
        tf.id,
        tf.source_type AS "sourceType",
        tf.bank_transaction_id AS "bankTransactionId",
        tf.source_amount AS "sourceAmount",
        tf.source_currency AS "sourceCurrency",
        t.base_currency AS "baseCurrency",
        tf.metadata
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE
        tf.id = ${fundingId}
        AND tf.trip_id = ${tripId}
        AND t.user_id = ${userId}
      LIMIT 1
    `;

    const funding = fundingRows[0];
    if (!funding) {
      throw new Error("Funding not found or unauthorized");
    }

    const metadata: Record<string, unknown> =
      funding.metadata && typeof funding.metadata === "object"
        ? { ...(funding.metadata as Record<string, unknown>) }
        : {};

    const getOwnedBankTransaction = async (transactionId: string) => {
      const rows = await prisma.$queryRaw<
        Array<{ id: string; amountOut: unknown; currency: string | null }>
      >`
        SELECT
          id,
          amount_out AS "amountOut",
          currency
        FROM transactions
        WHERE id = ${transactionId} AND user_id = ${userId}
        LIMIT 1
      `;
      const transaction = rows[0];
      if (!transaction) {
        throw new Error("Selected bank transaction not found or unauthorized");
      }
      return transaction;
    };

    const validateSelectedBankTransaction = async (transactionId: string) => {
      const transaction = await getOwnedBankTransaction(transactionId);
      validateFundingInBankMatch({
        fundingSourceAmount: Number(funding.sourceAmount || 0),
        fundingSourceCurrency: funding.sourceCurrency,
        bankAmountOut: Number(transaction.amountOut || 0),
        bankCurrency: transaction.currency || funding.baseCurrency,
      });
    };

    const ensureNotAlreadyLinked = (transactionId: string) =>
      TripRepository.assertBankTransactionAvailable(prisma, userId, transactionId, { fundingId });

    let nextBankTransactionId: string | null = funding.bankTransactionId;

    if (funding.sourceType === "opening_balance") {
      if (input.action === "replace") {
        throw new Error("Opening balance suggestions do not support replace linkage.");
      }
      nextBankTransactionId = null;
      TripRepository.setFundingReviewState(
        metadata,
        input.action === "accept" ? "external_confirmed" : "rejected",
        { legacyStatus: input.action === "accept" ? "accepted" : "rejected" },
      );
      metadata.matchReviewedAction = input.action;
    } else if (input.action === "accept") {
      const suggestedId =
        typeof metadata.autoMatchedBankTransactionId === "string"
          ? metadata.autoMatchedBankTransactionId
          : null;
      const selectedId = input.bankTransactionId || suggestedId;
      if (!selectedId) {
        throw new Error("No suggested transaction available to accept.");
      }
      await validateSelectedBankTransaction(selectedId);
      await ensureNotAlreadyLinked(selectedId);
      nextBankTransactionId = selectedId;
      TripRepository.setFundingReviewState(metadata, "linked_confirmed", {
        legacyStatus: "accepted",
      });
      metadata.matchReviewedAction = "accept";
    } else if (input.action === "replace") {
      if (!input.bankTransactionId) {
        throw new Error("Replacement requires a selected transaction.");
      }
      await validateSelectedBankTransaction(input.bankTransactionId);
      await ensureNotAlreadyLinked(input.bankTransactionId);
      nextBankTransactionId = input.bankTransactionId;
      TripRepository.setFundingReviewState(metadata, "linked_confirmed", {
        legacyStatus: "replaced",
      });
      metadata.matchReviewedAction = "replace";
      metadata.replacedBankTransactionId = input.bankTransactionId;
    } else {
      nextBankTransactionId = null;
      // For imported topups/opening balances, rejecting bank linkage means
      // "treat as external/untracked funding source", not "discard funding".
      const rejectState =
        funding.sourceType === "imported_topup" ||
        funding.sourceType === "opening_balance"
          ? "external_confirmed"
          : "rejected";
      TripRepository.setFundingReviewState(metadata, rejectState, {
        legacyStatus: rejectState === "external_confirmed" ? "confirmed" : "rejected",
      });
      metadata.matchReviewedAction = "reject";
    }

    metadata.matchReviewedAt = new Date().toISOString();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE trip_fundings
        SET
          bank_transaction_id = ${nextBankTransactionId},
          metadata = ${metadata as Prisma.InputJsonValue}
        WHERE id = ${fundingId} AND trip_id = ${tripId}
      `;

      await TripRepository.upsertFundingEntryTx(tx, userId, tripId, fundingId);
    });

    const updated = await TripRepository.getFundingsByTrip(userId, tripId);
    const match = updated.find((item) => item.id === fundingId);
    if (!match) {
      throw new Error("Failed to update funding match");
    }
    return match;
  }

  static async mergeImportedFundingIntoExisting(
    userId: string,
    tripId: string,
    importedFundingId: string,
    targetFundingId: string,
  ) {
    if (importedFundingId === targetFundingId) {
      throw new Error("Cannot merge a funding row into itself.");
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        sourceType: string;
        metadata: unknown;
        bankTransactionId: string | null;
      }>
    >`
      SELECT
        tf.id,
        tf.source_type AS "sourceType",
        tf.metadata,
        tf.bank_transaction_id AS "bankTransactionId"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE
        tf.trip_id = ${tripId}
        AND tf.id IN (${importedFundingId}, ${targetFundingId})
        AND t.user_id = ${userId}
    `;

    const source = rows.find((row) => row.id === importedFundingId);
    const target = rows.find((row) => row.id === targetFundingId);

    if (!source || !target) {
      throw new Error("Funding rows not found or unauthorized");
    }

    if (source.sourceType !== "imported_topup") {
      throw new Error("Only imported topup fundings can be merged.");
    }
    if (target.sourceType === "imported_topup") {
      throw new Error("Target funding must be an existing confirmed/manual funding row.");
    }

    const sourceMeta =
      source.metadata && typeof source.metadata === "object"
        ? (source.metadata as Record<string, unknown>)
        : {};
    const targetMeta =
      target.metadata && typeof target.metadata === "object"
        ? { ...(target.metadata as Record<string, unknown>) }
        : {};

    const mergedFrom = Array.isArray(targetMeta.mergedFromFundingIds)
      ? [...targetMeta.mergedFromFundingIds]
      : [];
    mergedFrom.push(importedFundingId);

    targetMeta.mergedFromFundingIds = mergedFrom;
    targetMeta.lastMergedAt = new Date().toISOString();
    targetMeta.lastMergedImportedFunding = {
      id: importedFundingId,
      ...(sourceMeta || {}),
    };

    if (
      !target.bankTransactionId &&
      typeof sourceMeta.autoMatchedBankTransactionId === "string" &&
      sourceMeta.autoMatchedBankTransactionId.length > 0
    ) {
      targetMeta.suggestedBankTransactionIdFromMergedImport =
        sourceMeta.autoMatchedBankTransactionId;
    }

    const sourceFeeEntryId =
      typeof sourceMeta.feeEntryId === "string"
        ? (sourceMeta.feeEntryId as string)
        : null;
    delete targetMeta.feeEntryId;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE trip_fundings
        SET metadata = ${targetMeta as Prisma.InputJsonValue}
        WHERE id = ${targetFundingId} AND trip_id = ${tripId}
      `;

      await TripRepository.upsertFundingEntryTx(tx, userId, tripId, targetFundingId);

      if (sourceFeeEntryId) {
        await tx.$executeRaw`
          DELETE FROM trip_entries
          WHERE id = ${sourceFeeEntryId} AND trip_id = ${tripId}
        `;
      }

      await TripRepository.deleteFundingEntryTx(tx, tripId, importedFundingId);

      await tx.$executeRaw`
        DELETE FROM trip_fundings
        WHERE id = ${importedFundingId} AND trip_id = ${tripId}
      `;
    });

    const updated = await TripRepository.getFundingsByTrip(userId, tripId);
    const match = updated.find((item) => item.id === targetFundingId);
    if (!match) {
      throw new Error("Failed to merge funding rows");
    }
    return match;
  }

  static async updateFunding(
    userId: string,
    tripId: string,
    fundingId: string,
    input: {
      walletId?: string | null;
      sourceCurrency?: string;
      sourceAmount?: number;
      destinationCurrency?: string;
      destinationAmount?: number;
      fxRate?: number | null;
      feeAmount?: number | null;
      feeCurrency?: string | null;
      baseAmount?: number | null;
      metadata?: Record<string, any> | null;
    },
  ) {
    const existing = await prisma.$queryRaw<
      Array<{
        id: string;
        walletId: string | null;
        bankTransactionId: string | null;
        sourceType: string;
        sourceAmount: number;
        sourceCurrency: string;
        destinationAmount: number;
        destinationCurrency: string;
        fxRate: number | null;
        feeAmount: number | null;
        feeCurrency: string | null;
        metadata: unknown;
        bankTransactionDate: Date | null;
        baseCurrency: string;
        baseAmount: number;
      }>
    >`
      SELECT tf.id
      , tf.wallet_id AS "walletId"
      , tf.bank_transaction_id AS "bankTransactionId"
      , tf.source_type AS "sourceType"
      , tf.source_amount AS "sourceAmount"
      , tf.source_currency AS "sourceCurrency"
      , tf.destination_amount AS "destinationAmount"
      , tf.destination_currency AS "destinationCurrency"
      , tf.fx_rate AS "fxRate"
      , tf.fee_amount AS "feeAmount"
      , tf.fee_currency AS "feeCurrency"
      , tf.metadata
      , bt.date AS "bankTransactionDate"
      , t.base_currency AS "baseCurrency"
      , tf.base_amount AS "baseAmount"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      LEFT JOIN transactions bt ON bt.id = tf.bank_transaction_id
      WHERE tf.id = ${fundingId} AND tf.trip_id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;
    if (!existing[0]) {
      throw new Error("Funding not found or unauthorized");
    }

    const current = existing[0];
    const walletId =
      input.walletId === undefined ? current.walletId ?? null : input.walletId ?? null;
    let targetWalletCurrency: string | null = null;
    if (walletId) {
      const walletRows = await prisma.$queryRaw<
        Array<{ id: string; currency: string }>
      >`
        SELECT w.id, w.currency
        FROM wallets w
        INNER JOIN trips t ON t.id = w.trip_id
        WHERE w.id = ${walletId} AND w.trip_id = ${tripId} AND t.user_id = ${userId}
        LIMIT 1
      `;
      if (!walletRows[0]) {
        throw new Error("Wallet not found or unauthorized");
      }
      targetWalletCurrency = String(walletRows[0].currency || "").toUpperCase();
      const requestedDestination = String(
        input.destinationCurrency ?? current.destinationCurrency ?? "",
      ).toUpperCase();
      if (!current.bankTransactionId && requestedDestination !== targetWalletCurrency) {
        throw new Error("Destination currency must match the destination wallet currency.");
      }
    }

    if (current.bankTransactionId) {
      const requestedSourceCurrency =
        input.sourceCurrency === undefined
          ? current.sourceCurrency
          : String(input.sourceCurrency || "").toUpperCase();
      if (
        requestedSourceCurrency &&
        requestedSourceCurrency !== String(current.sourceCurrency || "").toUpperCase()
      ) {
        throw new Error(
          "Source currency cannot be changed for bank-linked funding.",
        );
      }

      if (
        input.sourceAmount !== undefined &&
        Math.abs(Number(input.sourceAmount) - Number(current.sourceAmount || 0)) > 0.0001
      ) {
        throw new Error(
          "Source amount cannot be changed for bank-linked funding.",
        );
      }

      if (!walletId) {
        throw new Error(
          "Bank-linked funding must stay assigned to a destination wallet.",
        );
      }

      if (
        targetWalletCurrency &&
        input.destinationCurrency &&
        String(input.destinationCurrency || "").toUpperCase() !== targetWalletCurrency
      ) {
        throw new Error(
          "Destination currency must match the destination wallet currency for bank-linked funding.",
        );
      }
    }

    const destinationCurrencyForNormalization =
      current.bankTransactionId && targetWalletCurrency
        ? targetWalletCurrency
        : input.destinationCurrency ?? current.destinationCurrency;
    const fundingCoreValueChanged = hasFundingCoreValueChanged({
      current: {
        sourceCurrency: current.sourceCurrency,
        sourceAmount: Number(current.sourceAmount || 0),
        destinationCurrency: current.destinationCurrency,
        destinationAmount: Number(current.destinationAmount || 0),
        fxRate: current.fxRate ?? null,
      },
      next: {
        sourceCurrency: input.sourceCurrency,
        sourceAmount: input.sourceAmount,
        destinationCurrency:
          current.bankTransactionId && targetWalletCurrency
            ? targetWalletCurrency
            : input.destinationCurrency,
        destinationAmount: input.destinationAmount,
        fxRate: input.fxRate,
      },
    });
    const shouldPreserveExistingBaseAmount = shouldPreserveFundingBaseAmount({
      fundingCoreValueChanged,
      sourceCurrency: input.sourceCurrency ?? current.sourceCurrency,
      destinationCurrency: destinationCurrencyForNormalization,
      baseCurrency: current.baseCurrency,
    });

    const normalized = TripRepository.normalizeFundingValues({
      sourceCurrency: input.sourceCurrency ?? current.sourceCurrency,
      sourceAmount: Number(input.sourceAmount ?? current.sourceAmount),
      destinationCurrency: destinationCurrencyForNormalization,
      destinationAmount:
        input.destinationAmount === undefined
          ? Number(current.destinationAmount)
          : Number(input.destinationAmount),
      // Stored amounts are authoritative; echoing a rounded stored rate back would make
      // them look inconsistent, so the rate is re-derived unless the caller sends one.
      fxRate: input.fxRate === undefined ? null : (input.fxRate ?? null),
      feeAmount:
        input.feeAmount === undefined ? (current.feeAmount ?? null) : input.feeAmount,
      feeCurrency:
        input.feeCurrency === undefined ? (current.feeCurrency ?? null) : input.feeCurrency,
      baseCurrency: current.baseCurrency,
      baseAmount:
        input.baseAmount !== undefined && input.baseAmount !== null
          ? input.baseAmount
          : shouldPreserveExistingBaseAmount
            ? current.baseAmount
            : null,
    });

    const existingMetadata: Record<string, unknown> =
      current.metadata && typeof current.metadata === "object"
        ? { ...(current.metadata as Record<string, unknown>) }
        : {};
    const nextMetadata: Record<string, unknown> =
      input.metadata === undefined
        ? { ...existingMetadata }
        : input.metadata && typeof input.metadata === "object"
          ? { ...(input.metadata as Record<string, unknown>) }
          : {};
    const previousFeeEntryId =
      typeof existingMetadata.feeEntryId === "string"
        ? (existingMetadata.feeEntryId as string)
        : null;
    delete nextMetadata.feeEntryId;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE trip_fundings tf
        SET
          wallet_id = ${walletId},
          source_currency = ${normalized.sourceCurrency},
          source_amount = ${normalized.sourceAmount},
          destination_currency = ${normalized.destinationCurrency},
          destination_amount = ${normalized.destinationAmount},
          fx_rate = ${normalized.fxRate},
          base_amount = ${normalized.baseAmount},
          fee_amount = ${normalized.feeAmount},
          fee_currency = ${normalized.feeCurrency},
          metadata = ${nextMetadata as Prisma.InputJsonValue}
        FROM trips t
        WHERE
          tf.id = ${fundingId}
          AND tf.trip_id = ${tripId}
          AND t.id = tf.trip_id
          AND t.user_id = ${userId}
      `;

      await TripRepository.upsertFundingEntryTx(tx, userId, tripId, fundingId);

      if (previousFeeEntryId) {
        await tx.$executeRaw`
          DELETE FROM trip_entries
          WHERE id = ${previousFeeEntryId} AND trip_id = ${tripId}
        `;
      }
    });

    const recalcWalletIds = Array.from(
      new Set(
        [current.walletId, walletId].filter(
          (candidate): candidate is string => Boolean(candidate),
        ),
      ),
    );
    const recalcResults = await Promise.all(
      recalcWalletIds.map((targetWalletId) =>
        TripRepository.recalculateWalletEntriesToBase(userId, tripId, targetWalletId, {
          mode: "weighted",
        }).catch(TripRepository.recalcFailed),
      ),
    );
    const propagationTraces = recalcResults
      .map((result) => result?.propagationTrace)
      .filter((trace): trace is PropagationTrace => Boolean(trace));

    const updated = await TripRepository.getFundingsByTrip(userId, tripId);
    const match = updated.find((item) => item.id === fundingId);
    if (!match) {
      throw new Error("Failed to update funding");
    }
    return {
      funding: match,
      propagationTrace: propagationTraces.length > 0 ? propagationTraces : null,
    };
  }

  static async deleteFunding(userId: string, tripId: string, fundingId: string) {
    const existing = await prisma.$queryRaw<
      Array<{ metadata: unknown; walletId: string | null }>
    >`
      SELECT tf.metadata, tf.wallet_id AS "walletId"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE tf.id = ${fundingId} AND tf.trip_id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;
    const metadata =
      existing[0]?.metadata && typeof existing[0].metadata === "object"
        ? (existing[0].metadata as Record<string, unknown>)
        : {};
    const feeEntryId =
      typeof metadata.feeEntryId === "string" ? metadata.feeEntryId : null;

    const rows = await prisma.$transaction(async (tx) => {
      if (feeEntryId) {
        await tx.$executeRaw`
          DELETE FROM trip_entries
          WHERE id = ${feeEntryId} AND trip_id = ${tripId}
        `;
      }

      await TripRepository.deleteFundingEntryTx(tx, tripId, fundingId);

      return tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM trip_fundings tf
        USING trips t
        WHERE tf.id = ${fundingId} AND tf.trip_id = ${tripId} AND t.id = tf.trip_id AND t.user_id = ${userId}
        RETURNING tf.id
      `;
    });
    if (!rows[0]) {
      throw new Error("Funding not found or unauthorized");
    }

    let propagationTrace: PropagationTrace | null = null;
    const walletId = existing[0]?.walletId || null;
    if (walletId) {
      const recalcResult = await TripRepository.recalculateWalletEntriesToBase(
        userId,
        tripId,
        walletId,
        {
          mode: "weighted",
        },
      ).catch(TripRepository.recalcFailed);
      propagationTrace = recalcResult?.propagationTrace ?? null;
    }
    return { success: true, propagationTrace };
  }

  /** The user's account for a statement provider (e.g. Revolut), created on first use. */
  private static async ensureProviderAccountTx(
    tx: Prisma.TransactionClient | typeof prisma,
    userId: string,
    providerName: string,
  ) {
    const provider = providerName.trim().toLowerCase();
    const [existing] = await tx.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM wallet_accounts
      WHERE user_id = ${userId} AND (provider = ${provider} OR LOWER(name) = ${provider})
      ORDER BY (provider = ${provider}) DESC NULLS LAST, created_at ASC
      LIMIT 1
    `;
    if (existing) return existing;
    const [created] = await tx.$queryRaw<Array<{ id: string; name: string }>>`
      INSERT INTO wallet_accounts (id, user_id, name, provider, color, created_at, updated_at)
      VALUES (
        ${randomUUID()}, ${userId}, ${providerName.trim()}, ${provider},
        ${TripRepository.pickWalletColor(`${userId}::${provider}`)}, NOW(), NOW()
      )
      ON CONFLICT (user_id, name) DO UPDATE SET provider = COALESCE(wallet_accounts.provider, EXCLUDED.provider)
      RETURNING id, name
    `;
    return created;
  }

  static async createWallet(
    userId: string,
    tripId: string,
    data: { name: string; currency: string; color?: string | null; accountId?: string | null },
  ) {
    const tripRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!tripRows[0]) {
      throw new Error("Trip not found or unauthorized");
    }

    const resolvedColor = (data.color || "").trim()
      ? String(data.color).trim()
      : TripRepository.pickWalletColor(`${tripId}::${data.name}::${data.currency}`);

    if (data.accountId) {
      const [account] = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM wallet_accounts WHERE id = ${data.accountId} AND user_id = ${userId} LIMIT 1
      `;
      if (!account) throw new Error("Wallet account not found or unauthorized");
    }

    const id = randomUUID();
    const [wallet] = await prisma.$queryRaw<any[]>`
      INSERT INTO wallets (
        id,
        trip_id,
        user_id,
        account_id,
        name,
        currency,
        color,
        created_at,
        updated_at
      )
      VALUES (
        ${id},
        ${tripId},
        ${userId},
        ${data.accountId ?? null},
        ${data.name.trim()},
        ${normalizeCurrencyCode(data.currency)},
        ${resolvedColor},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        trip_id AS "tripId",
        account_id AS "accountId",
        name,
        currency,
        color,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
    return TripRepository.mapWallet(wallet);
  }

  static async findWallets(userId: string, tripId: string) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        w.id,
        w.trip_id AS "tripId",
        w.account_id AS "accountId",
        a.name AS "accountName",
        w.name,
        w.currency,
        w.color,
        w.created_at AS "createdAt",
        w.updated_at AS "updatedAt"
      FROM wallets w
      INNER JOIN trips t ON t.id = w.trip_id
      LEFT JOIN wallet_accounts a ON a.id = w.account_id
      WHERE w.trip_id = ${tripId} AND t.user_id = ${userId}
      ORDER BY w.name ASC
    `;
    return rows.map(TripRepository.mapWallet);
  }

  private static async getOwnedWallet(userId: string, tripId: string, walletId: string) {
    const [wallet] = await prisma.$queryRaw<Array<{ id: string; name: string; currency: string }>>`
      SELECT w.id, w.name, w.currency
      FROM wallets w
      INNER JOIN trips t ON t.id = w.trip_id
      WHERE w.id = ${walletId} AND w.trip_id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;
    if (!wallet) throw new Error("Wallet not found or unauthorized");
    return wallet;
  }

  /** Rename, recolour or link a wallet to an account. Its currency never changes. */
  static async updateWallet(
    userId: string,
    tripId: string,
    walletId: string,
    data: { name?: string; color?: string; accountId?: string | null },
  ) {
    await TripRepository.getOwnedWallet(userId, tripId, walletId);
    if (data.accountId) {
      const [account] = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM wallet_accounts WHERE id = ${data.accountId} AND user_id = ${userId} LIMIT 1
      `;
      if (!account) throw new Error("Wallet account not found or unauthorized");
    }
    const name = data.name?.trim();
    if (data.name !== undefined && !name) throw new Error("A wallet needs a name.");
    try {
      await prisma.$executeRaw`
        UPDATE wallets
        SET
          name = COALESCE(${name ?? null}, name),
          color = COALESCE(${data.color?.trim() || null}, color),
          account_id = ${data.accountId === undefined ? Prisma.sql`account_id` : data.accountId},
          updated_at = NOW()
        WHERE id = ${walletId} AND trip_id = ${tripId}
      `;
    } catch (error) {
      if (String(error).includes("wallets_trip_id_name_currency_key")) {
        throw Object.assign(new Error("This trip already has a wallet with that name and currency."), { status: 409 });
      }
      throw error;
    }
    const wallets = await TripRepository.findWallets(userId, tripId);
    return wallets.find((wallet) => wallet.id === walletId);
  }

  /**
   * Deletes a wallet nothing uses. Its foreign keys are SET NULL, so deleting a wallet
   * with history would quietly move that history out of any wallet.
   */
  static async deleteWallet(userId: string, tripId: string, walletId: string) {
    await TripRepository.getOwnedWallet(userId, tripId, walletId);
    const [usage] = await prisma.$queryRaw<Array<{ entries: number; fundings: number; references: number }>>`
      SELECT
        (SELECT COUNT(*)::int FROM trip_entries WHERE wallet_id = ${walletId}) AS entries,
        (SELECT COUNT(*)::int FROM trip_fundings WHERE wallet_id = ${walletId}) AS fundings,
        (SELECT COUNT(*)::int FROM trip_entries WHERE metadata->'fundingOut'->>'destinationWalletId' = ${walletId}) AS "references"
    `;
    if (usage.entries || usage.fundings || usage.references) {
      throw Object.assign(
        new Error(
          `This wallet still has ${usage.entries} entries and ${usage.fundings} fundings. Move them or merge the wallet instead.`,
        ),
        { status: 409, usage },
      );
    }
    await prisma.$executeRaw`DELETE FROM wallets WHERE id = ${walletId} AND trip_id = ${tripId}`;
    return { success: true };
  }

  /** Moves everything from one wallet into another wallet of the same currency and trip. */
  static async mergeWallet(userId: string, tripId: string, walletId: string, targetWalletId: string) {
    if (walletId === targetWalletId) throw new Error("Choose a different wallet to merge into.");
    const [source, target] = await Promise.all([
      TripRepository.getOwnedWallet(userId, tripId, walletId),
      TripRepository.getOwnedWallet(userId, tripId, targetWalletId),
    ]);
    if (source.currency.toUpperCase() !== target.currency.toUpperCase()) {
      throw new Error("Only wallets with the same currency can be merged.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE trip_entries SET wallet_id = ${targetWalletId} WHERE wallet_id = ${walletId}`;
      await tx.$executeRaw`UPDATE trip_fundings SET wallet_id = ${targetWalletId} WHERE wallet_id = ${walletId}`;
      await tx.$executeRaw`
        UPDATE trip_entries
        SET metadata = jsonb_set(metadata, '{fundingOut,destinationWalletId}', to_jsonb(${targetWalletId}::text))
        WHERE metadata->'fundingOut'->>'destinationWalletId' = ${walletId}
      `;
      const fundings = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM trip_fundings WHERE wallet_id = ${targetWalletId}
      `;
      for (const funding of fundings) {
        await TripRepository.upsertFundingEntryTx(tx, userId, tripId, funding.id);
      }
      await tx.$executeRaw`DELETE FROM wallets WHERE id = ${walletId} AND trip_id = ${tripId}`;
    });
    await TripRepository.recalculateWalletEntriesToBase(userId, tripId, targetWalletId, {
      mode: "weighted",
    }).catch(TripRepository.recalcFailed);
    const wallets = await TripRepository.findWallets(userId, tripId);
    return wallets.find((wallet) => wallet.id === targetWalletId);
  }

  static async listWalletAccounts(userId: string) {
    return prisma.$queryRaw<
      Array<{ id: string; name: string; provider: string | null; color: string; archivedAt: Date | null; walletCount: number }>
    >`
      SELECT
        a.id, a.name, a.provider, a.color, a.archived_at AS "archivedAt",
        COUNT(w.id)::int AS "walletCount"
      FROM wallet_accounts a
      LEFT JOIN wallets w ON w.account_id = a.id
      WHERE a.user_id = ${userId}
      GROUP BY a.id
      ORDER BY a.archived_at NULLS FIRST, a.name ASC
    `;
  }

  static async createWalletAccount(userId: string, data: { name: string; color?: string | null }) {
    const name = data.name.trim();
    if (!name) throw new Error("An account needs a name.");
    const provider = ["revolut", "youtrip"].includes(name.toLowerCase()) ? name.toLowerCase() : null;
    const [account] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO wallet_accounts (id, user_id, name, provider, color, created_at, updated_at)
      VALUES (
        ${randomUUID()}, ${userId}, ${name}, ${provider},
        ${data.color?.trim() || TripRepository.pickWalletColor(`${userId}::${name}`)}, NOW(), NOW()
      )
      ON CONFLICT (user_id, name) DO NOTHING
      RETURNING id
    `;
    if (!account) throw Object.assign(new Error("You already have an account with that name."), { status: 409 });
    return (await TripRepository.listWalletAccounts(userId)).find((item) => item.id === account.id);
  }

  /** Renaming an account also renames trip wallets still named after it ("Revolut JPY"). */
  static async updateWalletAccount(
    userId: string,
    accountId: string,
    data: { name?: string; color?: string; archived?: boolean },
  ) {
    const [account] = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM wallet_accounts WHERE id = ${accountId} AND user_id = ${userId} LIMIT 1
    `;
    if (!account) throw new Error("Wallet account not found or unauthorized");
    const name = data.name?.trim();
    if (data.name !== undefined && !name) throw new Error("An account needs a name.");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE wallet_accounts
        SET
          name = COALESCE(${name ?? null}, name),
          color = COALESCE(${data.color?.trim() || null}, color),
          archived_at = ${data.archived === undefined ? Prisma.sql`archived_at` : data.archived ? Prisma.sql`NOW()` : null},
          updated_at = NOW()
        WHERE id = ${accountId}
      `;
      if (name && name !== account.name) {
        await tx.$executeRaw`
          UPDATE wallets
          SET name = ${name} || ' ' || currency, updated_at = NOW()
          WHERE account_id = ${accountId} AND name = ${account.name} || ' ' || currency
            AND NOT EXISTS (
              SELECT 1 FROM wallets other
              WHERE other.trip_id = wallets.trip_id AND other.currency = wallets.currency
                AND other.name = ${name} || ' ' || wallets.currency
            )
        `;
      }
    });
    return (await TripRepository.listWalletAccounts(userId)).find((item) => item.id === accountId);
  }

  /** Signed balance of a wallet in its own currency, as the wallet summary shows it. */
  private static async getWalletBalance(walletId: string) {
    const [row] = await prisma.$queryRaw<Array<{ balance: unknown }>>`
      SELECT COALESCE(SUM(
        CASE
          WHEN te.type = 'funding_in' THEN
            CASE
              WHEN te.source_type IN ('funding_in_imported_topup', 'funding_in_opening_balance')
                AND (
                  COALESCE(te.metadata->>'matchReviewState', '') = 'rejected'
                  OR COALESCE(te.metadata->>'matchReviewStatus', '') = 'rejected'
                )
              THEN 0::numeric
              ELSE te.local_amount
            END
          WHEN te.type = 'reimbursement' THEN te.local_amount
          WHEN te.type IN ('spending', 'funding_out', 'settlement') THEN -te.local_amount
          ELSE 0::numeric
        END
      ), 0) AS balance
      FROM trip_entries te
      INNER JOIN wallets w ON w.id = te.wallet_id
      WHERE te.wallet_id = ${walletId} AND UPPER(te.local_currency) = UPPER(w.currency)
    `;
    return Number(row?.balance || 0);
  }

  /** Leftover balances of another trip's wallets that could start this trip. */
  static async getCarryOverCandidates(userId: string, tripId: string, sourceTripId: string) {
    const [trips] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM trips WHERE user_id = ${userId} AND id IN (${tripId}, ${sourceTripId})
    `;
    if (trips.count !== 2 || tripId === sourceTripId) throw new Error("Trip not found or unauthorized");
    const wallets = await TripRepository.findWallets(userId, sourceTripId);
    const destinationWallets = await TripRepository.findWallets(userId, tripId);
    const [baseRow] = await prisma.$queryRaw<Array<{ source: string; destination: string }>>`
      SELECT
        (SELECT base_currency FROM trips WHERE id = ${sourceTripId}) AS source,
        (SELECT base_currency FROM trips WHERE id = ${tripId}) AS destination
    `;
    const candidates = [];
    for (const wallet of wallets) {
      const balance = TripRepository.roundMoney(await TripRepository.getWalletBalance(wallet.id));
      if (!(balance > 0)) continue;
      const inBase = wallet.currency.toUpperCase() === baseRow.source.toUpperCase();
      const rate = inBase
        ? 1
        : await TripRepository.getWalletWeightedFxRate(sourceTripId, wallet.id).catch(() => null);
      const match = destinationWallets.find(
        (candidate) =>
          candidate.currency === wallet.currency &&
          (wallet.accountId ? candidate.accountId === wallet.accountId : candidate.name === wallet.name),
      );
      candidates.push({
        sourceWalletId: wallet.id,
        name: wallet.name,
        accountId: wallet.accountId,
        currency: wallet.currency,
        balance,
        fxRate: rate,
        baseValue: rate ? TripRepository.roundMoney(balance * rate) : null,
        destinationWalletId: match?.id ?? null,
      });
    }
    return {
      sameBaseCurrency: baseRow.source.toUpperCase() === baseRow.destination.toUpperCase(),
      candidates,
    };
  }

  /**
   * Carries leftover wallet balances from another trip into this one. Each becomes a
   * transfer out of the old trip valued at that wallet's average rate, received here
   * at the same base value, so the money keeps its exact cost.
   */
  static async carryOverWallets(
    userId: string,
    tripId: string,
    input: {
      sourceTripId: string;
      items: Array<{ sourceWalletId: string; amount?: number | null; destinationWalletId?: string | null; fxRate?: number | null }>;
      date?: Date;
    },
  ) {
    const { sameBaseCurrency, candidates } = await TripRepository.getCarryOverCandidates(userId, tripId, input.sourceTripId);
    if (!sameBaseCurrency) throw new Error("Both trips need the same base currency to carry money over.");
    const [destinationTrip] = await prisma.$queryRaw<Array<{ startDate: Date }>>`
      SELECT start_date AS "startDate" FROM trips WHERE id = ${tripId}
    `;
    const created: Array<{ sourceWalletId: string; entryId: string }> = [];
    for (const item of input.items) {
      const candidate = candidates.find((row) => row.sourceWalletId === item.sourceWalletId);
      if (!candidate) throw new Error("That wallet has no balance to carry over.");
      const amount = item.amount ?? candidate.balance;
      if (!(amount > 0) || amount - candidate.balance > 0.0001) {
        throw new Error(`You can carry over at most ${candidate.balance} ${candidate.currency} from ${candidate.name}.`);
      }
      const rate = item.fxRate ?? candidate.fxRate;
      if (!rate) throw new Error(`${candidate.name} has no funding to value it; enter a rate.`);
      let destinationWalletId = item.destinationWalletId ?? candidate.destinationWalletId;
      if (!destinationWalletId) {
        const wallet = await TripRepository.createWallet(userId, tripId, {
          name: candidate.name,
          currency: candidate.currency,
          accountId: candidate.accountId,
        });
        destinationWalletId = wallet.id;
      }
      const result = await TripRepository.createTripEntry(userId, input.sourceTripId, {
        walletId: candidate.sourceWalletId,
        type: "funding_out",
        date: input.date ?? destinationTrip.startDate,
        description: `Carried over to the next trip`,
        localCurrency: candidate.currency,
        localAmount: amount,
        fxRate: rate,
        fundingOut: {
          destinationType: "trip",
          destinationTripId: tripId,
          destinationWalletId,
          destinationCurrency: candidate.currency,
          destinationAmount: amount,
        },
        metadata: { carryOver: true },
      });
      created.push({ sourceWalletId: candidate.sourceWalletId, entryId: result.id });
    }
    return { created };
  }

  /**
   * Base cost per unit of the wallet's currency across its fundings. Rejected bank
   * suggestions and opening balances valued at this very average are left out, and a
   * funding only counts when it actually delivered the wallet's currency.
   */
  private static async getWalletWeightedFxRate(tripId: string, walletId: string) {
    const [weightedRow] = await prisma.$queryRaw<
      Array<{ baseTotal: unknown; localTotal: unknown }>
    >`
      SELECT
        COALESCE(SUM(
          COALESCE(
            tf.base_amount,
            CASE
              WHEN UPPER(tf.source_currency) = UPPER(t.base_currency) THEN tf.source_amount
              WHEN UPPER(tf.destination_currency) = UPPER(t.base_currency) THEN tf.destination_amount
              ELSE tf.source_amount
            END
          )
        ), 0) AS "baseTotal",
        COALESCE(SUM(tf.destination_amount), 0) AS "localTotal"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      INNER JOIN wallets w ON w.id = tf.wallet_id
      WHERE
        tf.trip_id = ${tripId}
        AND tf.wallet_id = ${walletId}
        AND UPPER(tf.destination_currency) = UPPER(w.currency)
        AND NOT (
          tf.source_type = 'opening_balance'
          AND COALESCE(tf.metadata->>'valuation', '') = 'wallet_average'
        )
        AND (
          tf.source_type NOT IN ('imported_topup', 'opening_balance')
          OR (
            COALESCE(tf.metadata->>'matchReviewState', '') <> 'rejected'
            AND COALESCE(tf.metadata->>'matchReviewStatus', '') <> 'rejected'
          )
        )
    `;
    const baseTotal = Number(weightedRow?.baseTotal ?? 0);
    const localTotal = Number(weightedRow?.localTotal ?? 0);
    if (!(baseTotal > 0) || !(localTotal > 0)) {
      throw new Error(
        "Unable to derive weighted FX from wallet fundings. Use manual FX rate.",
      );
    }
    return baseTotal / localTotal;
  }

  static async recalculateWalletEntriesToBase(
    userId: string,
    tripId: string,
    walletId: string,
    input: {
      mode: "manual" | "weighted";
      fxRate?: number | null;
    },
    propagate: boolean = true,
  ) {
    const walletRows = await prisma.$queryRaw<
      Array<{
        id: string;
        currency: string;
        baseCurrency: string;
      }>
    >`
      SELECT
        w.id,
        w.currency,
        t.base_currency AS "baseCurrency"
      FROM wallets w
      INNER JOIN trips t ON t.id = w.trip_id
      WHERE w.id = ${walletId} AND w.trip_id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;
    if (!walletRows[0]) {
      throw new Error("Wallet not found or unauthorized");
    }
    const wallet = walletRows[0];

    let fxRate: number;
    if (input.mode === "manual") {
      const manual = Number(input.fxRate || 0);
      if (!(manual > 0)) {
        throw new Error("Manual FX rate must be greater than 0.");
      }
      fxRate = manual;
    } else if (wallet.currency.toUpperCase() === wallet.baseCurrency.toUpperCase()) {
      fxRate = 1;
    } else {
      fxRate = await TripRepository.getWalletWeightedFxRate(tripId, walletId);
    }

    const updatedIds = await prisma.$transaction(async (tx) => {
      // Only entries in the wallet's own currency carry its rate; values the user
      // set by hand stay as they are.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE trip_entries te
        SET
          fx_rate = ${TripRepository.roundRate(fxRate)},
          base_amount = ROUND((te.local_amount * ${fxRate})::numeric, 4)
        FROM trips t
        WHERE
          te.trip_id = ${tripId}
          AND te.wallet_id = ${walletId}
          AND t.id = te.trip_id
          AND t.user_id = ${userId}
          AND te.type IN ('spending', 'funding_out', 'reimbursement', 'settlement')
          AND UPPER(te.local_currency) = UPPER(${wallet.currency})
          AND NOT ${TripRepository.LOCKED_BASE_SQL}
        RETURNING te.id
      `;

      // Opening balances have no known cost, so they take the wallet's average rate.
      const openings = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE trip_fundings tf
        SET base_amount = ROUND((tf.destination_amount * ${fxRate})::numeric, 4)
        WHERE
          tf.trip_id = ${tripId}
          AND tf.wallet_id = ${walletId}
          AND tf.source_type = 'opening_balance'
          AND COALESCE(tf.metadata->>'valuation', '') = 'wallet_average'
        RETURNING tf.id
      `;
      for (const opening of openings) {
        await TripRepository.upsertFundingEntryTx(tx, userId, tripId, opening.id);
      }

      const ids = rows.map((row) => row.id);
      // Settlements paid from this wallet changed value, and so did the IOUs they settled.
      const ious = await TripIouRepository.reallocateSettlementsTx(tx, tripId, ids);
      const touched = await TripRepository.reconcileReimbursementAllocationsTx(tx, tripId, [...ids, ...ious]);
      await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, touched);
      await TripRepository.resyncTripSyncedBankTransactionsTx(tx, userId, tripId, touched);
      return ids;
    });
    const rows = updatedIds.map((id) => ({ id }));

    let propagationTrace: PropagationTrace | null = null;
    if (propagate) {
      propagationTrace = await TripRepository.propagateFundingBaseAmountsAcrossTrips(
        userId,
        [{ tripId, walletId }],
      ).catch((error) => {
        console.warn("[trips] funding propagation failed", { tripId, walletId, error });
        return null;
      });
    }

    return {
      walletId: wallet.id,
      walletCurrency: wallet.currency,
      baseCurrency: wallet.baseCurrency,
      fxRate,
      updatedCount: rows.length,
      propagationTrace,
    };
  }

  static async importTripSpendings(
    userId: string,
    tripId: string,
    walletId: string | null | undefined,
    parserId: string | null | undefined,
    transactions: Array<{
      date: string;
      description: string;
      label?: string | null;
      categoryId?: string | null;
      entryType?: "spending" | "reimbursement" | "funding_out" | "funding_in";
      linkage?: {
        type: "reimbursement";
        reimbursesAllocations?: Array<{
          transactionId?: string;
          pendingBatchIndex?: number;
          amountBase: number;
        }>;
        reimbursementBaseAmount?: number;
        reimbursingFxRate?: number;
        leftoverCategoryId?: string | null;
      } | null;
      amountIn?: number | null;
      amountOut?: number | null;
      fundingOut?: {
        destinationType?: "bank" | "trip" | "wallet" | "external";
        destinationTripId?: string | null;
        destinationWalletId?: string | null;
        bankTransactionId?: string | null;
        destinationCurrency?: string | null;
        destinationAmount?: number | null;
        fxRate?: number | null;
        feeAmount?: number | null;
        feeCurrency?: string | null;
      } | null;
      metadata?: Record<string, any> | null;
    }>,
  ) {
    const toNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const toCurrency = (value: unknown, fallback: string): string => {
      const raw = String(value ?? fallback).trim().toUpperCase();
      return raw || fallback.toUpperCase();
    };

    const tripRows = await prisma.$queryRaw<
      Array<{ id: string; name: string; baseCurrency: string }>
    >`
      SELECT id, name, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;

    if (!tripRows[0]) {
      throw new Error("Trip not found or unauthorized");
    }

    let selectedWalletCurrency: string | null = null;
    if (walletId) {
      const walletRows = await prisma.$queryRaw<Array<{ id: string; currency: string }>>`
        SELECT w.id, w.currency
        FROM wallets w
        INNER JOIN trips t ON t.id = w.trip_id
        WHERE w.id = ${walletId} AND w.trip_id = ${tripId} AND t.user_id = ${userId}
        LIMIT 1
      `;
      if (!walletRows[0]) {
        throw new Error("Wallet not found or unauthorized");
      }
      selectedWalletCurrency = String(walletRows[0].currency || "").toUpperCase();
    }

    const trip = tripRows[0];
    const baseCurrency = trip.baseCurrency.toUpperCase();
    const normalizedParserId = (parserId || "").toLowerCase();
    const forceStatementWalletRouting =
      normalizedParserId.includes("revolut") ||
      normalizedParserId.includes("youtrip");
    const parserProvider =
      normalizedParserId.includes("revolut")
        ? "Revolut"
        : normalizedParserId.includes("youtrip")
          ? "YouTrip"
          : "Trip";

    const walletKeyToId = new Map<string, string>();
    if (!walletId) {
      const existingWallets = await prisma.$queryRaw<
        Array<{ id: string; name: string; currency: string }>
      >`
        SELECT id, name, currency
        FROM wallets
        WHERE trip_id = ${tripId}
      `;
      existingWallets.forEach((row) => {
        walletKeyToId.set(`${row.name}::${row.currency.toUpperCase()}`, row.id);
      });
    }

    const resolveWalletName = (metadata: Record<string, any>, currency: string) => {
      const provider = String(metadata.provider || parserProvider || "Trip").trim();
      return `${provider || "Trip"} ${currency}`;
    };

    const resolveBaseAmount = (params: {
      localAmount: number;
      localCurrency: string;
      statementAmount: number;
      statementCurrency: string;
      metadata: Record<string, any>;
    }) => {
      return resolveTripImportBaseAmount({
        ...params,
        baseCurrency,
      });
    };

    const providerKeyword = parserProvider.toLowerCase();
    const supportsOpeningBalanceSuggestion =
      normalizedParserId.includes("revolut") ||
      normalizedParserId.includes("youtrip");
    let importedSpendings = 0;
    let importedReimbursements = 0;
    let importedFundings = 0;
    let importedTransfers = 0;
    let importedFees = 0;
    let handledRows = 0;
    let skippedDuplicates = 0;
    const usedBankTransactionIds = new Set<string>();
    const touchedWalletIds = new Map<string, { tripId: string; walletId: string }>();
    const selectedIndexToImportedEntryId = new Map<number, string>();
    const pendingReimbursementLinks: Array<{
      sourceIndex: number;
      reimbursementEntryId: string;
      allocations: TripReimbursementAllocationInput[];
      leftoverCategoryId?: string | null;
    }> = [];

    await prisma.$transaction(async (tx) => {
      const openingBalanceSuggestions = new Map<
        string,
        {
          walletId: string;
          destinationCurrency: string;
          openingAmount: number;
          basisDate: Date;
          basisDescription: string;
          basisBalance: number;
          basisIn: number;
          basisOut: number;
        }
      >();

      const monthByAbbr: Record<string, number> = {
        JAN: 0,
        FEB: 1,
        MAR: 2,
        APR: 3,
        MAY: 4,
        JUN: 5,
        JUL: 6,
        AUG: 7,
        SEP: 8,
        OCT: 9,
        NOV: 10,
        DEC: 11,
      };

      const toDayKey = (date: Date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d.toISOString().slice(0, 10);
      };

      const extractEffectiveBankDate = (description: string, postedDate: Date) => {
        // Typical card statements encode merchant date in description, e.g. "SGP 18DEC".
        const matches = Array.from(
          String(description || "").toUpperCase().matchAll(
            /(?:^|\D)(\d{1,2})\s*([A-Z]{3})(?=\D|$)/g,
          ),
        );
        if (!matches.length) return postedDate;

        for (const match of matches) {
          const day = Number(match[1]);
          const monthAbbr = match[2];
          const month = monthByAbbr[monthAbbr];
          if (!Number.isFinite(day) || day < 1 || day > 31 || month === undefined) {
            continue;
          }

          const posted = new Date(postedDate);
          const candidates = [posted.getFullYear() - 1, posted.getFullYear(), posted.getFullYear() + 1]
            .map((year) => new Date(year, month, day));
          const best = candidates.sort(
            (a, b) => Math.abs(a.getTime() - posted.getTime()) - Math.abs(b.getTime() - posted.getTime()),
          )[0];
          return best;
        }

        return postedDate;
      };

      const findFundingTransactionCandidates = async (params: {
        date: Date;
        expectedAmount: number;
      }) => {
        const startWindow = new Date(params.date);
        startWindow.setDate(startWindow.getDate() - 7);
        startWindow.setHours(0, 0, 0, 0);
        const endWindow = new Date(params.date);
        endWindow.setDate(endWindow.getDate() + 7);
        endWindow.setHours(23, 59, 59, 999);
        const targetDayKey = toDayKey(params.date);

        const expected = Number(params.expectedAmount || 0);
        if (!(expected > 0)) return null;
        const rawMatches = await tx.$queryRaw<
          Array<{
            id: string;
            date: Date;
            description: string;
            label: string | null;
            accountIdentifier: string | null;
            amountIn: unknown;
            amountOut: unknown;
          }>
        >`
          SELECT
            t.id,
            t.date,
            t.description,
            t.label,
            t.account_number AS "accountIdentifier",
            t.amount_in AS "amountIn",
            t.amount_out AS "amountOut"
          FROM transactions t
          WHERE
            t.user_id = ${userId}
            AND t.amount_out IS NOT NULL
            AND t.date BETWEEN ${startWindow} AND ${endWindow}
            AND ABS(t.amount_out - ${expected}) <= 0.01
            AND t.description ILIKE ${`%${providerKeyword}%`}
            -- Already funding another trip, or counted as trip spending somewhere.
            AND NOT EXISTS (
              SELECT 1 FROM trip_fundings other_tf
              INNER JOIN trips other_trip ON other_trip.id = other_tf.trip_id
              WHERE other_trip.user_id = ${userId}
                AND other_tf.bank_transaction_id = t.id
                AND other_tf.trip_id <> ${tripId}
            )
            AND NOT EXISTS (
              SELECT 1 FROM trip_entries other_te
              INNER JOIN trips other_trip ON other_trip.id = other_te.trip_id
              WHERE other_trip.user_id = ${userId}
                AND other_te.source_transaction_id = t.id
                AND other_te.type <> 'funding_in'
            )
          ORDER BY
            t.date DESC,
            t.id DESC
          LIMIT 50
        `;

        const baseMatches = rawMatches.filter((match) => {
          const effectiveDate = extractEffectiveBankDate(match.description, new Date(match.date));
          return toDayKey(effectiveDate) === targetDayKey;
        });

        if (baseMatches.length === 0) {
          return {
            inFundingList: [] as Array<Record<string, unknown>>,
            outsideFundingList: [] as Array<Record<string, unknown>>,
            recommended: null as null | Record<string, unknown>,
          };
        }

        const ids = baseMatches.map((match) => match.id);
        const fundingRows = await tx.$queryRaw<
          Array<{
            fundingId: string;
            transactionId: string;
            sourceType: string;
            reviewState: string | null;
            reviewStatus: string | null;
            walletId: string | null;
            walletName: string | null;
            walletCurrency: string | null;
          }>
        >`
          SELECT
            tf.id AS "fundingId",
            tf.bank_transaction_id AS "transactionId",
            tf.source_type AS "sourceType",
            tf.metadata->>'matchReviewState' AS "reviewState",
            tf.metadata->>'matchReviewStatus' AS "reviewStatus",
            tf.wallet_id AS "walletId",
            w.name AS "walletName",
            w.currency AS "walletCurrency"
          FROM trip_fundings tf
          LEFT JOIN wallets w ON w.id = tf.wallet_id
          WHERE tf.trip_id = ${tripId}
            AND tf.bank_transaction_id IN (${Prisma.join(ids)})
        `;

        const eligibleFundingRows = fundingRows.filter(
          (row) => {
            if (row.sourceType !== "imported_topup") return true;
            if (row.reviewState) {
              return row.reviewState === "linked_confirmed" || row.reviewState === "external_confirmed";
            }
            return ["accepted", "replaced", "confirmed"].includes(row.reviewStatus || "");
          },
        );
        const fundingByTx = new Map<string, (typeof eligibleFundingRows)[number]>();
        eligibleFundingRows.forEach((row) => {
          if (!fundingByTx.has(row.transactionId)) {
            fundingByTx.set(row.transactionId, row);
          }
        });

        const decorate = (match: (typeof baseMatches)[number]) => ({
          id: match.id,
          date: match.date,
          description: match.description,
          label: match.label,
          amountIn: match.amountIn !== null ? Number(match.amountIn) : null,
          amountOut: match.amountOut !== null ? Number(match.amountOut) : null,
          accountIdentifier: match.accountIdentifier,
        });

        const inFundingList = baseMatches
          .filter((match) => fundingByTx.has(match.id))
          .map((match) => {
            const linkedFunding = fundingByTx.get(match.id)!;
            return {
              ...decorate(match),
              source: "funding_list",
              fundingId: linkedFunding.fundingId,
              walletId: linkedFunding.walletId,
              walletName: linkedFunding.walletName,
              walletCurrency: linkedFunding.walletCurrency,
            };
          });

        const outsideFundingList = baseMatches
          .filter((match) => !fundingByTx.has(match.id))
          .map((match) => ({
            ...decorate(match),
            source: "bank",
          }));

        const recommendationPool = [...inFundingList, ...outsideFundingList];
        const recommended =
          recommendationPool.find(
            (item) =>
              typeof item.id === "string" && !usedBankTransactionIds.has(item.id),
          ) || null;
        if (recommended && typeof recommended.id === "string") {
          usedBankTransactionIds.add(recommended.id);
        }

        return { inFundingList, outsideFundingList, recommended };
      };

      const resolveWalletId = async (
        metadata: Record<string, any>,
        currency: string,
        forceAutoWallet: boolean = false,
      ) => {
        const normalizedCurrency = toCurrency(currency, baseCurrency);

        if (walletId && !forceAutoWallet && !forceStatementWalletRouting) {
          if (
            selectedWalletCurrency &&
            normalizedCurrency !== selectedWalletCurrency
          ) {
            throw new Error(
              `Selected wallet currency ${selectedWalletCurrency} does not match imported row currency ${normalizedCurrency}.`,
            );
          }
          touchedWalletIds.set(`${tripId}:${walletId}`, { tripId, walletId });
          return walletId;
        }

        const walletName = resolveWalletName(metadata, normalizedCurrency);
        const walletKey = `${walletName}::${normalizedCurrency}`;
        const cachedWalletId = walletKeyToId.get(walletKey);
        if (cachedWalletId) {
          touchedWalletIds.set(`${tripId}:${cachedWalletId}`, {
            tripId,
            walletId: cachedWalletId,
          });
          return cachedWalletId;
        }

        // Statements route by the provider's account, so renamed wallets are still found.
        const providerName = String(metadata.provider || parserProvider || "").trim();
        const account =
          providerName && providerName !== "Trip"
            ? await TripRepository.ensureProviderAccountTx(tx, userId, providerName)
            : null;
        const [existingWallet] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM wallets
          WHERE trip_id = ${tripId}
            AND currency = ${normalizedCurrency}
            AND (
              (${account?.id ?? null}::text IS NOT NULL AND account_id = ${account?.id ?? null})
              OR name = ${walletName}
            )
          ORDER BY (account_id IS NOT DISTINCT FROM ${account?.id ?? null}) DESC
          LIMIT 1
        `;

        if (existingWallet) {
          walletKeyToId.set(walletKey, existingWallet.id);
          touchedWalletIds.set(`${tripId}:${existingWallet.id}`, {
            tripId,
            walletId: existingWallet.id,
          });
          return existingWallet.id;
        }

        const [createdWallet] = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO wallets (
            id,
            trip_id,
            user_id,
            account_id,
            name,
            currency,
            color,
            created_at,
            updated_at
          )
          VALUES (
            ${randomUUID()},
            ${tripId},
            ${userId},
            ${account?.id ?? null},
            ${walletName},
            ${normalizedCurrency},
            ${TripRepository.pickWalletColor(`${tripId}::${walletName}::${normalizedCurrency}`)},
            NOW(),
            NOW()
          )
          RETURNING id
        `;
        walletKeyToId.set(walletKey, createdWallet.id);
        touchedWalletIds.set(`${tripId}:${createdWallet.id}`, {
          tripId,
          walletId: createdWallet.id,
        });
        return createdWallet.id;
      };

      const resolveWalletBaseFx = async (
        targetWalletId: string,
        targetWalletCurrency: string,
      ) => {
        const normalizedCurrency = toCurrency(targetWalletCurrency, baseCurrency);
        if (normalizedCurrency === baseCurrency) return 1;

        const [row] = await tx.$queryRaw<
          Array<{
            baseTotal: unknown;
            localTotal: unknown;
          }>
        >`
          SELECT
            COALESCE(
              SUM(
                COALESCE(
                  tf.base_amount,
                  CASE
                    WHEN UPPER(tf.source_currency) = UPPER(t.base_currency) THEN tf.source_amount
                    WHEN UPPER(tf.destination_currency) = UPPER(t.base_currency) THEN tf.destination_amount
                    ELSE tf.source_amount
                  END
                )
              ),
              0
            ) AS "baseTotal",
            COALESCE(
              SUM(
                CASE
                  WHEN UPPER(tf.destination_currency) = UPPER(w.currency) THEN tf.destination_amount
                  ELSE 0::numeric
                END
              ),
              0
            ) AS "localTotal"
          FROM trip_fundings tf
          INNER JOIN wallets w ON w.id = tf.wallet_id
          INNER JOIN trips t ON t.id = tf.trip_id
          WHERE
            tf.trip_id = ${tripId}
            AND tf.wallet_id = ${targetWalletId}
            AND (
              tf.source_type NOT IN ('imported_topup', 'opening_balance')
              OR (
                COALESCE(tf.metadata->>'matchReviewState', '') <> 'rejected'
                AND COALESCE(tf.metadata->>'matchReviewStatus', '') <> 'rejected'
              )
            )
        `;

        const baseTotal = Number(row?.baseTotal || 0);
        const localTotal = Number(row?.localTotal || 0);
        if (!(baseTotal > 0) || !(localTotal > 0)) return null;
        return baseTotal / localTotal;
      };

      // Re-importing an overlapping statement must not double the trip. Each row gets a
      // fingerprint; a row is skipped while this trip already holds as many imported rows
      // with that fingerprint, so identical rows within one statement are all kept.
      const existingFingerprintRows = await tx.$queryRaw<Array<{ fingerprint: string; rows: bigint | number }>>`
        SELECT fingerprint, COUNT(DISTINCT row_id) AS rows
        FROM (
          SELECT metadata->>'importFingerprint' AS fingerprint, metadata->>'importRowId' AS row_id
          FROM trip_entries
          WHERE trip_id = ${tripId} AND metadata ? 'importFingerprint'
          UNION ALL
          SELECT metadata->>'importFingerprint', metadata->>'importRowId'
          FROM trip_fundings
          WHERE trip_id = ${tripId} AND metadata ? 'importFingerprint'
        ) imported
        GROUP BY fingerprint
      `;
      const remainingDuplicates = new Map(
        existingFingerprintRows.map((row) => [row.fingerprint, Number(row.rows)]),
      );

      for (let transactionIndex = 0; transactionIndex < transactions.length; transactionIndex += 1) {
        const transaction = transactions[transactionIndex];
        const out = toNumber(transaction.amountOut) || 0;
        const incoming = toNumber(transaction.amountIn) || 0;
        const metadata =
          transaction.metadata && typeof transaction.metadata === "object"
            ? (transaction.metadata as Record<string, any>)
            : {};
        const parsedDate = new Date(transaction.date);
        const fingerprint = createHash("sha1")
          .update(
            [
              normalizedParserId || "",
              Number.isNaN(parsedDate.getTime()) ? String(transaction.date) : parsedDate.toISOString().slice(0, 10),
              incoming.toFixed(4),
              out.toFixed(4),
              String(metadata.currency || "").toUpperCase(),
              String(transaction.description || "").trim().toLowerCase().replace(/\s+/g, " "),
            ].join("|"),
          )
          .digest("hex");
        const alreadyImported = remainingDuplicates.get(fingerprint) || 0;
        if (alreadyImported > 0) {
          remainingDuplicates.set(fingerprint, alreadyImported - 1);
          skippedDuplicates += 1;
          continue;
        }
        metadata.importFingerprint = fingerprint;
        metadata.importRowId = randomUUID();
        const explicitEntryType = String(
          transaction.entryType || metadata.entryType || "",
        )
          .trim()
          .toLowerCase();
        const transactionType = String(metadata.transactionType || "")
          .trim()
          .toLowerCase();
        const fundingInDisabled = metadata.fundingInDisabled === true;
        const isExplicitFundingIn = explicitEntryType === "funding_in";
        const isAutoFundingIn =
          transactionType === "topup" && !fundingInDisabled;
        const shouldTreatAsFundingIn = isExplicitFundingIn || isAutoFundingIn;
        const fundingOutInput =
          transaction.fundingOut && typeof transaction.fundingOut === "object"
            ? (transaction.fundingOut as Record<string, unknown>)
            : metadata.fundingOut && typeof metadata.fundingOut === "object"
              ? (metadata.fundingOut as Record<string, unknown>)
              : null;
        const statementCurrency = toCurrency(metadata.currency, baseCurrency);
        const conversionReviewInput =
          metadata.conversionReview &&
          typeof metadata.conversionReview === "object"
            ? (metadata.conversionReview as Record<string, unknown>)
            : null;
        const conversionReviewMode = String(
          conversionReviewInput?.mode || "",
        ).toLowerCase();

        const linkageInput =
          transaction.linkage && typeof transaction.linkage === "object"
            ? (transaction.linkage as Record<string, unknown>)
            : metadata.linkage && typeof metadata.linkage === "object"
              ? (metadata.linkage as Record<string, unknown>)
              : null;
        const reimbursementAllocationsInput =
          linkageInput?.type === "reimbursement" &&
          Array.isArray(linkageInput.reimbursesAllocations)
            ? (linkageInput.reimbursesAllocations as Array<Record<string, unknown>>)
            : [];
        const normalizedLinkAllocations =
          reimbursementAllocationsInput.length > 0
            ? TripRepository.normalizeTripReimbursementAllocations(
                reimbursementAllocationsInput.map((item) => ({
                  transactionId: item.transactionId
                    ? String(item.transactionId)
                    : undefined,
                  pendingBatchIndex:
                    typeof item.pendingBatchIndex === "number"
                      ? Number(item.pendingBatchIndex)
                      : undefined,
                  amountBase: Number(item.amountBase || 0),
                })),
              )
            : [];
        const linkageLeftoverCategoryId =
          linkageInput?.leftoverCategoryId === null ||
          linkageInput?.leftoverCategoryId === undefined
            ? null
            : String(linkageInput.leftoverCategoryId);
        const linkageReimbursementBaseAmount = toNumber(
          linkageInput?.reimbursementBaseAmount,
        );
        const linkageReimbursingFxRate = toNumber(linkageInput?.reimbursingFxRate);

        if (explicitEntryType === "reimbursement") {
          if (shouldTreatAsFundingIn) {
            throw new Error(
              "Funding In transactions cannot be marked as reimbursement.",
            );
          }
          if (!(incoming > 0)) {
            throw new Error(
              "Only positive inflow transactions can be marked as reimbursement",
            );
          }
          const localCurrency = toCurrency(statementCurrency, statementCurrency);
          const resolvedWalletId = await resolveWalletId(metadata, localCurrency);
          const localAmount = Number(incoming);
          const derivedBaseAmount = resolveBaseAmount({
            localAmount,
            localCurrency,
            statementAmount: incoming,
            statementCurrency,
            metadata,
          });
          const baseAmount =
            linkageReimbursementBaseAmount && linkageReimbursementBaseAmount > 0
              ? linkageReimbursementBaseAmount
              : linkageReimbursingFxRate && linkageReimbursingFxRate > 0
                ? localAmount * linkageReimbursingFxRate
                : derivedBaseAmount;
          const fxRate =
            linkageReimbursingFxRate && linkageReimbursingFxRate > 0
              ? linkageReimbursingFxRate
              : localAmount > 0
                ? baseAmount / localAmount
                : 1;
          const entryId = randomUUID();
          await tx.$executeRaw`
            INSERT INTO trip_entries (
              id,
              trip_id,
              wallet_id,
              source_type,
              source_transaction_id,
              type,
              transaction_date,
              description,
              label,
              local_currency,
              local_amount,
              fx_rate,
              base_amount,
              fee_amount,
              fee_currency,
              category_id,
              linked_entry_id,
              metadata,
              created_at
            )
            VALUES (
              ${entryId},
              ${tripId},
              ${resolvedWalletId},
              'wallet',
              NULL,
              'reimbursement',
              ${new Date(transaction.date)},
              ${transaction.description},
              ${transaction.label ?? null},
              ${localCurrency},
              ${localAmount},
              ${fxRate},
              ${baseAmount},
              NULL,
              NULL,
              NULL,
              NULL,
              ${{
                ...metadata,
                importedFromTripParser: true,
                reimbursementValuationSource:
                  linkageReimbursementBaseAmount && linkageReimbursementBaseAmount > 0
                    ? "manual_base_amount"
                    : linkageReimbursingFxRate && linkageReimbursingFxRate > 0
                      ? "manual_fx_rate"
                      : "parser_or_wallet",
                reimbursementBaseAmount:
                  linkageReimbursementBaseAmount && linkageReimbursementBaseAmount > 0
                    ? linkageReimbursementBaseAmount
                    : baseAmount,
                reimbursementFxRate:
                  linkageReimbursingFxRate && linkageReimbursingFxRate > 0
                    ? linkageReimbursingFxRate
                    : fxRate,
                originalDescription: transaction.description,
                originalDate: transaction.date,
              } as Prisma.InputJsonValue},
              NOW()
            )
          `;
          selectedIndexToImportedEntryId.set(transactionIndex, entryId);
          if (normalizedLinkAllocations.length > 0) {
            pendingReimbursementLinks.push({
              sourceIndex: transactionIndex,
              reimbursementEntryId: entryId,
              allocations: normalizedLinkAllocations,
              leftoverCategoryId: linkageLeftoverCategoryId,
            });
          }
          importedReimbursements += 1;
          handledRows += 1;
          continue;
        }

        if (explicitEntryType === "funding_out") {
          if (shouldTreatAsFundingIn) {
            throw new Error(
              "Funding In transactions cannot be marked as Funding Out.",
            );
          }
          if (!(out > 0)) {
            throw new Error(
              "Only negative outflow transactions can be marked as Funding Out.",
            );
          }
          const localCurrency = toCurrency(statementCurrency, statementCurrency);
          const resolvedWalletId = await resolveWalletId(metadata, localCurrency);
          const localAmount = Number(toNumber(metadata.foreignAmount) || out);
          if (!(localAmount > 0)) continue;

          const baseAmount = resolveBaseAmount({
            localAmount,
            localCurrency,
            statementAmount: Math.max(out, incoming, localAmount),
            statementCurrency,
            metadata,
          });
          const fxRate = localAmount > 0 ? baseAmount / localAmount : 1;
          const normalizedFundingOut = await TripRepository.normalizeFundingOutConfig(
            tx,
            userId,
            {
              tripBaseCurrency: trip.baseCurrency,
              sourceCurrency: localCurrency,
              sourceAmount: localAmount,
              sourceBaseAmount: baseAmount,
              fundingOut: {
                destinationType:
                  (String(fundingOutInput?.destinationType || "external").toLowerCase() as
                    | "bank"
                    | "trip"
                    | "external"),
                destinationTripId: fundingOutInput?.destinationTripId
                  ? String(fundingOutInput.destinationTripId)
                  : null,
                bankTransactionId: fundingOutInput?.bankTransactionId
                  ? String(fundingOutInput.bankTransactionId)
                  : null,
                destinationCurrency: toCurrency(
                  fundingOutInput?.destinationCurrency,
                  localCurrency,
                ),
                destinationAmount: toNumber(fundingOutInput?.destinationAmount),
                fxRate: toNumber(fundingOutInput?.fxRate),
                feeAmount:
                  toNumber(fundingOutInput?.feeAmount) || toNumber(metadata.feeAmount),
                feeCurrency: toCurrency(
                  fundingOutInput?.feeCurrency || metadata.feeCurrency,
                  localCurrency,
                ),
              },
            },
          );
          const feeAmount = normalizedFundingOut.feeAmount;
          const feeCurrency = normalizedFundingOut.feeCurrency;
          const entryId = randomUUID();

          await tx.$executeRaw`
            INSERT INTO trip_entries (
              id,
              trip_id,
              wallet_id,
              source_type,
              source_transaction_id,
              type,
              transaction_date,
              description,
              label,
              local_currency,
              local_amount,
              fx_rate,
              base_amount,
              fee_amount,
              fee_currency,
              category_id,
              linked_entry_id,
              metadata,
              created_at
            )
            VALUES (
              ${entryId},
              ${tripId},
              ${resolvedWalletId},
              'wallet_funding_out',
              NULL,
              'funding_out',
              ${new Date(transaction.date)},
              ${transaction.description},
              ${transaction.label ?? null},
              ${localCurrency},
              ${localAmount},
              ${fxRate},
              ${baseAmount},
              ${normalizedFundingOut.feeAmount ?? null},
              ${normalizedFundingOut.feeCurrency ?? null},
              NULL,
              NULL,
              ${{
                ...metadata,
                importedFromTripParser: true,
                entryType: "funding_out",
                fundingOut: {
                  destinationType: normalizedFundingOut.destinationType,
                  destinationTripId: normalizedFundingOut.destinationTripId,
                  bankTransactionId: normalizedFundingOut.bankTransactionId,
                  destinationCurrency: normalizedFundingOut.destinationCurrency,
                  destinationAmount: normalizedFundingOut.destinationAmount,
                  fxRate: normalizedFundingOut.fxRate,
                  feeAmount: feeAmount ?? null,
                  feeCurrency: feeCurrency ?? null,
                  feeBaseAmount: normalizedFundingOut.feeBaseAmount,
                },
                originalDescription: transaction.description,
                originalDate: transaction.date,
              } as Prisma.InputJsonValue},
              NOW()
            )
          `;

          if (
            normalizedFundingOut.destinationType === "trip" &&
            normalizedFundingOut.destinationTripId
          ) {
            const downstream = await TripRepository.upsertFundingFromTripOutgoingTx(
              tx,
              userId,
              {
                sourceTripId: tripId,
                sourceTripName: trip.name,
                sourceEntryId: entryId,
                sourceDate: new Date(transaction.date),
                sourceDescription: transaction.description,
                sourceLabel: transaction.label ?? null,
                destinationTripId: normalizedFundingOut.destinationTripId,
                destinationCurrency: normalizedFundingOut.destinationCurrency,
                destinationAmount: normalizedFundingOut.destinationAmount,
                sourceCurrency: localCurrency,
                sourceAmount: localAmount,
                fxRate: normalizedFundingOut.fxRate,
                baseAmount: baseAmount,
                feeAmount: normalizedFundingOut.feeAmount,
                feeCurrency: normalizedFundingOut.feeCurrency,
                sourceMetadata:
                  metadata && typeof metadata === "object"
                    ? (metadata as Record<string, unknown>)
                    : null,
              },
            );
            if (downstream?.walletId) {
              touchedWalletIds.set(
                `${normalizedFundingOut.destinationTripId}:${downstream.walletId}`,
                {
                  tripId: normalizedFundingOut.destinationTripId,
                  walletId: downstream.walletId,
                },
              );
            }
          }

          handledRows += 1;
          continue;
        }

        if (!isExplicitFundingIn && transactionType === "conversion") {
          if (conversionReviewMode === "skip_duplicate") {
            handledRows += 1;
            continue;
          }

          if (conversionReviewMode === "link_existing") {
            const linkedFundingId = conversionReviewInput?.linkedFundingId
              ? String(conversionReviewInput.linkedFundingId)
              : null;
            if (!linkedFundingId) {
              throw new Error(
                "Conversion match is missing linked funding reference.",
              );
            }

            const [existingFunding] = await tx.$queryRaw<
              Array<{
                id: string;
                metadata: Record<string, unknown> | null;
              }>
            >`
              SELECT tf.id, tf.metadata
              FROM trip_fundings tf
              INNER JOIN trips t ON t.id = tf.trip_id
              WHERE
                tf.id = ${linkedFundingId}
                AND tf.trip_id = ${tripId}
                AND tf.source_type = 'wallet_conversion'
                AND t.user_id = ${userId}
              LIMIT 1
            `;

            if (!existingFunding) {
              throw new Error(
                "Selected conversion match could not be found for this trip.",
              );
            }

            const existingMetadata =
              existingFunding.metadata &&
              typeof existingFunding.metadata === "object"
                ? {
                    ...(existingFunding.metadata as Record<string, unknown>),
                  }
                : {};
            const existingMirrorMatches = Array.isArray(
              existingMetadata.mirrorMatches,
            )
              ? (existingMetadata.mirrorMatches as Array<Record<string, unknown>>)
              : [];
            const mirrorMatches = [
              ...existingMirrorMatches,
              {
                linkedAt: new Date().toISOString(),
                parserId,
                date: transaction.date,
                description: transaction.description,
                statementCurrency,
                statementAmount:
                  incoming > 0 ? incoming : out > 0 ? out : null,
                fromAmount: toNumber(metadata.fromAmount),
                fromCurrency: metadata.fromCurrency
                  ? String(metadata.fromCurrency)
                  : null,
                toAmount: toNumber(metadata.toAmount),
                toCurrency: metadata.toCurrency
                  ? String(metadata.toCurrency)
                  : null,
              },
            ];

            await tx.$executeRaw`
              UPDATE trip_fundings
              SET metadata = ${{
                ...existingMetadata,
                mirrorMatches,
              } as Prisma.InputJsonValue}
              WHERE id = ${linkedFundingId}
            `;

            handledRows += 1;
            continue;
          }
        }

        if (supportsOpeningBalanceSuggestion) {
          const rowBalance = toNumber((transaction as { balance?: unknown }).balance);
          const rowMovement = Math.max(incoming, out);
          if (rowBalance !== null && rowMovement > 0) {
            const openingAmount = Number((rowBalance + out - incoming).toFixed(2));
            if (openingAmount > 0) {
              const openingWalletId = await resolveWalletId(
                metadata,
                statementCurrency,
                true,
              );
              const suggestionKey = `${openingWalletId}::${statementCurrency}`;
              const txDate = new Date(transaction.date);
              const existing = openingBalanceSuggestions.get(suggestionKey);
              if (!existing || txDate.getTime() < existing.basisDate.getTime()) {
                openingBalanceSuggestions.set(suggestionKey, {
                  walletId: openingWalletId,
                  destinationCurrency: statementCurrency,
                  openingAmount,
                  basisDate: txDate,
                  basisDescription: transaction.description || "Imported statement row",
                  basisBalance: rowBalance,
                  basisIn: incoming,
                  basisOut: out,
                });
              }
            }
          }
        }

        if (
          !isExplicitFundingIn &&
          transactionType === "conversion" &&
          toNumber(metadata.fromAmount) &&
          toNumber(metadata.toAmount) &&
          metadata.fromCurrency &&
          metadata.toCurrency
        ) {
          const fromAmount = Number(toNumber(metadata.fromAmount) || 0);
          const toAmount = Number(toNumber(metadata.toAmount) || 0);
          const fromCurrency = toCurrency(metadata.fromCurrency, baseCurrency);
          const toCurrencyCode = toCurrency(metadata.toCurrency, baseCurrency);

          if (fromAmount > 0 && toAmount > 0) {
            const fromWalletId = await resolveWalletId(
              metadata,
              fromCurrency,
              true,
            );
            const toWalletId = await resolveWalletId(metadata, toCurrencyCode, true);

            const sourceWalletBaseFx = await resolveWalletBaseFx(
              fromWalletId,
              fromCurrency,
            );

            const fallbackBaseAmount =
              fromCurrency === baseCurrency
                ? fromAmount
                : toCurrencyCode === baseCurrency
                  ? toAmount
                  : resolveBaseAmount({
                      localAmount: fromAmount,
                      localCurrency: fromCurrency,
                      statementAmount: Math.max(incoming, out, toAmount, fromAmount),
                      statementCurrency,
                      metadata,
                    });
            const baseAmountFrom =
              sourceWalletBaseFx && sourceWalletBaseFx > 0
                ? fromAmount * sourceWalletBaseFx
                : fallbackBaseAmount;

            const rawFeeAmount = Number(toNumber(metadata.feeAmount) || 0);
            const rawFeeCurrency = rawFeeAmount
              ? toCurrency(metadata.feeCurrency || toCurrencyCode, toCurrencyCode)
              : null;

            let normalizedConversion;
            try {
              normalizedConversion = TripRepository.normalizeFundingValues({
                sourceCurrency: fromCurrency,
                sourceAmount: fromAmount,
                destinationCurrency: toCurrencyCode,
                destinationAmount: toAmount,
                fxRate: null,
                feeAmount: rawFeeAmount > 0 ? rawFeeAmount : null,
                feeCurrency: rawFeeCurrency,
                baseCurrency,
                baseAmount: baseAmountFrom,
              });
            } catch {
              normalizedConversion = TripRepository.normalizeFundingValues({
                sourceCurrency: fromCurrency,
                sourceAmount: fromAmount,
                destinationCurrency: toCurrencyCode,
                destinationAmount: toAmount,
                fxRate: null,
                feeAmount: null,
                feeCurrency: null,
                baseCurrency,
                baseAmount: baseAmountFrom,
              });
            }
            normalizedConversion = { ...normalizedConversion, baseAmount: baseAmountFrom };

            const conversionOutId = randomUUID();
            const conversionFundingId = randomUUID();
            const conversionMetadata = {
              ...metadata,
              importedFromTripParser: true,
              transferType: "currency_conversion",
              originalDescription: transaction.description,
              originalDate: transaction.date,
              sourceTripEntryId: conversionOutId,
            } as Prisma.InputJsonValue;

            await tx.$executeRaw`
              INSERT INTO trip_entries (
                id,
                trip_id,
                wallet_id,
                source_type,
                source_transaction_id,
                type,
                transaction_date,
                description,
                label,
                local_currency,
                local_amount,
                fx_rate,
                base_amount,
                fee_amount,
                fee_currency,
                category_id,
                linked_entry_id,
                metadata,
                created_at
              )
              VALUES (
                ${conversionOutId},
                ${tripId},
                ${fromWalletId},
                'wallet_conversion_out',
                NULL,
                'funding_out',
                ${new Date(transaction.date)},
                ${transaction.description || "Wallet Conversion"},
                ${transaction.label ?? null},
                ${fromCurrency},
                ${normalizedConversion.sourceAmount},
                ${normalizedConversion.sourceAmount > 0
                  ? normalizedConversion.baseAmount / normalizedConversion.sourceAmount
                  : 1},
                ${normalizedConversion.baseAmount},
                NULL,
                NULL,
                NULL,
                NULL,
                ${{
                  ...metadata,
                  importedFromTripParser: true,
                  entryType: "funding_out",
                  fundingOut: {
                    destinationType: "wallet",
                    destinationTripId: tripId,
                    destinationWalletId: toWalletId,
                    destinationCurrency: normalizedConversion.destinationCurrency,
                    destinationAmount: normalizedConversion.destinationAmount,
                    fxRate: normalizedConversion.fxRate,
                    feeAmount: normalizedConversion.feeAmount,
                    feeCurrency: normalizedConversion.feeCurrency,
                  },
                  transferType: "currency_conversion",
                  sourceTripFundingId: conversionFundingId,
                  originalDescription: transaction.description,
                  originalDate: transaction.date,
                } as Prisma.InputJsonValue},
                NOW()
              )
            `;

            await tx.$executeRaw`
              INSERT INTO trip_fundings (
                id,
                trip_id,
                wallet_id,
                entry_id,
                bank_transaction_id,
                source_type,
                source_currency,
                source_amount,
                destination_currency,
                destination_amount,
                fx_rate,
                base_amount,
                fee_amount,
                fee_currency,
                metadata,
                created_at
              )
              VALUES (
                ${conversionFundingId},
                ${tripId},
                ${toWalletId},
                NULL,
                NULL,
                'wallet_conversion',
                ${normalizedConversion.sourceCurrency},
                ${normalizedConversion.sourceAmount},
                ${normalizedConversion.destinationCurrency},
                ${normalizedConversion.destinationAmount},
                ${normalizedConversion.fxRate},
                ${normalizedConversion.baseAmount},
                ${normalizedConversion.feeAmount},
                ${normalizedConversion.feeCurrency},
                ${{
                  ...metadata,
                  importedFromTripParser: true,
                  sourceTripEntryId: conversionOutId,
                  sourceWalletId: fromWalletId,
                  destinationWalletId: toWalletId,
                  transferType: "currency_conversion",
                  matchReviewState: "external_confirmed",
                  matchReviewStatus: "confirmed",
                  originalDescription: transaction.description,
                  originalDate: transaction.date,
                } as Prisma.InputJsonValue},
                NOW()
              )
            `;

            await TripRepository.upsertFundingEntryTx(
              tx,
              userId,
              tripId,
              conversionFundingId,
            );

            importedFundings += 1;
            importedTransfers += 1;
            handledRows += 1;
            continue;
          }
        }

        if (shouldTreatAsFundingIn) {
          if (!(incoming > 0)) {
            throw new Error(
              "Only positive inflow transactions can be marked as Funding In.",
            );
          }
          const statementAmount =
            incoming > 0
              ? incoming
              : out > 0
                ? out
                : Number(toNumber(metadata.statementAmount) || 0);
          const feeFromAmounts =
            incoming > 0 && out > 0 ? Number(out) : Number(toNumber(metadata.feeAmount) || 0);
          const explicitDestinationAmount = Number(
            toNumber(metadata.foreignAmount) || toNumber(metadata.toAmount) || 0,
          );
          // Parsers report a top-up's amountIn net of fees: what the wallet received.
          let destinationAmount =
            explicitDestinationAmount > 0
              ? explicitDestinationAmount
              : statementAmount > 0
                ? statementAmount
                : 0;
          const destinationCurrency = toCurrency(
            metadata.toCurrency ||
              metadata.foreignCurrency ||
              statementCurrency,
            baseCurrency,
          );
          // Topups are statement-currency specific and should always target
          // the auto-detected wallet for that currency/provider, regardless of
          // a globally selected import wallet.
          const resolvedWalletId = await resolveWalletId(
            metadata,
            destinationCurrency,
            true,
          );

          if (destinationAmount > 0) {
            const fundingId = randomUUID();
            let feeAmount = feeFromAmounts > 0 ? feeFromAmounts : Number(toNumber(metadata.feeAmount) || 0);
            let feeCurrency = feeAmount
              ? toCurrency(
                  metadata.feeCurrency || destinationCurrency,
                  destinationCurrency,
                )
              : null;

            // Revolut/YouTrip sometimes represent topups as "charged amount" + "credited amount".
            // If explicit fee is missing, infer it from statement amount delta.
            if (!(feeAmount > 0) && statementAmount > 0) {
              const creditedAmount = Number(
                toNumber(metadata.foreignAmount) ||
                  toNumber(metadata.toAmount) ||
                  0,
              );
              const creditedCurrency = toCurrency(
                metadata.foreignCurrency ||
                  metadata.toCurrency ||
                  destinationCurrency,
                destinationCurrency,
              );

              if (
                creditedAmount > 0 &&
                creditedCurrency === destinationCurrency &&
                statementAmount - creditedAmount > 0.0001
              ) {
                feeAmount = Number((statementAmount - creditedAmount).toFixed(4));
                feeCurrency = destinationCurrency;
                destinationAmount = creditedAmount;
                metadata.feeInferred = true;
              }
            }
            const sourceCurrency = statementCurrency;
            const sourceAmount =
              destinationAmount +
              (feeAmount > 0 && feeCurrency === sourceCurrency ? feeAmount : 0);
            const baseAmount = resolveBaseAmount({
              localAmount: destinationAmount,
              localCurrency: destinationCurrency,
              statementAmount: sourceAmount,
              statementCurrency: sourceCurrency,
              metadata,
            });
            const normalizedFunding = TripRepository.normalizeFundingValues({
              sourceCurrency,
              sourceAmount,
              destinationCurrency,
              destinationAmount,
              fxRate: null,
              feeAmount,
              feeCurrency: feeAmount > 0 ? feeCurrency : null,
              baseCurrency,
              baseAmount,
            });
            const candidateMatches = await findFundingTransactionCandidates({
              date: new Date(transaction.date),
              expectedAmount: normalizedFunding.sourceAmount,
            });
            const resolvedCandidateMatches =
              candidateMatches || {
                inFundingList: [] as Array<Record<string, unknown>>,
                outsideFundingList: [] as Array<Record<string, unknown>>,
                recommended: null as null | Record<string, unknown>,
              };
            const recommendedMatch = resolvedCandidateMatches.recommended as
              | (Record<string, unknown> & { id?: string; source?: string; fundingId?: string })
              | null;

            await tx.$executeRaw`
              INSERT INTO trip_fundings (
                id,
                trip_id,
                wallet_id,
                entry_id,
                bank_transaction_id,
                source_type,
                source_currency,
                source_amount,
                destination_currency,
                destination_amount,
                fx_rate,
                base_amount,
                fee_amount,
                fee_currency,
                metadata,
                created_at
              )
              VALUES (
                ${fundingId},
                ${tripId},
                ${resolvedWalletId},
                NULL,
                ${null},
                'imported_topup',
                ${normalizedFunding.sourceCurrency},
                ${normalizedFunding.sourceAmount},
                ${normalizedFunding.destinationCurrency},
                ${normalizedFunding.destinationAmount},
                ${normalizedFunding.fxRate},
                ${normalizedFunding.baseAmount},
                ${normalizedFunding.feeAmount},
                ${normalizedFunding.feeCurrency},
                ${{
                  ...metadata,
                  importedFromTripParser: true,
                  autoMatchedBankTransactionId: recommendedMatch?.id || null,
                  autoMatchedCandidateSource: recommendedMatch?.source || null,
                  autoMatchedFundingId: recommendedMatch?.fundingId || null,
                  autoMatchCandidates: {
                    inFundingList: resolvedCandidateMatches.inFundingList,
                    outsideFundingList: resolvedCandidateMatches.outsideFundingList,
                    providerKeyword,
                  },
                  matchReviewState: "pending_review",
                  matchReviewStatus: recommendedMatch?.id ? "pending" : "unmatched",
                  originalDescription: transaction.description,
                  originalDate: transaction.date,
                } as Prisma.InputJsonValue},
                NOW()
              )
            `;

            await TripRepository.upsertFundingEntryTx(
              tx,
              userId,
              tripId,
              fundingId,
            );
            importedFundings += 1;

            handledRows += 1;
            continue;
          }
        }

        // Revolut/YouTrip statement rows are settled in statement currency.
        // Merchant currency (if present) is informational only for spending rows.
        const localCurrency = toCurrency(statementCurrency, statementCurrency);
        const resolvedWalletId = await resolveWalletId(metadata, localCurrency);

        if (out > 0) {
          const localAmount = Number(out);
          const baseAmount = resolveBaseAmount({
            localAmount,
            localCurrency,
            statementAmount: out,
            statementCurrency,
            metadata,
          });
          const fxRate = localAmount > 0 ? baseAmount / localAmount : 1;
          const entryId = randomUUID();
          await tx.$executeRaw`
            INSERT INTO trip_entries (
              id,
              trip_id,
              wallet_id,
              source_type,
              source_transaction_id,
              type,
              transaction_date,
              description,
              label,
              local_currency,
              local_amount,
              fx_rate,
              base_amount,
              fee_amount,
              fee_currency,
              category_id,
              linked_entry_id,
              metadata,
              created_at
            )
            VALUES (
              ${entryId},
              ${tripId},
              ${resolvedWalletId},
              'wallet',
              NULL,
              'spending',
              ${new Date(transaction.date)},
              ${transaction.description},
              ${transaction.label ?? null},
              ${localCurrency},
              ${localAmount},
              ${fxRate},
              ${baseAmount},
              ${metadata.feeAmount ?? null},
              ${metadata.feeCurrency ?? null},
              ${transaction.categoryId ?? null},
              NULL,
              ${{
                ...metadata,
                importedFromTripParser: true,
                originalDescription: transaction.description,
                originalDate: transaction.date,
              } as Prisma.InputJsonValue},
              NOW()
            )
          `;
          selectedIndexToImportedEntryId.set(transactionIndex, entryId);
          importedSpendings += 1;
          handledRows += 1;
          continue;
        }

        if (incoming > 0) {
          const localAmount = Number(incoming);
          const baseAmount = resolveBaseAmount({
            localAmount,
            localCurrency,
            statementAmount: incoming,
            statementCurrency,
            metadata,
          });
          const fxRate = localAmount > 0 ? baseAmount / localAmount : 1;
          const entryId = randomUUID();
          await tx.$executeRaw`
            INSERT INTO trip_entries (
              id,
              trip_id,
              wallet_id,
              source_type,
              source_transaction_id,
              type,
              transaction_date,
              description,
              label,
              local_currency,
              local_amount,
              fx_rate,
              base_amount,
              fee_amount,
              fee_currency,
              category_id,
              linked_entry_id,
              metadata,
              created_at
            )
            VALUES (
              ${entryId},
              ${tripId},
              ${resolvedWalletId},
              'wallet',
              NULL,
              'reimbursement',
              ${new Date(transaction.date)},
              ${transaction.description},
              ${transaction.label ?? null},
              ${localCurrency},
              ${localAmount},
              ${fxRate},
              ${baseAmount},
              NULL,
              NULL,
              NULL,
              NULL,
              ${{
                ...metadata,
                importedFromTripParser: true,
                originalDescription: transaction.description,
                originalDate: transaction.date,
              } as Prisma.InputJsonValue},
              NOW()
            )
          `;
          selectedIndexToImportedEntryId.set(transactionIndex, entryId);

          if (normalizedLinkAllocations.length > 0) {
            pendingReimbursementLinks.push({
              sourceIndex: transactionIndex,
              reimbursementEntryId: entryId,
              allocations: normalizedLinkAllocations,
              leftoverCategoryId: linkageLeftoverCategoryId,
            });
          }
          importedReimbursements += 1;
          handledRows += 1;
        }
      }

      if (pendingReimbursementLinks.length > 0) {
        for (const link of pendingReimbursementLinks) {
          const resolvedAllocations = link.allocations
            .map((allocation) => {
              if (allocation.transactionId) {
                return {
                  transactionId: allocation.transactionId,
                  amountBase: allocation.amountBase,
                };
              }
              if (typeof allocation.pendingBatchIndex !== "number") {
                return null;
              }
              const targetId = selectedIndexToImportedEntryId.get(
                allocation.pendingBatchIndex,
              );
              if (!targetId) return null;
              return {
                transactionId: targetId,
                amountBase: allocation.amountBase,
              };
            })
            .filter(
              (item): item is { transactionId: string; amountBase: number } =>
                !!item && item.amountBase > 0,
            );

          if (resolvedAllocations.length === 0) continue;
          await TripRepository.applyTripReimbursementAllocations(
            tx,
            userId,
            tripId,
            link.reimbursementEntryId,
            resolvedAllocations,
            link.leftoverCategoryId ?? null,
          );
        }
      }

      if (supportsOpeningBalanceSuggestion && openingBalanceSuggestions.size > 0) {
        const existingRows = await tx.$queryRaw<
          Array<{
            walletId: string | null;
            destinationCurrency: string;
          }>
        >`
          SELECT
            tf.wallet_id AS "walletId",
            tf.destination_currency AS "destinationCurrency"
          FROM trip_fundings tf
          WHERE
            tf.trip_id = ${tripId}
            AND tf.source_type = 'opening_balance'
        `;
        const existingKeySet = new Set(
          existingRows
            .filter((row) => row.walletId)
            .map(
              (row) =>
                `${String(row.walletId)}::${toCurrency(row.destinationCurrency, baseCurrency)}`,
            ),
        );

        for (const suggestion of openingBalanceSuggestions.values()) {
          const suggestionKey = `${suggestion.walletId}::${suggestion.destinationCurrency}`;
          if (existingKeySet.has(suggestionKey)) {
            continue;
          }
          // Money carried over from the previous trip already is this opening balance.
          const [carried] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM trip_fundings
            WHERE trip_id = ${tripId}
              AND wallet_id = ${suggestion.walletId}
              AND source_type = 'from_trip_outgoing'
              AND ABS(destination_amount - ${suggestion.openingAmount}) <= GREATEST(1, ${suggestion.openingAmount} * 0.01)
            LIMIT 1
          `;
          if (carried) {
            existingKeySet.add(suggestionKey);
            continue;
          }
          existingKeySet.add(suggestionKey);
          const openingFundingId = randomUUID();
          // A foreign opening balance has no known cost; it takes the wallet's average rate.
          const openingInBase =
            suggestion.destinationCurrency.toUpperCase() === baseCurrency.toUpperCase();

          await tx.$executeRaw`
            INSERT INTO trip_fundings (
              id,
              trip_id,
              wallet_id,
              entry_id,
              bank_transaction_id,
              source_type,
              source_currency,
              source_amount,
              destination_currency,
              destination_amount,
              fx_rate,
              base_amount,
              fee_amount,
              fee_currency,
              metadata,
              created_at
            )
            VALUES (
              ${openingFundingId},
              ${tripId},
              ${suggestion.walletId},
              NULL,
              NULL,
              'opening_balance',
              ${suggestion.destinationCurrency},
              ${suggestion.openingAmount},
              ${suggestion.destinationCurrency},
              ${suggestion.openingAmount},
              1,
              ${openingInBase ? suggestion.openingAmount : null},
              NULL,
              NULL,
              ${{
                ...(openingInBase ? {} : { valuation: "wallet_average" }),
                importedFromTripParser: true,
                matchReviewState: "pending_review",
                matchReviewStatus: "pending",
                matchReviewedAction: null,
                openingBalanceSuggestion: true,
                parserProvider,
                parserId: normalizedParserId || null,
                basisTransactionDate: suggestion.basisDate.toISOString(),
                basisTransactionDescription: suggestion.basisDescription,
                basisBalance: suggestion.basisBalance,
                basisAmountIn: suggestion.basisIn,
                basisAmountOut: suggestion.basisOut,
              } as Prisma.InputJsonValue},
              NOW()
            )
          `;
          await TripRepository.upsertFundingEntryTx(
            tx,
            userId,
            tripId,
            openingFundingId,
          );
          importedFundings += 1;
        }
      }
    });

    if (touchedWalletIds.size > 0) {
      await Promise.all(
        Array.from(touchedWalletIds.values()).map((target) =>
          TripRepository.recalculateWalletEntriesToBase(
            userId,
            target.tripId,
            target.walletId,
            {
              mode: "weighted",
            },
          ).catch(TripRepository.recalcFailed),
        ),
      );
    }

    return {
      importedSpendings,
      importedReimbursements,
      importedFundings,
      importedTransfers,
      importedFees,
      skippedDuplicates,
      skipped: Math.max(0, transactions.length - handledRows - skippedDuplicates),
    };
  }

  /**
   * Bank transactions are about to be deleted or split away. Trip records keep their
   * amounts but lose the link: fundings go back to review, entries are flagged so the
   * user can relink or remove them.
   */
  static async detachBankTransactionsTx(
    tx: Prisma.TransactionClient,
    userId: string,
    transactionIds: string[],
    reason: "deleted" | "split" | "direction_changed",
  ) {
    const ids = Array.from(new Set(transactionIds.filter(Boolean)));
    if (!ids.length) return [] as Array<{ tripId: string; walletId: string }>;
    const fundings = await tx.$queryRaw<Array<{ id: string; tripId: string; walletId: string | null }>>`
      UPDATE trip_fundings tf
      SET
        bank_transaction_id = NULL,
        metadata = (COALESCE(tf.metadata, '{}'::jsonb) - 'bankTransactionId') || jsonb_build_object(
          'matchReviewState', 'pending_review',
          'matchReviewStatus', 'pending',
          'detachedBankTransaction', jsonb_build_object('id', tf.bank_transaction_id, 'reason', ${reason}::text)
        )
      FROM trips t
      WHERE t.id = tf.trip_id AND t.user_id = ${userId} AND tf.bank_transaction_id = ANY(${ids})
      RETURNING tf.id, tf.trip_id AS "tripId", tf.wallet_id AS "walletId"
    `;
    for (const funding of fundings) {
      await TripRepository.upsertFundingEntryTx(tx, userId, funding.tripId, funding.id);
    }
    await tx.$executeRaw`
      UPDATE trip_entries te
      SET
        source_transaction_id = NULL,
        metadata = COALESCE(te.metadata, '{}'::jsonb) || jsonb_build_object(
          'sourceDetached', jsonb_build_object('transactionId', te.source_transaction_id, 'reason', ${reason}::text)
        )
      FROM trips t
      WHERE t.id = te.trip_id AND t.user_id = ${userId}
        AND te.type <> 'funding_in'
        AND te.source_transaction_id = ANY(${ids})
    `;
    await tx.$executeRaw`
      UPDATE trip_entries te
      SET metadata = jsonb_set(te.metadata, '{fundingOut,bankTransactionId}', 'null'::jsonb)
      FROM trips t
      WHERE t.id = te.trip_id AND t.user_id = ${userId}
        AND te.metadata->'fundingOut'->>'bankTransactionId' = ANY(${ids})
    `;
    return fundings
      .filter((funding) => funding.walletId)
      .map((funding) => ({ tripId: funding.tripId, walletId: funding.walletId as string }));
  }

  /**
   * Bank transactions' amounts changed. Trip entries taken from them and fundings
   * paid by them follow the new amounts; a row whose direction flipped is detached.
   */
  static async syncBankTransactionAmountsTx(
    tx: Prisma.TransactionClient,
    userId: string,
    transactionIds: string[],
  ) {
    const ids = Array.from(new Set(transactionIds.filter(Boolean)));
    if (!ids.length) return;
    const sources = await tx.$queryRaw<Array<{ id: string; amountIn: unknown; amountOut: unknown }>>`
      SELECT id, amount_in AS "amountIn", amount_out AS "amountOut"
      FROM transactions WHERE user_id = ${userId} AND id = ANY(${ids})
    `;
    const flipped: string[] = [];
    const touchedEntries = new Map<string, string[]>();
    const touchedWallets = new Map<string, { tripId: string; walletId: string }>();
    for (const source of sources) {
      const amountIn = Number(source.amountIn || 0);
      const amountOut = Number(source.amountOut || 0);
      const entries = await tx.$queryRaw<Array<{ id: string; tripId: string; type: string; localAmount: unknown }>>`
        SELECT te.id, te.trip_id AS "tripId", te.type, te.local_amount AS "localAmount"
        FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id
        WHERE t.user_id = ${userId}
          AND te.source_transaction_id = ${source.id}
          AND te.type <> 'funding_in'
          AND UPPER(te.local_currency) = UPPER(t.base_currency)
      `;
      for (const entry of entries) {
        const next = entry.type === "spending" ? amountOut : amountIn;
        if (!(next > 0)) {
          flipped.push(source.id);
          continue;
        }
        if (Math.abs(next - Number(entry.localAmount || 0)) < 0.00005) continue;
        await tx.$executeRaw`
          UPDATE trip_entries SET local_amount = ${next}, base_amount = ${next}, fx_rate = 1
          WHERE id = ${entry.id}
        `;
        touchedEntries.set(entry.tripId, [...(touchedEntries.get(entry.tripId) || []), entry.id]);
      }

      const fundings = await tx.$queryRaw<
        Array<{ id: string; tripId: string; walletId: string | null; sourceAmount: unknown; destinationAmount: unknown; inBase: boolean }>
      >`
        SELECT
          tf.id,
          tf.trip_id AS "tripId",
          tf.wallet_id AS "walletId",
          tf.source_amount AS "sourceAmount",
          tf.destination_amount AS "destinationAmount",
          UPPER(tf.source_currency) = UPPER(t.base_currency) AS "inBase"
        FROM trip_fundings tf
        INNER JOIN trips t ON t.id = tf.trip_id
        WHERE t.user_id = ${userId} AND tf.bank_transaction_id = ${source.id}
      `;
      for (const funding of fundings) {
        if (!(amountOut > 0)) {
          flipped.push(source.id);
          continue;
        }
        if (Math.abs(amountOut - Number(funding.sourceAmount || 0)) < 0.00005) continue;
        const destination = Number(funding.destinationAmount || 0);
        await tx.$executeRaw`
          UPDATE trip_fundings
          SET
            source_amount = ${amountOut},
            fx_rate = ${destination > 0 ? TripRepository.roundRate(amountOut / destination) : null},
            base_amount = CASE WHEN ${funding.inBase} THEN ${amountOut} ELSE base_amount END
          WHERE id = ${funding.id}
        `;
        await TripRepository.upsertFundingEntryTx(tx, userId, funding.tripId, funding.id);
        if (funding.walletId) {
          touchedWallets.set(`${funding.tripId}:${funding.walletId}`, { tripId: funding.tripId, walletId: funding.walletId });
        }
      }
    }

    for (const [tripId, entryIds] of touchedEntries) {
      const touched = await TripRepository.reconcileReimbursementAllocationsTx(tx, tripId, entryIds);
      await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, touched);
      await TripRepository.resyncTripSyncedBankTransactionsTx(tx, userId, tripId, touched);
    }
    for (const target of await TripRepository.detachBankTransactionsTx(tx, userId, flipped, "direction_changed")) {
      touchedWallets.set(`${target.tripId}:${target.walletId}`, target);
    }
    for (const target of touchedWallets.values()) {
      await TripRepository.recalculateWalletEntriesToBase(userId, target.tripId, target.walletId, {
        mode: "weighted",
      }).catch(TripRepository.recalcFailed);
    }
  }

  /** Bank transactions (`t`) not yet behind any trip record of this user. */
  private static unusedByAnyTripSql(userId: string) {
    return Prisma.sql`NOT EXISTS (
      SELECT 1
      FROM trip_fundings tf
      INNER JOIN trips used_trip ON used_trip.id = tf.trip_id
      WHERE used_trip.user_id = ${userId} AND tf.bank_transaction_id = t.id
    ) AND NOT EXISTS (
      SELECT 1
      FROM trip_entries te
      INNER JOIN trips used_trip ON used_trip.id = te.trip_id
      WHERE used_trip.user_id = ${userId}
        AND (
          te.source_transaction_id = t.id
          OR te.metadata->'fundingOut'->>'bankTransactionId' = t.id
        )
    )`;
  }

  static async getFundingCandidates(
    userId: string,
    tripId: string,
    search?: string,
    limit: number = 100,
    offset: number = 0,
  ) {
    const query = search?.trim();
    const cappedLimit = Math.max(1, Math.min(limit, 300));
    const cappedOffset = Math.max(0, offset);
    const whereConditions: Prisma.Sql[] = [Prisma.sql`t.user_id = ${userId}`];

    if (query) {
      whereConditions.push(
        Prisma.sql`(t.description ILIKE ${`%${query}%`} OR COALESCE(t.label, '') ILIKE ${`%${query}%`})`,
      );
    }

    whereConditions.push(TripRepository.unusedByAnyTripSql(userId));

    const [rows, countRows] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT
          t.id,
          t.date,
          t.description,
          t.label,
          t.amount_in AS "amountIn",
          t.amount_out AS "amountOut",
          t.account_number AS "accountIdentifier",
          c.id AS "categoryId",
          c.name AS "categoryName",
          c.color AS "categoryColor"
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE ${Prisma.join(whereConditions, " AND ")}
        ORDER BY t.date DESC
        LIMIT ${cappedLimit}
        OFFSET ${cappedOffset}
      `,
      prisma.$queryRaw<Array<{ total: bigint | number }>>`
        SELECT COUNT(*)::bigint AS total
        FROM transactions t
        WHERE ${Prisma.join(whereConditions, " AND ")}
      `,
    ]);

    const transactions = rows.map((row) => ({
      id: row.id,
      date: row.date,
      description: row.description,
      label: row.label,
      amountIn: row.amountIn !== null ? Number(row.amountIn) : null,
      amountOut: row.amountOut !== null ? Number(row.amountOut) : null,
      category: row.categoryId
        ? {
            id: row.categoryId,
            name: row.categoryName,
            color: row.categoryColor,
          }
        : null,
      accountIdentifier: row.accountIdentifier,
    }));

    return {
      transactions,
      total: Number(countRows[0]?.total || 0),
    };
  }

  static async getSourceTransactionCandidates(
    userId: string,
    tripId: string,
    search?: string,
    limit: number = 100,
    offset: number = 0,
  ) {
    const query = search?.trim();
    const cappedLimit = Math.max(1, Math.min(limit, 300));
    const cappedOffset = Math.max(0, offset);
    const whereConditions: Prisma.Sql[] = [Prisma.sql`t.user_id = ${userId}`];

    if (query) {
      whereConditions.push(
        Prisma.sql`(t.description ILIKE ${`%${query}%`} OR COALESCE(t.label, '') ILIKE ${`%${query}%`})`,
      );
    }

    whereConditions.push(TripRepository.unusedByAnyTripSql(userId));

    const [rows, countRows] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT
          t.id,
          t.date,
          t.description,
          t.label,
          t.amount_in AS "amountIn",
          t.amount_out AS "amountOut",
          t.account_number AS "accountIdentifier",
          c.id AS "categoryId",
          c.name AS "categoryName",
          c.color AS "categoryColor"
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE ${Prisma.join(whereConditions, " AND ")}
        ORDER BY t.date DESC
        LIMIT ${cappedLimit}
        OFFSET ${cappedOffset}
      `,
      prisma.$queryRaw<Array<{ total: bigint | number }>>`
        SELECT COUNT(*)::bigint AS total
        FROM transactions t
        WHERE ${Prisma.join(whereConditions, " AND ")}
      `,
    ]);

    const transactions = rows.map((row) => ({
      id: row.id,
      date: row.date,
      description: row.description,
      label: row.label,
      amountIn: row.amountIn !== null ? Number(row.amountIn) : null,
      amountOut: row.amountOut !== null ? Number(row.amountOut) : null,
      category: row.categoryId
        ? {
            id: row.categoryId,
            name: row.categoryName,
            color: row.categoryColor,
          }
        : null,
      accountIdentifier: row.accountIdentifier,
    }));

    return {
      transactions,
      total: Number(countRows[0]?.total || 0),
    };
  }

  static async getOutgoingFundingEntryCandidates(
    userId: string,
    tripId: string,
    sourceTripId?: string,
    search?: string,
    limit: number = 100,
    offset: number = 0,
  ) {
    const cappedLimit = Math.max(1, Math.min(limit, 300));
    const cappedOffset = Math.max(0, offset);
    const query = search?.trim();

    const [trip] = await prisma.$queryRaw<Array<{ id: string; name: string; baseCurrency: string }>>`
      SELECT id, name, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!trip) {
      throw new Error("Trip not found or unauthorized");
    }

    const whereConditions: Prisma.Sql[] = [
      Prisma.sql`te.type = 'funding_out'`,
      Prisma.sql`t.user_id = ${userId}`,
      Prisma.sql`te.trip_id <> ${tripId}`,
      Prisma.sql`NOT EXISTS (
        SELECT 1
        FROM trip_fundings tf
        WHERE
          tf.trip_id = ${tripId}
          AND COALESCE(tf.metadata->>'sourceTripEntryId', '') = te.id
      )`,
    ];

    if (sourceTripId) {
      whereConditions.push(Prisma.sql`te.trip_id = ${sourceTripId}`);
    }

    if (query) {
      const pattern = `%${query}%`;
      whereConditions.push(
        Prisma.sql`(te.description ILIKE ${pattern} OR COALESCE(te.label, '') ILIKE ${pattern} OR t.name ILIKE ${pattern})`,
      );
    }

    const [rows, countRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          id: string;
          date: Date;
          description: string;
          label: string | null;
          amountOut: unknown;
          localCurrency: string;
          sourceTripId: string;
          sourceTripName: string;
        }>
      >`
        SELECT
          te.id,
          te.transaction_date AS date,
          te.description,
          te.label,
          te.local_amount AS "amountOut",
          te.local_currency AS "localCurrency",
          te.trip_id AS "sourceTripId",
          t.name AS "sourceTripName"
        FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id
        WHERE ${Prisma.join(whereConditions, " AND ")}
        ORDER BY te.transaction_date DESC, te.id DESC
        LIMIT ${cappedLimit}
        OFFSET ${cappedOffset}
      `,
      prisma.$queryRaw<Array<{ total: bigint | number }>>`
        SELECT COUNT(*)::bigint AS total
        FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id
        WHERE ${Prisma.join(whereConditions, " AND ")}
      `,
    ]);

    return {
      transactions: rows.map((row) => ({
        id: row.id,
        date: row.date,
        description: row.description,
        label: row.label,
        amountIn: null,
        amountOut: row.amountOut !== null ? Number(row.amountOut) : null,
        accountIdentifier: null,
        category: null,
        metadata: {
          sourceTripId: row.sourceTripId,
          sourceTripName: row.sourceTripName,
          localCurrency: row.localCurrency,
        },
      })),
      total: Number(countRows[0]?.total || 0),
    };
  }

  static async addFundingsFromOutgoingEntries(
    userId: string,
    tripId: string,
    sourceEntryIds: string[],
    walletId?: string | null,
  ) {
    const uniqueIds = Array.from(new Set(sourceEntryIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      throw new Error("No outgoing entries selected");
    }

    const [trip] = await prisma.$queryRaw<Array<{ id: string; name: string; baseCurrency: string }>>`
      SELECT id, name, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!trip) {
      throw new Error("Trip not found or unauthorized");
    }

    if (walletId) {
      const [wallet] = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT w.id
        FROM wallets w
        INNER JOIN trips t ON t.id = w.trip_id
        WHERE w.id = ${walletId} AND w.trip_id = ${tripId} AND t.user_id = ${userId}
        LIMIT 1
      `;
      if (!wallet) {
        throw new Error("Wallet not found or unauthorized");
      }
    }

    const sourceRows = await prisma.$queryRaw<
      Array<{
        id: string;
        sourceTripId: string;
        sourceTripName: string;
        date: Date;
        description: string;
        label: string | null;
        localCurrency: string;
        localAmount: unknown;
        baseAmount: unknown;
        fxRate: unknown;
        metadata: unknown;
      }>
    >`
      SELECT
        te.id,
        te.trip_id AS "sourceTripId",
        t.name AS "sourceTripName",
        te.transaction_date AS date,
        te.description,
        te.label,
        te.local_currency AS "localCurrency",
        te.local_amount AS "localAmount",
        te.base_amount AS "baseAmount",
        te.fx_rate AS "fxRate",
        te.metadata
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      WHERE
        te.id IN (${Prisma.join(uniqueIds)})
        AND te.type = 'funding_out'
        AND te.trip_id <> ${tripId}
        AND t.user_id = ${userId}
    `;

    // An outgoing entry can fund one trip only.
    const linkedRows = await prisma.$queryRaw<Array<{ sourceTripEntryId: string; tripId: string; tripName: string }>>`
      SELECT
        tf.metadata->>'sourceTripEntryId' AS "sourceTripEntryId",
        tf.trip_id AS "tripId",
        t.name AS "tripName"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      WHERE
        t.user_id = ${userId}
        AND tf.source_type = 'from_trip_outgoing'
        AND tf.metadata->>'sourceTripEntryId' = ANY(${uniqueIds})
    `;
    const linkedBySource = new Map(linkedRows.map((row) => [row.sourceTripEntryId, row]));
    const elsewhere = linkedRows.find((row) => row.tripId !== tripId);
    if (elsewhere) {
      throw Object.assign(
        new Error(`That transfer already funds the trip "${elsewhere.tripName}".`),
        { status: 409 },
      );
    }

    let created = 0;
    const touchedWallets = new Map<string, { tripId: string; walletId: string }>();
    await prisma.$transaction(async (tx) => {
      for (const source of sourceRows) {
        if (linkedBySource.has(source.id)) continue;
        const sourceMetadata =
          source.metadata && typeof source.metadata === "object"
            ? { ...(source.metadata as Record<string, unknown>) }
            : {};
        const fundingOut =
          sourceMetadata.fundingOut && typeof sourceMetadata.fundingOut === "object"
            ? { ...(sourceMetadata.fundingOut as Record<string, unknown>) }
            : {};
        const localAmount = Number(source.localAmount || 0);
        if (!(localAmount > 0)) continue;
        const destinationCurrency = String(
          fundingOut.destinationCurrency || source.localCurrency || trip.baseCurrency,
        ).toUpperCase();
        const destinationAmount = Number(fundingOut.destinationAmount || 0) || localAmount;

        const downstream = await TripRepository.upsertFundingFromTripOutgoingTx(tx, userId, {
          sourceTripId: source.sourceTripId,
          sourceTripName: source.sourceTripName,
          sourceEntryId: source.id,
          sourceDate: source.date,
          sourceDescription: source.description,
          sourceLabel: source.label,
          destinationTripId: tripId,
          destinationWalletId: walletId ?? null,
          destinationCurrency,
          destinationAmount,
          sourceCurrency: String(source.localCurrency).toUpperCase(),
          sourceAmount: localAmount,
          fxRate: localAmount / destinationAmount,
          baseAmount: Number(source.baseAmount || 0),
          feeAmount: Number(fundingOut.feeAmount || 0) || null,
          feeCurrency: (fundingOut.feeCurrency as string | null | undefined) ?? null,
          sourceMetadata,
        });

        // The sending entry now points here, so later rate changes propagate.
        fundingOut.destinationType = "trip";
        fundingOut.destinationTripId = tripId;
        fundingOut.destinationWalletId = downstream?.walletId ?? null;
        fundingOut.destinationCurrency = destinationCurrency;
        fundingOut.destinationAmount = destinationAmount;
        await tx.$executeRaw`
          UPDATE trip_entries
          SET metadata = ${{ ...sourceMetadata, fundingOut } as Prisma.InputJsonValue}
          WHERE id = ${source.id}
        `;
        if (downstream?.walletId) {
          touchedWallets.set(downstream.walletId, { tripId, walletId: downstream.walletId });
        }
        created += 1;
      }
    });

    await Promise.all(
      Array.from(touchedWallets.values()).map((target) =>
        TripRepository.recalculateWalletEntriesToBase(userId, target.tripId, target.walletId, {
          mode: "weighted",
        }).catch(TripRepository.recalcFailed),
      ),
    );

    return { created };
  }

  static async addEntriesFromSourceTransactions(
    userId: string,
    tripId: string,
    input: {
      transactionIds: string[];
      categoryId?: string | null;
      entryType?: "spending" | "reimbursement" | "funding_out" | "settlement";
      /** For settlements: the person this bank payment paid back. */
      counterpartyId?: string | null;
      fundingOut?: {
        destinationType?: "bank" | "trip" | "wallet" | "external";
        destinationTripId?: string | null;
        destinationWalletId?: string | null;
        bankTransactionId?: string | null;
        destinationCurrency?: string | null;
        destinationAmount?: number | null;
        fxRate?: number | null;
        feeAmount?: number | null;
        feeCurrency?: string | null;
      } | null;
    },
  ) {
    const uniqueIds = Array.from(new Set(input.transactionIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      throw new Error("No transactions selected");
    }
    if (input.entryType === "settlement") {
      if (!input.counterpartyId) throw new Error("Choose who this payment settled up with.");
      await TripIouRepository.assertParticipant(prisma, tripId, input.counterpartyId);
    }

    const [trip] = await prisma.$queryRaw<Array<{ id: string; name: string; baseCurrency: string }>>`
      SELECT id, name, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!trip) {
      throw new Error("Trip not found or unauthorized");
    }

    if (input.categoryId) {
      const [category] = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM categories
        WHERE id = ${input.categoryId} AND user_id = ${userId}
        LIMIT 1
      `;
      if (!category) {
        throw new Error("Category not found or unauthorized");
      }
    }

    const existingRows = await prisma.$queryRaw<Array<{ sourceTransactionId: string }>>`
      SELECT source_transaction_id AS "sourceTransactionId"
      FROM trip_entries
      WHERE trip_id = ${tripId} AND source_transaction_id IN (${Prisma.join(uniqueIds)})
    `;
    const existing = new Set(existingRows.map((row) => row.sourceTransactionId));

    const sourceTransactions = await prisma.$queryRaw<
      Array<{
        id: string;
        date: Date;
        description: string;
        label: string | null;
        amountIn: unknown;
        amountOut: unknown;
        currency: string | null;
        metadata: unknown;
      }>
    >`
      SELECT
        t.id,
        t.date,
        t.description,
        t.label,
        t.amount_in AS "amountIn",
        t.amount_out AS "amountOut",
        t.currency,
        t.metadata
      FROM transactions t
      WHERE t.user_id = ${userId} AND t.id IN (${Prisma.join(uniqueIds)})
    `;

    for (const source of sourceTransactions) {
      if (existing.has(source.id)) continue;
      // Bank amounts become the entry's base value, so they must be in the trip's currency.
      const currency = String(source.currency || trip.baseCurrency).toUpperCase();
      if (currency !== trip.baseCurrency.toUpperCase()) {
        throw new Error(
          `"${source.description}" is in ${currency} but this trip is in ${trip.baseCurrency}. Add it as a manual entry with a rate instead.`,
        );
      }
      await TripRepository.assertBankTransactionAvailable(prisma, userId, source.id);
    }

    let created = 0;
    const touchedWallets = new Map<string, { tripId: string; walletId: string }>();
    await prisma.$transaction(async (tx) => {
      for (const source of sourceTransactions) {
        if (existing.has(source.id)) continue;

        const amountOut = source.amountOut !== null ? Number(source.amountOut) : 0;
        const amountIn = source.amountIn !== null ? Number(source.amountIn) : 0;
        const resolvedType =
          input.entryType ??
          (amountOut > 0 ? "spending" : amountIn > 0 ? "reimbursement" : null);

        if (!resolvedType) continue;

        if (resolvedType === "settlement" && !(amountOut > 0)) {
          throw new Error("A settlement must be a payment out of the bank account.");
        }
        if (resolvedType === "spending" && !(amountOut > 0)) {
          throw new Error(
            "Selected bank transaction must be a debit (amount out) to add as trip spending.",
          );
        }
        if (resolvedType === "reimbursement" && !(amountIn > 0)) {
          throw new Error(
            "Selected bank transaction must be a credit (amount in) to add as trip reimbursement.",
          );
        }
        if (resolvedType === "funding_out" && !(amountIn > 0)) {
          throw new Error(
            "Selected bank transaction must be a credit (amount in) to add as trip funding out.",
          );
        }

        const baseAmount =
          resolvedType === "spending" || resolvedType === "settlement" ? amountOut : amountIn;
        if (!(baseAmount > 0)) continue;

        let fundingOutMetadata: Record<string, unknown> | null = null;
        let normalizedFundingOut:
          | Awaited<ReturnType<typeof TripRepository.normalizeFundingOutConfig>>
          | null = null;
        const fundingOutSourceCurrency = trip.baseCurrency;
        const fundingOutSourceAmount = baseAmount;
        if (resolvedType === "funding_out") {
          const requestedDestinationType = String(
            input.fundingOut?.destinationType || "bank",
          ).toLowerCase() as "bank" | "trip" | "external";
          const defaultBankTransactionId =
            requestedDestinationType === "bank" ? source.id : null;

          normalizedFundingOut = await TripRepository.normalizeFundingOutConfig(
            tx,
            userId,
            {
              tripBaseCurrency: trip.baseCurrency,
              sourceCurrency: fundingOutSourceCurrency,
              sourceAmount: fundingOutSourceAmount,
              sourceBaseAmount: baseAmount,
              fundingOut: {
                destinationType: requestedDestinationType,
                destinationTripId: input.fundingOut?.destinationTripId ?? null,
                bankTransactionId:
                  input.fundingOut?.bankTransactionId ?? defaultBankTransactionId,
                destinationCurrency:
                  input.fundingOut?.destinationCurrency ?? trip.baseCurrency,
                destinationAmount: input.fundingOut?.destinationAmount ?? null,
                fxRate: input.fundingOut?.fxRate ?? null,
                feeAmount: input.fundingOut?.feeAmount ?? null,
                feeCurrency: input.fundingOut?.feeCurrency ?? null,
              },
            },
          );
          fundingOutMetadata = {
            destinationType: normalizedFundingOut.destinationType,
            destinationTripId: normalizedFundingOut.destinationTripId,
            bankTransactionId: normalizedFundingOut.bankTransactionId,
            destinationCurrency: normalizedFundingOut.destinationCurrency,
            destinationAmount: normalizedFundingOut.destinationAmount,
            fxRate: normalizedFundingOut.fxRate,
            feeAmount: normalizedFundingOut.feeAmount,
            feeCurrency: normalizedFundingOut.feeCurrency,
            feeBaseAmount: normalizedFundingOut.feeBaseAmount,
            autoLinkedBankCredit:
              normalizedFundingOut.bankTransactionId === source.id,
          };
        }

        const metadataPayload = {
          importedFromMainTransactions: true,
          sourceTransactionId: source.id,
          sourceMetadata: source.metadata ?? null,
          ...(resolvedType === "funding_out" && fundingOutMetadata
            ? {
                fundingOut: fundingOutMetadata,
              }
            : {}),
        } as Prisma.InputJsonValue;

        const entryId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO trip_entries (
            id,
            trip_id,
            wallet_id,
            source_type,
            source_transaction_id,
            type,
            transaction_date,
            description,
            label,
            local_currency,
            local_amount,
            fx_rate,
            base_amount,
            fee_amount,
            fee_currency,
            category_id,
            linked_entry_id,
            counterparty_id,
            metadata,
            created_at
          )
          VALUES (
            ${entryId},
            ${tripId},
            NULL,
            ${resolvedType === "funding_out"
              ? "external_bank_funding_out"
              : resolvedType === "settlement"
                ? "external_bank_settlement"
                : "external_bank"},
            ${source.id},
            ${resolvedType},
            ${source.date},
            ${source.description},
            ${source.label},
            ${trip.baseCurrency},
            ${baseAmount},
            1,
            ${baseAmount},
            ${normalizedFundingOut?.feeAmount ?? null},
            ${normalizedFundingOut?.feeCurrency ?? null},
            ${resolvedType === "spending" ? input.categoryId ?? null : null},
            NULL,
            ${resolvedType === "settlement" ? input.counterpartyId : null},
            ${metadataPayload},
            NOW()
          )
        `;

        if (resolvedType === "settlement") {
          const ious = await TripIouRepository.allocateSettlementTx(tx, tripId, entryId);
          const touched = await TripRepository.reconcileReimbursementAllocationsTx(tx, tripId, ious);
          await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, touched);
        }

        if (
          resolvedType === "funding_out" &&
          normalizedFundingOut?.destinationType === "trip" &&
          normalizedFundingOut.destinationTripId
        ) {
          const downstream = await TripRepository.upsertFundingFromTripOutgoingTx(tx, userId, {
            sourceTripId: tripId,
            sourceTripName: trip.name,
            sourceEntryId: entryId,
            sourceDate: source.date,
            sourceDescription: source.description,
            sourceLabel: source.label ?? null,
            destinationTripId: normalizedFundingOut.destinationTripId,
            destinationCurrency: normalizedFundingOut.destinationCurrency,
            destinationAmount: normalizedFundingOut.destinationAmount,
            sourceCurrency: fundingOutSourceCurrency,
            sourceAmount: fundingOutSourceAmount,
            fxRate: normalizedFundingOut.fxRate,
            baseAmount: baseAmount,
            feeAmount: normalizedFundingOut.feeAmount,
            feeCurrency: normalizedFundingOut.feeCurrency,
            sourceMetadata:
              metadataPayload && typeof metadataPayload === "object"
                ? (metadataPayload as Record<string, unknown>)
                : null,
          });
          if (downstream?.walletId) {
            touchedWallets.set(
              `${normalizedFundingOut.destinationTripId}:${downstream.walletId}`,
              {
                tripId: normalizedFundingOut.destinationTripId,
                walletId: downstream.walletId,
              },
            );
          }
        }

        created += 1;
      }
    });

    if (touchedWallets.size > 0) {
      await Promise.all(
        Array.from(touchedWallets.values()).map((item) =>
          TripRepository.recalculateWalletEntriesToBase(
            userId,
            item.tripId,
            item.walletId,
            { mode: "weighted" },
          ).catch(TripRepository.recalcFailed),
        ),
      );
    }

    return { created };
  }

  /**
   * The base value of a new entry. Amounts already in the trip's currency need no rate;
   * otherwise the caller's base amount or rate wins (and is kept through later wallet
   * recalculations), else the wallet's average rate applies.
   */
  private static async resolveEntryValuation(input: {
    tripId: string;
    walletId: string | null;
    walletCurrency: string | null;
    tripBaseCurrency: string;
    localCurrency: string;
    localAmount: number;
    baseAmount: number | null;
    fxRate: number | null;
  }) {
    const localCurrency = normalizeCurrencyCode(input.localCurrency);
    const baseCurrency = input.tripBaseCurrency.toUpperCase();
    const localAmount = Number(input.localAmount || 0);
    if (!(localAmount > 0)) throw new Error("Amount must be greater than 0.");
    if (localCurrency === baseCurrency) {
      return { localCurrency, baseAmount: localAmount, fxRate: 1, locked: false };
    }
    const givenBase = input.baseAmount !== null && input.baseAmount > 0 ? input.baseAmount : null;
    const givenRate = input.fxRate !== null && input.fxRate > 0 ? input.fxRate : null;
    if (givenBase !== null && givenRate !== null && Math.abs(givenBase - localAmount * givenRate) > 0.01) {
      throw new Error(`The ${baseCurrency} amount doesn't match the amount times the rate.`);
    }
    if (givenBase !== null) {
      return { localCurrency, baseAmount: givenBase, fxRate: givenBase / localAmount, locked: true };
    }
    if (givenRate !== null) {
      return { localCurrency, baseAmount: TripRepository.roundMoney(localAmount * givenRate), fxRate: givenRate, locked: true };
    }
    if (input.walletId && input.walletCurrency === localCurrency) {
      const rate = await TripRepository.getWalletWeightedFxRate(input.tripId, input.walletId).catch(() => null);
      if (rate) {
        return { localCurrency, baseAmount: TripRepository.roundMoney(localAmount * rate), fxRate: rate, locked: false };
      }
      throw new Error(
        `This wallet has no funding to take a rate from yet. Enter the ${baseCurrency} amount or a rate.`,
      );
    }
    // Without a wallet (e.g. an IOU), a wallet holding that currency gives an estimate.
    if (!input.walletId) {
      const [sameCurrencyWallet] = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM wallets WHERE trip_id = ${input.tripId} AND UPPER(currency) = ${localCurrency}
        ORDER BY created_at ASC LIMIT 1
      `;
      const rate = sameCurrencyWallet
        ? await TripRepository.getWalletWeightedFxRate(input.tripId, sameCurrencyWallet.id).catch(() => null)
        : null;
      if (rate) {
        return { localCurrency, baseAmount: TripRepository.roundMoney(localAmount * rate), fxRate: rate, locked: false };
      }
    }
    throw new Error(`Enter the ${baseCurrency} amount or a rate for an amount in ${localCurrency}.`);
  }

  static async createTripEntry(
    userId: string,
    tripId: string,
    input: {
      walletId?: string | null;
      type: "spending" | "reimbursement" | "funding_out" | "settlement";
      /** Spending someone else paid for: makes the entry an IOU to that person. */
      paidByParticipantId?: string | null;
      /** The person a settlement paid back. */
      counterpartyId?: string | null;
      date: Date;
      description: string;
      label?: string | null;
      categoryId?: string | null;
      localCurrency: string;
      localAmount: number;
      /** Optional for wallet entries in the wallet's currency: the wallet's rate is used. */
      baseAmount?: number | null;
      fxRate?: number | null;
      feeAmount?: number | null;
      feeCurrency?: string | null;
      fundingOut?: {
        destinationType?: "bank" | "trip" | "wallet" | "external";
        destinationTripId?: string | null;
        destinationWalletId?: string | null;
        bankTransactionId?: string | null;
        destinationCurrency?: string | null;
        destinationAmount?: number | null;
        fxRate?: number | null;
        feeAmount?: number | null;
        feeCurrency?: string | null;
      } | null;
      metadata?: Prisma.InputJsonValue | null;
    },
  ) {
    const [trip] = await prisma.$queryRaw<Array<{ id: string; name: string; baseCurrency: string }>>`
      SELECT id, name, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!trip) {
      throw new Error("Trip not found or unauthorized");
    }

    const isIou = input.type === "spending" && !!input.paidByParticipantId;
    if (isIou) {
      if (input.walletId) throw new Error("An IOU isn't paid from your wallets; leave the wallet empty.");
      await TripIouRepository.assertParticipant(prisma, tripId, input.paidByParticipantId as string);
    }
    if (input.type === "settlement") {
      if (!input.counterpartyId) throw new Error("Choose who this settlement paid back.");
      await TripIouRepository.assertParticipant(prisma, tripId, input.counterpartyId);
    }
    const counterpartyId = isIou
      ? (input.paidByParticipantId as string)
      : input.type === "settlement"
        ? (input.counterpartyId as string)
        : null;

    let walletCurrency: string | null = null;
    if (input.walletId) {
      const [wallet] = await prisma.$queryRaw<Array<{ id: string; currency: string }>>`
        SELECT w.id, w.currency
        FROM wallets w
        INNER JOIN trips t ON t.id = w.trip_id
        WHERE w.id = ${input.walletId} AND w.trip_id = ${tripId} AND t.user_id = ${userId}
        LIMIT 1
      `;
      if (!wallet) {
        throw new Error("Wallet not found or unauthorized");
      }
      walletCurrency = wallet.currency.toUpperCase();
    }

    const valuation = await TripRepository.resolveEntryValuation({
      tripId,
      walletId: input.walletId ?? null,
      walletCurrency,
      tripBaseCurrency: trip.baseCurrency,
      localCurrency: input.localCurrency,
      localAmount: input.localAmount,
      baseAmount: input.baseAmount ?? null,
      fxRate: input.fxRate ?? null,
    });
    input = {
      ...input,
      localCurrency: valuation.localCurrency,
      baseAmount: valuation.baseAmount,
      fxRate: valuation.fxRate,
    };

    if (input.type === "spending" && input.categoryId) {
      const [category] = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM categories
        WHERE id = ${input.categoryId} AND user_id = ${userId}
        LIMIT 1
      `;
      if (!category) {
        throw new Error("Category not found or unauthorized");
      }
    }

    const id = randomUUID();
    const resolvedFxRate = valuation.fxRate;

    let destinationWalletCurrency: string | null = null;
    if (input.type === "funding_out" && input.fundingOut?.destinationType === "wallet") {
      const targetId = input.fundingOut.destinationWalletId;
      if (!targetId || targetId === input.walletId) {
        throw new Error("Choose a different wallet in this trip to move the money into.");
      }
      const [target] = await prisma.$queryRaw<Array<{ currency: string }>>`
        SELECT currency FROM wallets WHERE id = ${targetId} AND trip_id = ${tripId} LIMIT 1
      `;
      if (!target) throw new Error("Destination wallet not found in this trip.");
      destinationWalletCurrency = target.currency.toUpperCase();
    }

    const normalizedFundingOut =
      input.type === "funding_out"
        ? await TripRepository.normalizeFundingOutConfig(
            prisma,
            userId,
            {
              tripBaseCurrency: trip.baseCurrency,
              sourceCurrency: String(input.localCurrency || "").toUpperCase(),
              sourceAmount: Number(input.localAmount || 0),
              sourceBaseAmount: Number(input.baseAmount || 0),
              fundingOut: {
                destinationType: input.fundingOut?.destinationType || "external",
                destinationTripId: input.fundingOut?.destinationTripId ?? null,
                destinationWalletId: input.fundingOut?.destinationWalletId ?? null,
                bankTransactionId: input.fundingOut?.bankTransactionId ?? null,
                destinationCurrency:
                  destinationWalletCurrency ?? input.fundingOut?.destinationCurrency ?? null,
                destinationAmount: input.fundingOut?.destinationAmount ?? null,
                fxRate: input.fundingOut?.fxRate ?? null,
                feeAmount: input.fundingOut?.feeAmount ?? null,
                feeCurrency: input.fundingOut?.feeCurrency ?? null,
              },
            },
          )
        : null;
    const fundingOutMetadata =
      normalizedFundingOut && input.type === "funding_out"
        ? {
            destinationType: normalizedFundingOut.destinationType,
            destinationTripId: normalizedFundingOut.destinationTripId,
            destinationWalletId: normalizedFundingOut.destinationWalletId,
            bankTransactionId: normalizedFundingOut.bankTransactionId,
            destinationCurrency: normalizedFundingOut.destinationCurrency,
            destinationAmount: normalizedFundingOut.destinationAmount,
            fxRate: normalizedFundingOut.fxRate,
            feeAmount: normalizedFundingOut.feeAmount,
            feeCurrency: normalizedFundingOut.feeCurrency,
            feeBaseAmount: normalizedFundingOut.feeBaseAmount,
          }
        : null;

    // Client metadata comes first so it cannot replace what the server derived.
    const clientMetadata =
      input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? { ...(input.metadata as Record<string, unknown>) }
        : {};
    for (const key of ["linkage", "fundingOut", "baseAmountLocked", "manualEntry", "iou"]) {
      delete clientMetadata[key];
    }
    const metadataPayload = {
      ...clientMetadata,
      manualEntry: true,
      // An IOU's value is an estimate until it is settled.
      ...(isIou ? { iou: { estimateFxRate: valuation.fxRate } } : {}),
      ...(valuation.locked && !isIou ? { baseAmountLocked: true } : {}),
      ...(input.type === "funding_out" && fundingOutMetadata
        ? {
            fundingOut: fundingOutMetadata,
          }
        : {}),
    } satisfies Record<string, unknown>;

    const touchedWallets = new Map<string, { tripId: string; walletId: string }>();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO trip_entries (
          id,
          trip_id,
          wallet_id,
          source_type,
          source_transaction_id,
          type,
          transaction_date,
          description,
          label,
          local_currency,
          local_amount,
          fx_rate,
          base_amount,
          fee_amount,
          fee_currency,
          category_id,
          linked_entry_id,
          counterparty_id,
          metadata,
          created_at
        )
        VALUES (
          ${id},
          ${tripId},
          ${input.walletId ?? null},
          ${isIou
            ? "iou"
            : input.type === "settlement"
              ? input.walletId
                ? "manual_settlement_wallet"
                : "manual_settlement"
              : input.type === "funding_out"
            ? normalizedFundingOut?.destinationType === "wallet"
              ? "wallet_conversion_out"
              : input.walletId
                ? "manual_funding_out_wallet"
                : "manual_funding_out"
            : input.walletId
              ? "manual_wallet"
              : "manual_no_wallet"},
          NULL,
          ${input.type},
          ${input.date},
          ${input.description},
          ${input.label ?? null},
          ${input.localCurrency},
          ${input.localAmount},
          ${resolvedFxRate},
          ${input.baseAmount},
          ${input.type === "funding_out"
            ? (normalizedFundingOut?.feeAmount ?? input.feeAmount ?? null)
            : (input.feeAmount ?? null)},
          ${input.type === "funding_out"
            ? (normalizedFundingOut?.feeCurrency ?? input.feeCurrency ?? null)
            : (input.feeCurrency ?? null)},
          ${input.type === "spending" ? input.categoryId ?? null : null},
          NULL,
          ${counterpartyId},
          ${metadataPayload as Prisma.InputJsonValue},
          NOW()
        )
      `;

      if (input.type === "settlement") {
        const ious = await TripIouRepository.allocateSettlementTx(tx, tripId, id);
        const touched = await TripRepository.reconcileReimbursementAllocationsTx(tx, tripId, ious);
        await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, touched);
      }

      if (input.walletId) {
        touchedWallets.set(`${tripId}:${input.walletId}`, {
          tripId,
          walletId: input.walletId,
        });
      }

      if (
        input.type === "funding_out" &&
        (normalizedFundingOut?.destinationType === "trip" ||
          normalizedFundingOut?.destinationType === "wallet")
      ) {
        const sameTrip = normalizedFundingOut.destinationType === "wallet";
        const destinationTripId = sameTrip ? tripId : normalizedFundingOut.destinationTripId;
        if (destinationTripId) {
          const downstream = await TripRepository.upsertFundingFromTripOutgoingTx(tx, userId, {
            sourceTripId: tripId,
            sourceTripName: trip.name,
            sourceEntryId: id,
            sourceDate: input.date,
            sourceDescription: input.description,
            sourceLabel: input.label ?? null,
            destinationTripId,
            destinationCurrency: normalizedFundingOut.destinationCurrency,
            destinationAmount: normalizedFundingOut.destinationAmount,
            sourceCurrency: String(input.localCurrency || "").toUpperCase(),
            sourceAmount: Number(input.localAmount || 0),
            fxRate: normalizedFundingOut.fxRate,
            baseAmount: Number(input.baseAmount || 0),
            feeAmount: normalizedFundingOut.feeAmount,
            feeCurrency: normalizedFundingOut.feeCurrency,
            sourceMetadata: metadataPayload,
            fundingSourceType: sameTrip ? "wallet_conversion" : "from_trip_outgoing",
            destinationWalletId: normalizedFundingOut.destinationWalletId,
          });
          if (downstream?.walletId) {
            touchedWallets.set(`${destinationTripId}:${downstream.walletId}`, {
              tripId: destinationTripId,
              walletId: downstream.walletId,
            });
          }
        }
      }
    });

    if (touchedWallets.size > 0) {
      await Promise.all(
        Array.from(touchedWallets.values()).map((item) =>
          TripRepository.recalculateWalletEntriesToBase(
            userId,
            item.tripId,
            item.walletId,
            { mode: "weighted" },
          ).catch(TripRepository.recalcFailed),
        ),
      );
    }

    return { id };
  }

  /** Chooses which IOUs a settlement pays off, and how much of each. */
  static async setSettlementAllocations(
    userId: string,
    tripId: string,
    settlementId: string,
    items: Array<{ iouEntryId: string; localAmount: number }>,
  ) {
    await TripIouRepository.assertTripOwned(prisma, userId, tripId);
    await prisma.$transaction(async (tx) => {
      const ious = await TripIouRepository.allocateSettlementTx(tx, tripId, settlementId, items);
      const touched = await TripRepository.reconcileReimbursementAllocationsTx(tx, tripId, ious);
      await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, touched);
    });
    return TripIouRepository.getBalances(userId, tripId);
  }

  /**
   * Edits a saved trip entry. Funding entries are edited through their funding; entries
   * taken from a bank transaction keep the bank's amount. Changed amounts are valued like
   * new entries, and reimbursements, linked transfers and wallets follow.
   */
  static async updateTripEntry(
    userId: string,
    tripId: string,
    entryId: string,
    input: {
      date?: Date;
      description?: string;
      label?: string | null;
      categoryId?: string | null;
      walletId?: string | null;
      localCurrency?: string;
      localAmount?: number;
      baseAmount?: number | null;
      fxRate?: number | null;
      fundingOut?: {
        destinationType?: "bank" | "trip" | "wallet" | "external";
        destinationTripId?: string | null;
        destinationWalletId?: string | null;
        bankTransactionId?: string | null;
        destinationCurrency?: string | null;
        destinationAmount?: number | null;
        fxRate?: number | null;
        feeAmount?: number | null;
        feeCurrency?: string | null;
      } | null;
    },
  ) {
    const [entry] = await prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        sourceType: string;
        walletId: string | null;
        sourceTransactionId: string | null;
        transactionDate: Date;
        description: string;
        label: string | null;
        localCurrency: string;
        localAmount: unknown;
        fxRate: unknown;
        baseAmount: unknown;
        metadata: unknown;
        baseCurrency: string;
        tripName: string;
      }>
    >`
      SELECT
        te.id, te.type, te.source_type AS "sourceType", te.wallet_id AS "walletId",
        te.source_transaction_id AS "sourceTransactionId", te.transaction_date AS "transactionDate",
        te.description, te.label, te.local_currency AS "localCurrency", te.local_amount AS "localAmount",
        te.fx_rate AS "fxRate", te.base_amount AS "baseAmount", te.metadata,
        t.base_currency AS "baseCurrency", t.name AS "tripName"
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      WHERE te.id = ${entryId} AND te.trip_id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;
    if (!entry) throw new Error("Trip entry not found or unauthorized");
    if (entry.type === "funding_in") {
      throw new Error("Edit this funding from the trip's funding page.");
    }
    const metadata =
      entry.metadata && typeof entry.metadata === "object"
        ? { ...(entry.metadata as Record<string, unknown>) }
        : {};

    const nextWalletId = input.walletId === undefined ? entry.walletId : input.walletId;
    let walletCurrency: string | null = null;
    if (nextWalletId) {
      const [wallet] = await prisma.$queryRaw<Array<{ currency: string }>>`
        SELECT currency FROM wallets WHERE id = ${nextWalletId} AND trip_id = ${tripId} LIMIT 1
      `;
      if (!wallet) throw new Error("Wallet not found in this trip.");
      walletCurrency = wallet.currency.toUpperCase();
    }
    const nextCurrency = (input.localCurrency ?? entry.localCurrency).toUpperCase();
    const nextLocal = input.localAmount ?? Number(entry.localAmount);
    const amountChanged =
      nextCurrency !== entry.localCurrency.toUpperCase() ||
      Math.abs(nextLocal - Number(entry.localAmount)) > 0.00005;
    if (entry.sourceTransactionId && amountChanged) {
      throw new Error("This entry comes from a bank transaction. Change the amount on the bank transaction instead.");
    }
    const isIou = entry.sourceType === "iou";
    if (isIou && nextWalletId) throw new Error("An IOU isn't paid from your wallets.");
    if (isIou && amountChanged) {
      const [settled] = await prisma.$queryRaw<Array<{ local: unknown }>>`
        SELECT COALESCE(SUM(iou_local_amount), 0) AS local FROM trip_settlement_allocations WHERE iou_entry_id = ${entryId}
      `;
      if (nextLocal - Number(settled.local) < -0.0001) {
        throw new Error(`${Number(settled.local)} ${nextCurrency} of this IOU is already settled; it can't be smaller.`);
      }
      if (nextCurrency !== entry.localCurrency.toUpperCase() && Number(settled.local) > 0) {
        throw new Error("A partly settled IOU can't change currency.");
      }
    }
    if (input.categoryId !== undefined && input.categoryId !== null) {
      if (entry.type !== "spending") throw new Error("Only spending has a category.");
      await TripRepository.assertCategoryOwned(userId, input.categoryId);
    }

    // Re-value only when something that drives the value changed.
    const revalue =
      amountChanged ||
      nextWalletId !== entry.walletId ||
      (input.baseAmount !== undefined && input.baseAmount !== null) ||
      (input.fxRate !== undefined && input.fxRate !== null);
    const wasLocked =
      metadata.baseAmountLocked === true || metadata.manualBaseAmount !== undefined || metadata.manualFxRate !== undefined;
    let localAmount = Number(entry.localAmount);
    let baseAmount = Number(entry.baseAmount);
    let fxRate = Number(entry.fxRate);
    if (revalue) {
      const valuation = await TripRepository.resolveEntryValuation({
        tripId,
        walletId: nextWalletId,
        walletCurrency,
        tripBaseCurrency: entry.baseCurrency,
        localCurrency: nextCurrency,
        localAmount: nextLocal,
        baseAmount: input.baseAmount ?? null,
        // A locked entry keeps its own rate when only the amount changes.
        fxRate: input.fxRate ?? (wasLocked && input.baseAmount == null ? Number(entry.fxRate) : null),
      });
      localAmount = nextLocal;
      baseAmount = valuation.baseAmount;
      fxRate = valuation.fxRate;
      delete metadata.manualBaseAmount;
      delete metadata.manualFxRate;
      if (isIou) {
        metadata.iou = { ...((metadata.iou as Record<string, unknown>) || {}), estimateFxRate: valuation.fxRate };
      } else if (valuation.locked) metadata.baseAmountLocked = true;
      else delete metadata.baseAmountLocked;
    }

    let sourceType = entry.sourceType;
    let normalizedFundingOut: Awaited<ReturnType<typeof TripRepository.normalizeFundingOutConfig>> | null = null;
    const previousFundingOut =
      metadata.fundingOut && typeof metadata.fundingOut === "object"
        ? (metadata.fundingOut as Record<string, unknown>)
        : {};
    if (entry.type === "funding_out" && (revalue || input.fundingOut)) {
      const requested = { ...previousFundingOut, ...(input.fundingOut || {}) } as Record<string, any>;
      if (requested.destinationType === "wallet" && requested.destinationWalletId) {
        const [target] = await prisma.$queryRaw<Array<{ currency: string }>>`
          SELECT currency FROM wallets WHERE id = ${requested.destinationWalletId} AND trip_id = ${tripId} LIMIT 1
        `;
        if (!target) throw new Error("Destination wallet not found in this trip.");
        requested.destinationCurrency = target.currency.toUpperCase();
      }
      normalizedFundingOut = await TripRepository.normalizeFundingOutConfig(prisma, userId, {
        tripBaseCurrency: entry.baseCurrency,
        sourceCurrency: nextCurrency,
        sourceAmount: localAmount,
        sourceBaseAmount: baseAmount,
        fundingOut: {
          ...requested,
          // A new source amount re-derives the destination from the kept rate unless given.
          destinationAmount:
            input.fundingOut?.destinationAmount ?? (amountChanged ? null : requested.destinationAmount ?? null),
        },
      });
      metadata.fundingOut = {
        ...previousFundingOut,
        destinationType: normalizedFundingOut.destinationType,
        destinationTripId: normalizedFundingOut.destinationTripId,
        destinationWalletId: normalizedFundingOut.destinationWalletId,
        bankTransactionId: normalizedFundingOut.bankTransactionId,
        destinationCurrency: normalizedFundingOut.destinationCurrency,
        destinationAmount: normalizedFundingOut.destinationAmount,
        fxRate: normalizedFundingOut.fxRate,
        feeAmount: normalizedFundingOut.feeAmount,
        feeCurrency: normalizedFundingOut.feeCurrency,
        feeBaseAmount: normalizedFundingOut.feeBaseAmount,
      };
      if (normalizedFundingOut.destinationType === "wallet") sourceType = "wallet_conversion_out";
      else if (sourceType === "wallet_conversion_out" && previousFundingOut.destinationType === "wallet") {
        sourceType = nextWalletId ? "manual_funding_out_wallet" : "manual_funding_out";
      }
    }

    const touchedWallets = new Map<string, { tripId: string; walletId: string }>();
    for (const walletId of [entry.walletId, nextWalletId]) {
      if (walletId) touchedWallets.set(`${tripId}:${walletId}`, { tripId, walletId });
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE trip_entries
        SET
          transaction_date = ${input.date ?? entry.transactionDate},
          description = ${input.description ?? entry.description},
          label = ${input.label === undefined ? entry.label : input.label},
          category_id = ${input.categoryId === undefined ? Prisma.sql`category_id` : input.categoryId},
          wallet_id = ${nextWalletId},
          source_type = ${sourceType},
          local_currency = ${nextCurrency},
          local_amount = ${localAmount},
          base_amount = ${TripRepository.roundMoney(baseAmount)},
          fx_rate = ${TripRepository.roundRate(fxRate)},
          metadata = ${metadata as Prisma.InputJsonValue}
        WHERE id = ${entryId} AND trip_id = ${tripId}
      `;

      if (normalizedFundingOut) {
        const linked =
          normalizedFundingOut.destinationType === "trip" || normalizedFundingOut.destinationType === "wallet";
        const destinationTripId =
          normalizedFundingOut.destinationType === "wallet" ? tripId : normalizedFundingOut.destinationTripId;
        const previouslyLinkedElsewhere =
          previousFundingOut.destinationType === "trip" || previousFundingOut.destinationType === "wallet";
        const destinationMoved =
          previouslyLinkedElsewhere &&
          (!linked ||
            (previousFundingOut.destinationType === "wallet" ? tripId : previousFundingOut.destinationTripId) !==
              destinationTripId ||
            previousFundingOut.destinationType !== normalizedFundingOut.destinationType);
        if (destinationMoved) {
          for (const target of await TripRepository.deleteLinkedFundingsFromTripOutgoingTx(tx, userId, [entryId])) {
            touchedWallets.set(`${target.tripId}:${target.walletId}`, target);
          }
        }
        if (linked && destinationTripId) {
          const downstream = await TripRepository.upsertFundingFromTripOutgoingTx(tx, userId, {
            sourceTripId: tripId,
            sourceTripName: entry.tripName,
            sourceEntryId: entryId,
            sourceDate: input.date ?? entry.transactionDate,
            sourceDescription: input.description ?? entry.description,
            sourceLabel: input.label === undefined ? entry.label : input.label,
            destinationTripId,
            destinationWalletId: normalizedFundingOut.destinationWalletId,
            destinationCurrency: normalizedFundingOut.destinationCurrency,
            destinationAmount: normalizedFundingOut.destinationAmount,
            sourceCurrency: nextCurrency,
            sourceAmount: localAmount,
            fxRate: normalizedFundingOut.fxRate,
            baseAmount,
            feeAmount: normalizedFundingOut.feeAmount,
            feeCurrency: normalizedFundingOut.feeCurrency,
            sourceMetadata: metadata,
            fundingSourceType: normalizedFundingOut.destinationType === "wallet" ? "wallet_conversion" : "from_trip_outgoing",
          });
          if (downstream?.walletId) {
            touchedWallets.set(`${destinationTripId}:${downstream.walletId}`, {
              tripId: destinationTripId,
              walletId: downstream.walletId,
            });
          }
        }
      }

      const ious =
        entry.type === "settlement"
          ? await TripIouRepository.reallocateSettlementsTx(tx, tripId, [entryId])
          : isIou
            ? (await TripIouRepository.recomputeIouCostsTx(tx, tripId, [entryId]), [entryId])
            : [];
      const touched = await TripRepository.reconcileReimbursementAllocationsTx(tx, tripId, [entryId, ...ious]);
      await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, [entryId, ...touched]);
      await TripRepository.resyncTripSyncedBankTransactionsTx(tx, userId, tripId, [entryId, ...touched]);
    });

    await Promise.all(
      Array.from(touchedWallets.values()).map((target) =>
        TripRepository.recalculateWalletEntriesToBase(userId, target.tripId, target.walletId, {
          mode: "weighted",
        }).catch(TripRepository.recalcFailed),
      ),
    );
    return { id: entryId };
  }

  static async getTripWalletSummaries(userId: string, tripId: string) {
    const tripRows = await prisma.$queryRaw<Array<{ id: string; baseCurrency: string }>>`
      SELECT id, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!tripRows[0]) throw new Error("Trip not found or unauthorized");
    const trip = tripRows[0];

    const [wallets, balanceRows, fundingBasisRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          id: string;
          tripId: string;
          name: string;
          currency: string;
          color: string;
        }>
      >`
        SELECT
          w.id,
          w.trip_id AS "tripId",
          w.name,
          w.currency,
          w.color
        FROM wallets w
        WHERE w.trip_id = ${tripId}
        ORDER BY w.name ASC
      `,
      prisma.$queryRaw<
        Array<{
          walletId: string;
          currency: string;
          amount: unknown;
        }>
      >`
        SELECT
          te.wallet_id AS "walletId",
          te.local_currency AS currency,
          SUM(
            CASE
              WHEN te.type = 'funding_in' THEN
                CASE
                  WHEN te.source_type IN ('funding_in_imported_topup', 'funding_in_opening_balance')
                    AND (
                      COALESCE(te.metadata->>'matchReviewState', '') = 'rejected'
                      OR COALESCE(te.metadata->>'matchReviewStatus', '') = 'rejected'
                    )
                  THEN 0::numeric
                  ELSE te.local_amount
                END
              WHEN te.type = 'reimbursement' THEN te.local_amount
              WHEN te.type = 'spending' THEN -te.local_amount
              WHEN te.type = 'funding_out' THEN -te.local_amount
              WHEN te.type = 'settlement' THEN -te.local_amount
              ELSE 0::numeric
            END
          ) AS amount
        FROM trip_entries te
        WHERE te.trip_id = ${tripId} AND te.wallet_id IS NOT NULL
        GROUP BY te.wallet_id, te.local_currency
      `,
      prisma.$queryRaw<
        Array<{
          walletId: string;
          baseTotal: unknown;
          localTotal: unknown;
        }>
      >`
        SELECT
          tf.wallet_id AS "walletId",
          SUM(
            COALESCE(
              tf.base_amount,
              CASE
                WHEN UPPER(tf.source_currency) = UPPER(t.base_currency) THEN tf.source_amount
                WHEN UPPER(tf.destination_currency) = UPPER(t.base_currency) THEN tf.destination_amount
                ELSE tf.source_amount
              END
            )
          ) AS "baseTotal",
          SUM(
            CASE
              WHEN UPPER(tf.destination_currency) = UPPER(w.currency) THEN tf.destination_amount
              ELSE 0::numeric
            END
          ) AS "localTotal"
        FROM trip_fundings tf
        INNER JOIN wallets w ON w.id = tf.wallet_id
        INNER JOIN trips t ON t.id = tf.trip_id
        WHERE
          tf.trip_id = ${tripId}
          AND tf.wallet_id IS NOT NULL
          AND (
            tf.source_type NOT IN ('imported_topup', 'opening_balance')
            OR (
              COALESCE(tf.metadata->>'matchReviewState', '') <> 'rejected'
              AND COALESCE(tf.metadata->>'matchReviewStatus', '') <> 'rejected'
            )
          )
        GROUP BY tf.wallet_id
      `,
    ]);

    const balanceMap = new Map<string, Array<{ currency: string; amount: number }>>();
    balanceRows.forEach((row) => {
      const existing = balanceMap.get(row.walletId) || [];
      existing.push({
        currency: row.currency,
        amount: Number(row.amount),
      });
      balanceMap.set(row.walletId, existing);
    });

    const fundingBasisMap = new Map<
      string,
      {
        baseTotal: number;
        localTotal: number;
      }
    >();
    fundingBasisRows.forEach((row) => {
      fundingBasisMap.set(row.walletId, {
        baseTotal: Number(row.baseTotal || 0),
        localTotal: Number(row.localTotal || 0),
      });
    });

    return wallets.map((wallet) => ({
      ...((): { intrinsicFxRate: number | null; intrinsicBaseValue: number | null } => {
        const basis = fundingBasisMap.get(wallet.id);
        const intrinsicFxRate =
          wallet.currency.toUpperCase() === trip.baseCurrency.toUpperCase()
            ? 1
            : basis && basis.baseTotal > 0 && basis.localTotal > 0
              ? basis.baseTotal / basis.localTotal
              : null;
        const walletCurrencyBalance = (balanceMap.get(wallet.id) || [])
          .filter(
            (balance) =>
              String(balance.currency).toUpperCase() ===
              String(wallet.currency).toUpperCase(),
          )
          .reduce((sum, balance) => sum + balance.amount, 0);
        const intrinsicBaseValue =
          intrinsicFxRate && Number.isFinite(intrinsicFxRate)
            ? Number((walletCurrencyBalance * intrinsicFxRate).toFixed(4))
            : null;
        return { intrinsicFxRate, intrinsicBaseValue };
      })(),
      id: wallet.id,
      tripId: wallet.tripId,
      name: wallet.name,
      currency: wallet.currency,
      color: wallet.color,
      balances: balanceMap.get(wallet.id) || [],
    }));
  }

  static async getTripEntries(
    userId: string,
    tripId: string,
    filters?: {
      search?: string;
      walletId?: string;
      categoryId?: string;
      type?: "spending" | "reimbursement" | "funding_out" | "funding_in";
      dateFrom?: Date;
      dateTo?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const tripRows = await prisma.$queryRaw<Array<{ id: string; baseCurrency: string }>>`
      SELECT id, base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!tripRows[0]) throw new Error("Trip not found or unauthorized");
    const trip = tripRows[0];

    const search = filters?.search?.trim();
    const dateFrom = filters?.dateFrom;
    const dateTo = filters?.dateTo;
    const where: Prisma.Sql[] = [Prisma.sql`te.trip_id = ${tripId}`];

    if (filters?.walletId) {
      where.push(Prisma.sql`te.wallet_id = ${filters.walletId}`);
    }

    if (filters?.categoryId) {
      where.push(TripRepository.buildTripCategoryFilterSql(filters.categoryId));
    }

    if (filters?.type) {
      where.push(Prisma.sql`te.type = ${filters.type}`);
    }

    if (dateFrom) {
      where.push(Prisma.sql`te.transaction_date >= ${dateFrom}`);
    }

    if (dateTo) {
      where.push(Prisma.sql`te.transaction_date <= ${dateTo}`);
    }

    if (search) {
      const pattern = `%${search}%`;
      where.push(
        Prisma.sql`(te.description ILIKE ${pattern} OR COALESCE(te.label, '') ILIKE ${pattern})`,
      );
    }

    const entries = await prisma.$queryRaw<
      Array<{
        id: string;
        type: "spending" | "reimbursement" | "funding_out" | "funding_in" | "settlement";
        date: Date;
        label: string | null;
        description: string;
        walletId: string | null;
        walletName: string | null;
        walletCurrency: string | null;
        walletColor: string | null;
        sourceType: string;
        sourceTransactionId: string | null;
        categoryId: string | null;
        categoryName: string | null;
        categoryColor: string | null;
        localCurrency: string;
        localAmount: unknown;
        baseAmount: unknown;
        fxRate: unknown;
        feeAmount: unknown;
        feeCurrency: string | null;
        fundingId: string | null;
        fundingSourceType: string | null;
        fundingBankTransactionId: string | null;
        fundingBankTransactionDate: Date | null;
        fundingBankTransactionDescription: string | null;
        counterpartyId: string | null;
        counterpartyName: string | null;
        metadata: unknown;
      }>
    >`
      SELECT
        te.id,
        te.type,
        te.transaction_date AS date,
        te.label,
        te.description,
        te.source_type AS "sourceType",
        te.source_transaction_id AS "sourceTransactionId",
        w.id AS "walletId",
        w.name AS "walletName",
        w.currency AS "walletCurrency",
        w.color AS "walletColor",
        c.id AS "categoryId",
        c.name AS "categoryName",
        c.color AS "categoryColor",
        te.local_currency AS "localCurrency",
        te.local_amount AS "localAmount",
        te.base_amount AS "baseAmount",
        te.fx_rate AS "fxRate",
        te.fee_amount AS "feeAmount",
        te.fee_currency AS "feeCurrency",
        tf.id AS "fundingId",
        tf.source_type AS "fundingSourceType",
        bt.id AS "fundingBankTransactionId",
        bt.date AS "fundingBankTransactionDate",
        bt.description AS "fundingBankTransactionDescription",
        te.counterparty_id AS "counterpartyId",
        tp.name AS "counterpartyName",
        te.metadata
      FROM trip_entries te
      LEFT JOIN wallets w ON w.id = te.wallet_id
      LEFT JOIN categories c ON c.id = te.category_id
      LEFT JOIN trip_participants tp ON tp.id = te.counterparty_id
      LEFT JOIN trip_fundings tf ON tf.entry_id = te.id
      LEFT JOIN transactions bt ON bt.id = tf.bank_transaction_id
      INNER JOIN trips t ON t.id = te.trip_id
      WHERE ${Prisma.join(where, " AND ")} AND t.user_id = ${userId}
      ORDER BY te.transaction_date DESC
    `;

    const items = entries.map((item) => ({
      id: item.id,
      type: item.type,
      date: item.date,
      label: item.label,
      description: item.description,
      wallet: {
        id: item.walletId ?? "__external__",
        name:
          item.walletName ??
          (item.sourceType === "external_bank" ? "Bank Account" : "No Wallet"),
        currency: item.walletCurrency ?? trip.baseCurrency,
        color: item.walletColor ?? "#ffffff",
      },
      category:
        item.type === "reimbursement"
          ? {
              id: "__reimbursement__",
              name: "Reimbursement",
              color: "#22c55e",
            }
          : item.type === "funding_in"
            ? {
                id: "__funding_in__",
                name: "Funding In",
                color: "#3b82f6",
              }
          : item.type === "funding_out"
            ? {
                id: "__funding_out__",
                name: "Funding Out",
                color: "#f59e0b",
              }
          : item.type === "settlement"
            ? {
                id: "__settlement__",
                name: "Settlement",
                color: "#8b5cf6",
              }
          : item.categoryId
            ? {
                id: item.categoryId,
                name: item.categoryName,
                color: item.categoryColor ?? "#94a3b8",
              }
            : null,
      localCurrency: item.localCurrency,
      localAmount: Number(item.localAmount),
      baseAmount: Number(item.baseAmount),
      fxRate: Number(item.fxRate),
      feeAmount: item.feeAmount !== null ? Number(item.feeAmount) : null,
      feeCurrency: item.feeCurrency,
      counterparty: item.counterpartyId ? { id: item.counterpartyId, name: item.counterpartyName } : null,
      isIou: item.sourceType === "iou",
      metadata: {
        ...(item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : {}),
        sourceType: item.sourceType,
        sourceTransactionId: item.sourceTransactionId,
        fundingId: item.fundingId,
        fundingSourceType: item.fundingSourceType,
        bankTransactionId: item.fundingBankTransactionId,
        bankTransactionDate: item.fundingBankTransactionDate,
        bankTransactionDescription: item.fundingBankTransactionDescription,
      },
    }));

    const total = items.length;
    const offset = Math.max(0, filters?.offset ?? 0);
    const limit = Math.max(1, Math.min(filters?.limit ?? 50, 200));
    const paged = items.slice(offset, offset + limit);

    return {
      items: paged,
      total,
    };
  }

  static async searchTripEntriesForReimbursement(
    userId: string,
    tripId: string,
    search?: string,
    limit: number = 20,
    offset: number = 0,
    excludeEntryId?: string,
    filters?: {
      walletId?: string;
      categoryId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      amountBaseEquals?: number;
    },
  ) {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const safeOffset = Math.max(0, offset);
    const where: Prisma.Sql[] = [
      Prisma.sql`te.trip_id = ${tripId}`,
      Prisma.sql`te.type = 'spending'`,
    ];
    if (excludeEntryId) {
      where.push(Prisma.sql`te.id <> ${excludeEntryId}`);
    }
    if (filters?.walletId) {
      if (filters.walletId === "__no_wallet__") {
        where.push(Prisma.sql`te.wallet_id IS NULL`);
      } else {
        where.push(Prisma.sql`te.wallet_id = ${filters.walletId}`);
      }
    }
    if (filters?.categoryId) {
      if (filters.categoryId === "__uncategorized__") {
        where.push(Prisma.sql`te.category_id IS NULL`);
      } else {
        where.push(Prisma.sql`te.category_id = ${filters.categoryId}`);
      }
    }
    if (filters?.dateFrom) {
      where.push(Prisma.sql`te.transaction_date >= ${filters.dateFrom}`);
    }
    if (filters?.dateTo) {
      where.push(Prisma.sql`te.transaction_date <= ${filters.dateTo}`);
    }
    if (
      typeof filters?.amountBaseEquals === "number" &&
      Number.isFinite(filters.amountBaseEquals)
    ) {
      const normalizedAmount = Number(filters.amountBaseEquals.toFixed(4));
      where.push(
        Prisma.sql`ABS(te.base_amount - ${normalizedAmount}) <= 0.0001`,
      );
    }
    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      const pattern = `%${trimmedSearch}%`;
      where.push(
        Prisma.sql`(te.description ILIKE ${pattern} OR COALESCE(te.label, '') ILIKE ${pattern})`,
      );
    }

    const [rows, countRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          id: string;
          date: Date;
          description: string;
          label: string | null;
          localAmount: unknown;
          localCurrency: string;
          baseAmount: unknown;
          walletId: string | null;
          walletName: string | null;
          walletCurrency: string | null;
          walletColor: string | null;
          categoryId: string | null;
          categoryName: string | null;
          categoryColor: string | null;
          allocatedBase: unknown;
        }>
      >`
        SELECT
          te.id,
          te.transaction_date AS date,
          te.description,
          te.label,
          te.local_amount AS "localAmount",
          te.local_currency AS "localCurrency",
          te.base_amount AS "baseAmount",
          w.id AS "walletId",
          w.name AS "walletName",
          w.currency AS "walletCurrency",
          w.color AS "walletColor",
          c.id AS "categoryId",
          c.name AS "categoryName",
          c.color AS "categoryColor",
          COALESCE((
            SELECT SUM(a.amount_base)
            FROM trip_reimbursement_allocations a
            WHERE a.reimbursed_entry_id = te.id
          ), 0) AS "allocatedBase"
        FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id
        LEFT JOIN wallets w ON w.id = te.wallet_id
        LEFT JOIN categories c ON c.id = te.category_id
        WHERE ${Prisma.join(where, " AND ")} AND t.user_id = ${userId}
        ORDER BY te.transaction_date DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `,
      prisma.$queryRaw<Array<{ total: unknown }>>`
        SELECT COUNT(*)::int AS total
        FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id
        WHERE ${Prisma.join(where, " AND ")} AND t.user_id = ${userId}
      `,
    ]);

    return {
      transactions: rows.map((row) => {
        const baseAmount = Number(row.baseAmount || 0);
        const alreadyAllocatedBase = Number(row.allocatedBase || 0);
        return {
          id: row.id,
          date: row.date,
          description: row.description,
          label: row.label,
          localAmount: Number(row.localAmount || 0),
          localCurrency: row.localCurrency,
          baseAmount,
          alreadyAllocatedBase,
          remainingBase: Number(
            Math.max(baseAmount - alreadyAllocatedBase, 0).toFixed(4),
          ),
          wallet: row.walletId
            ? {
                id: row.walletId,
                name: row.walletName,
                currency: row.walletCurrency,
                color: row.walletColor,
              }
            : null,
          category: row.categoryId
            ? {
                id: row.categoryId,
                name: row.categoryName,
                color: row.categoryColor,
              }
            : null,
        };
      }),
      total: Number(countRows[0]?.total || 0),
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  static async createTripReimbursementLink(
    userId: string,
    tripId: string,
    reimbursementEntryId: string,
    allocations: Array<{ transactionId: string; amountBase: number }>,
    leftoverCategoryId?: string | null,
    valuation?: {
      reimbursementBaseAmount?: number | null;
      reimbursingFxRate?: number | null;
    },
    options?: {
      syncToBankLedger?: boolean;
    },
  ) {
    const [trip] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!trip) throw new Error("Trip not found or unauthorized");

    await prisma.$transaction(async (tx) => {
      await TripRepository.applyTripReimbursementAllocations(
        tx,
        userId,
        tripId,
        reimbursementEntryId,
        allocations,
        leftoverCategoryId ?? null,
        valuation,
        options,
      );
    });

    return { success: true };
  }

  static async clearTripEntryLinkage(
    userId: string,
    tripId: string,
    entryId: string,
  ) {
    const [entry] = await prisma.$queryRaw<
      Array<{ id: string; metadata: unknown }>
    >`
      SELECT te.id, te.metadata
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      WHERE te.id = ${entryId} AND te.trip_id = ${tripId} AND t.user_id = ${userId}
      LIMIT 1
    `;
    if (!entry) throw new Error("Trip entry not found or unauthorized");

    await prisma.$transaction(async (tx) => {
      const counterparts = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM trip_reimbursement_allocations
        WHERE
          trip_id = ${tripId}
          AND (reimbursement_entry_id = ${entryId} OR reimbursed_entry_id = ${entryId})
        RETURNING
          CASE WHEN reimbursement_entry_id = ${entryId} THEN reimbursed_entry_id ELSE reimbursement_entry_id END AS id
      `;

      const metadata =
        entry.metadata && typeof entry.metadata === "object"
          ? { ...(entry.metadata as Record<string, unknown>) }
          : {};
      delete metadata.linkage;
      await tx.$executeRaw`
        UPDATE trip_entries
        SET metadata = ${metadata as Prisma.InputJsonValue}
        WHERE id = ${entryId} AND trip_id = ${tripId}
      `;
      await TripRepository.releaseTripSyncedBankTransactionsTx(tx, userId, tripId, [entryId]);

      const counterpartIds = Array.from(new Set(counterparts.map((row) => row.id)));
      await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, counterpartIds);
      await TripRepository.resyncTripSyncedBankTransactionsTx(tx, userId, tripId, counterpartIds);
    });

    return { success: true };
  }

  /** Brings bank-ledger links of already-synced trip reimbursements in line with their allocations. */
  private static async resyncTripSyncedBankTransactionsTx(
    tx: Prisma.TransactionClient,
    userId: string,
    tripId: string,
    tripEntryIds: string[],
  ) {
    if (!tripEntryIds.length) return;
    const synced = await tx.$queryRaw<Array<{ id: string; tripEntryId: string }>>`
      SELECT id, linkage->'tripSync'->>'tripEntryId' AS "tripEntryId"
      FROM transactions
      WHERE user_id = ${userId}
        AND linkage->>'detectionReason' = 'trip_sync'
        AND linkage->'tripSync'->>'tripId' = ${tripId}
        AND linkage->'tripSync'->>'tripEntryId' = ANY(${tripEntryIds})
    `;
    for (const row of synced) {
      await TripRepository.syncTripReimbursementToBankLedgerTx(tx, userId, row.id, {
        tripId,
        tripEntryId: row.tripEntryId,
      });
    }
  }

  private static async assertCategoryOwned(userId: string, categoryId: string) {
    const [category] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM categories WHERE id = ${categoryId} AND user_id = ${userId} LIMIT 1
    `;
    if (!category) throw new Error("Category not found or unauthorized");
  }

  static async bulkUpdateEntriesByIds(
    userId: string,
    tripId: string,
    ids: string[],
    updates: { categoryId?: string | null; date?: Date },
  ) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return { count: 0 };

    const setClauses: Prisma.Sql[] = [];
    if (updates.categoryId) await TripRepository.assertCategoryOwned(userId, updates.categoryId);
    if (updates.categoryId !== undefined) {
      setClauses.push(Prisma.sql`category_id = ${updates.categoryId}`);
    }
    if (updates.date) {
      setClauses.push(Prisma.sql`transaction_date = ${updates.date}`);
    }
    if (setClauses.length === 0) return { count: 0 };

    const updatedCount = await prisma.$executeRaw`
      UPDATE trip_entries te
      SET ${Prisma.join(setClauses, ", ")}
      FROM trips t
      WHERE
        te.trip_id = t.id
        AND t.user_id = ${userId}
        AND te.trip_id = ${tripId}
        AND te.id IN (${Prisma.join(uniqueIds)})
    `;

    return { count: Number(updatedCount) };
  }

  static async bulkUpdateEntriesByFilter(
    userId: string,
    tripId: string,
    filters: {
      search?: string;
      walletId?: string;
      categoryId?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
    excludeIds: string[] | undefined,
    updates: { categoryId?: string | null; date?: Date },
  ) {
    const setClauses: Prisma.Sql[] = [];
    if (updates.categoryId) await TripRepository.assertCategoryOwned(userId, updates.categoryId);
    if (updates.categoryId !== undefined) {
      setClauses.push(Prisma.sql`category_id = ${updates.categoryId}`);
    }
    if (updates.date) {
      setClauses.push(Prisma.sql`transaction_date = ${updates.date}`);
    }
    if (setClauses.length === 0) return { count: 0 };

    const where: Prisma.Sql[] = [
      Prisma.sql`te.trip_id = ${tripId}`,
      Prisma.sql`t.user_id = ${userId}`,
    ];
    const search = filters.search?.trim();
    if (filters.walletId) {
      where.push(Prisma.sql`te.wallet_id = ${filters.walletId}`);
    }
    if (filters.categoryId) {
      where.push(TripRepository.buildTripCategoryFilterSql(filters.categoryId));
    }
    if (filters.dateFrom) {
      where.push(Prisma.sql`te.transaction_date >= ${filters.dateFrom}`);
    }
    if (filters.dateTo) {
      where.push(Prisma.sql`te.transaction_date <= ${filters.dateTo}`);
    }
    if (search) {
      const pattern = `%${search}%`;
      where.push(
        Prisma.sql`(te.description ILIKE ${pattern} OR COALESCE(te.label, '') ILIKE ${pattern})`,
      );
    }
    const uniqueExcludeIds = Array.from(new Set((excludeIds || []).filter(Boolean)));
    if (uniqueExcludeIds.length > 0) {
      where.push(Prisma.sql`te.id NOT IN (${Prisma.join(uniqueExcludeIds)})`);
    }

    const updatedCount = await prisma.$executeRaw`
      UPDATE trip_entries te
      SET ${Prisma.join(setClauses, ", ")}
      FROM trips t
      WHERE te.trip_id = t.id AND ${Prisma.join(where, " AND ")}
    `;

    return { count: Number(updatedCount) };
  }

  /**
   * Deletes trip entries and everything that only makes sense with them: the funding
   * behind a funding entry, both halves of an in-trip conversion, fundings created in
   * other trips by an outgoing transfer, and stale reimbursement caches on counterparts.
   * Money that arrived from another trip must be removed from the sending trip.
   * Returns the wallets to recalculate.
   */
  private static async deleteTripEntriesTx(
    tx: Prisma.TransactionClient,
    userId: string,
    tripId: string,
    entryIds: string[],
  ) {
    const requested = Array.from(new Set(entryIds.filter(Boolean)));
    if (!requested.length) return { count: 0, recalcTargets: [] as Array<{ tripId: string; walletId: string }> };

    const fundings = await tx.$queryRaw<
      Array<{ id: string; entryId: string; sourceType: string; sourceTripEntryId: string | null; sourceTripId: string | null }>
    >`
      SELECT
        tf.id,
        tf.entry_id AS "entryId",
        tf.source_type AS "sourceType",
        tf.metadata->>'sourceTripEntryId' AS "sourceTripEntryId",
        src.trip_id AS "sourceTripId"
      FROM trip_fundings tf
      INNER JOIN trips t ON t.id = tf.trip_id
      LEFT JOIN trip_entries src ON src.id = tf.metadata->>'sourceTripEntryId'
      WHERE tf.trip_id = ${tripId} AND t.user_id = ${userId} AND tf.entry_id = ANY(${requested})
    `;
    const fromOtherTrip = fundings.find(
      (funding) =>
        funding.sourceType === "from_trip_outgoing" &&
        funding.sourceTripId &&
        funding.sourceTripId !== tripId,
    );
    if (fromOtherTrip) {
      throw Object.assign(
        new Error("This money came from another trip. Delete the transfer in that trip instead."),
        { status: 409 },
      );
    }
    // Removing the incoming half of an in-trip conversion removes its outgoing half too.
    const ids = Array.from(
      new Set([
        ...requested,
        ...fundings
          .filter((funding) => funding.sourceType === "wallet_conversion" && funding.sourceTripEntryId)
          .map((funding) => funding.sourceTripEntryId as string),
      ]),
    );

    const entries = await tx.$queryRaw<Array<{ id: string; walletId: string | null }>>`
      SELECT te.id, te.wallet_id AS "walletId"
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      WHERE te.trip_id = ${tripId} AND t.user_id = ${userId} AND te.id = ANY(${ids})
    `;
    const existingIds = entries.map((entry) => entry.id);
    if (!existingIds.length) return { count: 0, recalcTargets: [] as Array<{ tripId: string; walletId: string }> };

    const counterparts = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT
        CASE WHEN reimbursement_entry_id = ANY(${existingIds}) THEN reimbursed_entry_id ELSE reimbursement_entry_id END AS id
      FROM trip_reimbursement_allocations
      WHERE trip_id = ${tripId}
        AND (reimbursement_entry_id = ANY(${existingIds}) OR reimbursed_entry_id = ANY(${existingIds}))
    `;
    await TripRepository.releaseTripSyncedBankTransactionsTx(tx, userId, tripId, existingIds);
    // IOUs paid off by deleted settlements are owed again.
    const settledIous = (await TripIouRepository.linkedIouIdsTx(tx, tripId, existingIds)).filter(
      (id) => !existingIds.includes(id),
    );

    const linkedTargets = await TripRepository.deleteLinkedFundingsFromTripOutgoingTx(tx, userId, existingIds);
    await tx.$executeRaw`
      DELETE FROM trip_fundings
      WHERE trip_id = ${tripId} AND entry_id = ANY(${existingIds})
    `;
    // Shares of these entries in other members' trips go with them.
    await tx.$executeRaw`DELETE FROM trip_entries WHERE shared_from_entry_id = ANY(${existingIds})`;
    const count = Number(
      await tx.$executeRaw`
        DELETE FROM trip_entries
        WHERE trip_id = ${tripId} AND id = ANY(${existingIds})
      `,
    );
    await TripIouRepository.recomputeIouCostsTx(tx, tripId, settledIous);
    const repricedIous = await TripRepository.reconcileReimbursementAllocationsTx(tx, tripId, settledIous);
    const remainingCounterparts = [
      ...counterparts.map((row) => row.id).filter((id) => !existingIds.includes(id)),
      ...repricedIous,
    ];
    await TripRepository.rebuildEntryLinkageCachesTx(tx, tripId, remainingCounterparts);
    await TripRepository.resyncTripSyncedBankTransactionsTx(tx, userId, tripId, remainingCounterparts);

    const recalcTargets = new Map<string, { tripId: string; walletId: string }>();
    for (const target of linkedTargets) recalcTargets.set(`${target.tripId}:${target.walletId}`, target);
    for (const entry of entries) {
      if (entry.walletId) recalcTargets.set(`${tripId}:${entry.walletId}`, { tripId, walletId: entry.walletId });
    }
    return { count, recalcTargets: Array.from(recalcTargets.values()) };
  }

  static async bulkDeleteEntriesByIds(
    userId: string,
    tripId: string,
    ids: string[],
  ) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return { count: 0 };

    const { count: deletedCount, recalcTargets } = await prisma.$transaction((tx) =>
      TripRepository.deleteTripEntriesTx(tx, userId, tripId, uniqueIds),
    );

    if (recalcTargets.length > 0) {
      await Promise.all(
        recalcTargets.map((target) =>
          TripRepository.recalculateWalletEntriesToBase(
            userId,
            target.tripId,
            target.walletId,
            { mode: "weighted" },
          ).catch(TripRepository.recalcFailed),
        ),
      );
    }

    return { count: Number(deletedCount) };
  }

  static async bulkDeleteEntriesByFilter(
    userId: string,
    tripId: string,
    filters: {
      search?: string;
      walletId?: string;
      categoryId?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
    excludeIds: string[] | undefined,
  ) {
    const where: Prisma.Sql[] = [
      Prisma.sql`te.trip_id = ${tripId}`,
      Prisma.sql`t.user_id = ${userId}`,
    ];
    const search = filters.search?.trim();
    if (filters.walletId) {
      where.push(Prisma.sql`te.wallet_id = ${filters.walletId}`);
    }
    if (filters.categoryId) {
      where.push(TripRepository.buildTripCategoryFilterSql(filters.categoryId));
    }
    if (filters.dateFrom) {
      where.push(Prisma.sql`te.transaction_date >= ${filters.dateFrom}`);
    }
    if (filters.dateTo) {
      where.push(Prisma.sql`te.transaction_date <= ${filters.dateTo}`);
    }
    if (search) {
      const pattern = `%${search}%`;
      where.push(
        Prisma.sql`(te.description ILIKE ${pattern} OR COALESCE(te.label, '') ILIKE ${pattern})`,
      );
    }
    const uniqueExcludeIds = Array.from(new Set((excludeIds || []).filter(Boolean)));
    if (uniqueExcludeIds.length > 0) {
      where.push(Prisma.sql`te.id NOT IN (${Prisma.join(uniqueExcludeIds)})`);
    }

    const candidateRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT te.id
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      WHERE ${Prisma.join(where, " AND ")}
    `;
    const candidateIds = candidateRows.map((row) => row.id);

    const { count: deletedCount, recalcTargets } = await prisma.$transaction((tx) =>
      TripRepository.deleteTripEntriesTx(tx, userId, tripId, candidateIds),
    );

    if (recalcTargets.length > 0) {
      await Promise.all(
        recalcTargets.map((target) =>
          TripRepository.recalculateWalletEntriesToBase(
            userId,
            target.tripId,
            target.walletId,
            { mode: "weighted" },
          ).catch(TripRepository.recalcFailed),
        ),
      );
    }

    return { count: Number(deletedCount) };
  }

  static async getTripAnalytics(userId: string, tripId: string) {
    const tripRows = await prisma.$queryRaw<
      Array<{ id: string; name: string; baseCurrency: string }>
    >`
      SELECT
        id,
        name,
        base_currency AS "baseCurrency"
      FROM trips
      WHERE id = ${tripId} AND user_id = ${userId}
      LIMIT 1
    `;

    const trip = tripRows[0];
    if (!trip) {
      throw new Error("Trip not found or unauthorized");
    }

    const [totalsRow] = await prisma.$queryRaw<
      Array<{
        totalFunding: unknown;
        totalFundingIn: unknown;
        totalLinkedFundingIn: unknown;
        totalUnlinkedFundingIn: unknown;
        totalUnlinkedFundingCount: unknown;
        totalFundingOut: unknown;
        totalSpent: unknown;
        totalReimbursed: unknown;
      }>
    >`
      SELECT
        COALESCE((
          SELECT SUM(te.base_amount)
          FROM trip_entries te
          WHERE
            te.trip_id = ${tripId}
            AND te.type = 'funding_in'
            -- Moving money between wallets of the same trip is not funding.
            AND te.source_type <> 'funding_in_wallet_conversion'
            AND (
              te.source_type NOT IN ('funding_in_imported_topup', 'funding_in_opening_balance')
              OR (
                COALESCE(te.metadata->>'matchReviewState', '') <> 'rejected'
                AND COALESCE(te.metadata->>'matchReviewStatus', '') <> 'rejected'
              )
            )
        ), 0) AS "totalFunding",
        COALESCE((
          SELECT SUM(te.base_amount)
          FROM trip_entries te
          WHERE
            te.trip_id = ${tripId}
            AND te.type = 'funding_in'
            -- Moving money between wallets of the same trip is not funding.
            AND te.source_type <> 'funding_in_wallet_conversion'
            AND (
              te.source_type NOT IN ('funding_in_imported_topup', 'funding_in_opening_balance')
              OR (
                COALESCE(te.metadata->>'matchReviewState', '') <> 'rejected'
                AND COALESCE(te.metadata->>'matchReviewStatus', '') <> 'rejected'
              )
            )
        ), 0) AS "totalFundingIn",
        COALESCE((
          SELECT SUM(te.base_amount)
          FROM trip_entries te
          WHERE
            te.trip_id = ${tripId}
            AND te.type = 'funding_in'
            -- Moving money between wallets of the same trip is not funding.
            AND te.source_type <> 'funding_in_wallet_conversion'
            AND (
              te.source_type NOT IN ('funding_in_imported_topup', 'funding_in_opening_balance')
              OR (
                COALESCE(te.metadata->>'matchReviewState', '') <> 'rejected'
                AND COALESCE(te.metadata->>'matchReviewStatus', '') <> 'rejected'
              )
            )
            AND COALESCE(te.metadata->>'bankTransactionId', '') <> ''
        ), 0) AS "totalLinkedFundingIn",
        COALESCE((
          SELECT SUM(te.base_amount)
          FROM trip_entries te
          WHERE
            te.trip_id = ${tripId}
            AND te.type = 'funding_in'
            -- Moving money between wallets of the same trip is not funding.
            AND te.source_type <> 'funding_in_wallet_conversion'
            AND (
              te.source_type NOT IN ('funding_in_imported_topup', 'funding_in_opening_balance')
              OR (
                COALESCE(te.metadata->>'matchReviewState', '') <> 'rejected'
                AND COALESCE(te.metadata->>'matchReviewStatus', '') <> 'rejected'
              )
            )
            AND COALESCE(te.metadata->>'bankTransactionId', '') = ''
        ), 0) AS "totalUnlinkedFundingIn",
        COALESCE((
          SELECT COUNT(*)::numeric
          FROM trip_entries te
          WHERE
            te.trip_id = ${tripId}
            AND te.type = 'funding_in'
            -- Moving money between wallets of the same trip is not funding.
            AND te.source_type <> 'funding_in_wallet_conversion'
            AND (
              te.source_type NOT IN ('funding_in_imported_topup', 'funding_in_opening_balance')
              OR (
                COALESCE(te.metadata->>'matchReviewState', '') <> 'rejected'
                AND COALESCE(te.metadata->>'matchReviewStatus', '') <> 'rejected'
              )
            )
            AND COALESCE(te.metadata->>'bankTransactionId', '') = ''
        ), 0) AS "totalUnlinkedFundingCount",
        COALESCE((
          SELECT SUM(te.base_amount)
          FROM trip_entries te
          WHERE
            te.trip_id = ${tripId}
            AND te.type = 'funding_out'
            AND COALESCE(te.source_type, '') <> 'wallet_conversion_out'
        ), 0) AS "totalFundingOut",
        COALESCE((
          SELECT SUM(te.base_amount)
          FROM trip_entries te
          WHERE
            te.trip_id = ${tripId}
            AND te.type = 'spending'
        ), 0) AS "totalSpent",
        COALESCE((
          SELECT SUM(a.amount_base)
          FROM trip_reimbursement_allocations a
          INNER JOIN trip_entries te ON te.id = a.reimbursement_entry_id
          WHERE
            a.trip_id = ${tripId}
        ), 0) AS "totalReimbursed"
    `;

    const highlightRows = await prisma.$queryRaw<
      Array<{ categoryKey: string | null; total: unknown }>
    >`
      -- Highlights recognise the usual names for these categories, not one exact spelling.
      SELECT highlight_key AS "categoryKey", SUM(base_amount) AS total
      FROM (
        SELECT
          te.base_amount,
          CASE
          WHEN LOWER(c.name) ~ '(flight|airfare|airline)' THEN 'flights'
          WHEN LOWER(c.name) ~ '(accommodation|hotel|lodging|hostel|airbnb)' THEN 'accommodations'
          WHEN LOWER(c.name) ~ '(attraction|activit|tour|sightseeing)' THEN 'attractions'
        END AS highlight_key
        FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id
        LEFT JOIN categories c ON c.id = te.category_id
        WHERE
          te.trip_id = ${tripId}
          AND te.type = 'spending'
          AND t.user_id = ${userId}
      ) keyed
      WHERE highlight_key IS NOT NULL
      GROUP BY highlight_key
    `;

    const dailySeriesRows = await prisma.$queryRaw<
      Array<{ date: Date; spending: unknown; reimbursement: unknown }>
    >`
      WITH spending_by_day AS (
        SELECT
          DATE_TRUNC('day', te.transaction_date)::date AS day,
          SUM(te.base_amount) AS spending
        FROM trip_entries te
        INNER JOIN trips t ON t.id = te.trip_id
        WHERE
          te.trip_id = ${tripId}
          AND t.user_id = ${userId}
          AND te.type = 'spending'
        GROUP BY DATE_TRUNC('day', te.transaction_date)::date
      ),
      reimbursement_by_day AS (
        SELECT
          DATE_TRUNC('day', re.transaction_date)::date AS day,
          SUM(a.amount_base) AS reimbursement
        FROM trip_reimbursement_allocations a
        INNER JOIN trip_entries re ON re.id = a.reimbursement_entry_id
        INNER JOIN trips t ON t.id = re.trip_id
        WHERE
          a.trip_id = ${tripId}
          AND t.user_id = ${userId}
        GROUP BY DATE_TRUNC('day', re.transaction_date)::date
      )
      SELECT
        COALESCE(s.day, r.day) AS date,
        COALESCE(s.spending, 0::numeric) AS spending,
        COALESCE(r.reimbursement, 0::numeric) AS reimbursement
      FROM spending_by_day s
      FULL OUTER JOIN reimbursement_by_day r ON r.day = s.day
      ORDER BY COALESCE(s.day, r.day) ASC
    `;

    const categoryRows = await prisma.$queryRaw<
      Array<{ id: string | null; name: string | null; color: string | null; totalOut: unknown }>
    >`
      SELECT
        c.id,
        c.name,
        c.color,
        SUM(te.base_amount) AS "totalOut"
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      LEFT JOIN categories c ON c.id = te.category_id
      WHERE
        te.trip_id = ${tripId}
        AND te.type = 'spending'
        AND t.user_id = ${userId}
      GROUP BY c.id, c.name, c.color
      ORDER BY SUM(te.base_amount) DESC
    `;

    const highlightTransactionsRows = await prisma.$queryRaw<
      Array<{
        id: string;
        categoryKey: string | null;
        date: Date;
        label: string | null;
        description: string;
        localCurrency: string;
        localAmount: unknown;
        baseAmount: unknown;
        walletName: string;
      }>
    >`
      SELECT
        te.id,
        CASE
          WHEN LOWER(c.name) ~ '(flight|airfare|airline)' THEN 'flights'
          WHEN LOWER(c.name) ~ '(accommodation|hotel|lodging|hostel|airbnb)' THEN 'accommodations'
          WHEN LOWER(c.name) ~ '(attraction|activit|tour|sightseeing)' THEN 'attractions'
        END AS "categoryKey",
        te.transaction_date AS date,
        te.label,
        te.description,
        te.local_currency AS "localCurrency",
        te.local_amount AS "localAmount",
        te.base_amount AS "baseAmount",
        COALESCE(w.name, 'Bank Account') AS "walletName"
      FROM trip_entries te
      INNER JOIN trips t ON t.id = te.trip_id
      LEFT JOIN wallets w ON w.id = te.wallet_id
      LEFT JOIN categories c ON c.id = te.category_id
      WHERE
        te.trip_id = ${tripId}
        AND te.type = 'spending'
        AND t.user_id = ${userId}
        AND (CASE
          WHEN LOWER(c.name) ~ '(flight|airfare|airline)' THEN 'flights'
          WHEN LOWER(c.name) ~ '(accommodation|hotel|lodging|hostel|airbnb)' THEN 'accommodations'
          WHEN LOWER(c.name) ~ '(attraction|activit|tour|sightseeing)' THEN 'attractions'
        END) IS NOT NULL
      ORDER BY te.transaction_date DESC
    `;

    const recentRows = await prisma.$queryRaw<
      Array<{
        id: string;
        type: "spending" | "reimbursement" | "funding_out" | "funding_in";
        date: Date;
        label: string | null;
        description: string;
        localCurrency: string;
        localAmount: unknown;
        baseAmount: unknown;
        walletName: string;
        categoryName: string | null;
        categoryColor: string | null;
      }>
    >`
      SELECT
        te.id,
        te.type,
        te.transaction_date AS date,
        te.label,
        te.description,
        te.local_currency AS "localCurrency",
        te.local_amount AS "localAmount",
        te.base_amount AS "baseAmount",
        COALESCE(w.name, 'Bank Account') AS "walletName",
        CASE
          WHEN te.type = 'funding_in' THEN 'Funding In'::text
          WHEN te.type = 'reimbursement' THEN 'Reimbursement'::text
          WHEN te.type = 'funding_out' THEN 'Funding Out'::text
          ELSE c.name
        END AS "categoryName",
        CASE
          WHEN te.type = 'funding_in' THEN '#3b82f6'::text
          WHEN te.type = 'reimbursement' THEN '#22c55e'::text
          WHEN te.type = 'funding_out' THEN '#f59e0b'::text
          ELSE c.color
        END AS "categoryColor"
      FROM trip_entries te
      LEFT JOIN wallets w ON w.id = te.wallet_id
      INNER JOIN trips t ON t.id = te.trip_id
      LEFT JOIN categories c ON c.id = te.category_id
      WHERE te.trip_id = ${tripId} AND t.user_id = ${userId}
      ORDER BY te.transaction_date DESC
      LIMIT 12
    `;

    const highlightMap = new Map<string, number>();
    for (const row of highlightRows) {
      if (!row.categoryKey) continue;
      highlightMap.set(row.categoryKey, Number(row.total));
    }

    const flights = highlightMap.get("flights") || 0;
    const accommodations =
      (highlightMap.get("accommodation") || 0) +
      (highlightMap.get("accommodations") || 0);
    const attractions = highlightMap.get("attractions") || 0;

    const totalFunding = Number(totalsRow?.totalFunding || 0);
    const totalFundingIn = Number(totalsRow?.totalFundingIn || 0);
    const totalLinkedFundingIn = Number(totalsRow?.totalLinkedFundingIn || 0);
    const totalUnlinkedFundingIn = Number(totalsRow?.totalUnlinkedFundingIn || 0);
    const totalUnlinkedFundingCount = Number(totalsRow?.totalUnlinkedFundingCount || 0);
    const totalFundingOut = Number(totalsRow?.totalFundingOut || 0);
    const totalSpent = Number(totalsRow?.totalSpent || 0);
    const totalReimbursed = Number(totalsRow?.totalReimbursed || 0);

    const highlightTransactions = {
      flights: [] as Array<{
        id: string;
        date: Date;
        label: string | null;
        description: string;
        localCurrency: string;
        localAmount: number;
        baseAmount: number;
        walletName: string;
      }>,
      accommodations: [] as Array<{
        id: string;
        date: Date;
        label: string | null;
        description: string;
        localCurrency: string;
        localAmount: number;
        baseAmount: number;
        walletName: string;
      }>,
      attractions: [] as Array<{
        id: string;
        date: Date;
        label: string | null;
        description: string;
        localCurrency: string;
        localAmount: number;
        baseAmount: number;
        walletName: string;
      }>,
    };

    for (const row of highlightTransactionsRows) {
      const normalizedKey =
        row.categoryKey === "accommodation" || row.categoryKey === "accommodations"
          ? "accommodations"
          : row.categoryKey;
      if (
        normalizedKey !== "flights" &&
        normalizedKey !== "accommodations" &&
        normalizedKey !== "attractions"
      ) {
        continue;
      }

      highlightTransactions[normalizedKey].push({
        id: row.id,
        date: row.date,
        label: row.label,
        description: row.description,
        localCurrency: row.localCurrency,
        localAmount: Number(row.localAmount || 0),
        baseAmount: Number(row.baseAmount || 0),
        walletName: row.walletName,
      });
    }

    return {
      trip: {
        id: trip.id,
        name: trip.name,
        baseCurrency: trip.baseCurrency,
      },
      totals: {
        totalFunding,
        totalFundingIn,
        totalLinkedFundingIn,
        totalUnlinkedFundingIn,
        totalUnlinkedFundingCount,
        totalFundingOut,
        totalSpent,
        totalReimbursed,
        netTripCost: totalSpent - totalReimbursed,
      },
      highlights: {
        flights,
        accommodations,
        attractions,
      },
      highlightTransactions,
      dailySeries: dailySeriesRows.map((row) => ({
        date: row.date,
        spending: Number(row.spending || 0),
        reimbursement: Number(row.reimbursement || 0),
        net: Number(row.spending || 0) - Number(row.reimbursement || 0),
      })),
      categoryBreakdown: categoryRows.map((row) => ({
        category: row.id
          ? {
              id: row.id,
              name: row.name || "Uncategorized",
              color: row.color || "#94a3b8",
            }
          : null,
        totalOut: Number(row.totalOut || 0),
      })),
      recentEntries: recentRows.map((row) => ({
        id: row.id,
        type: row.type,
        date: row.date,
        label: row.label,
        description: row.description,
        localCurrency: row.localCurrency,
        localAmount: Number(row.localAmount || 0),
        baseAmount: Number(row.baseAmount || 0),
        walletName: row.walletName,
        category: {
          name: row.categoryName || "Uncategorized",
          color: row.categoryColor || "#94a3b8",
        },
      })),
    };
  }
}
