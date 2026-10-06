import { Router, Request, Response } from "express";
import { z } from "zod";
import { TripService } from "./trips.service";
import { buildFundingUpdatePayload } from "./trips.accounting";

export const tripsRouter = Router();

const TripCreateSchema = z.object({
  userId: z.string(),
  name: z.string().min(1),
  coverImageUrl: z.string().optional().nullable(),
  baseCurrency: z.string().optional().nullable(),
  startDate: z.string().transform((value) => new Date(value)),
  endDate: z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value ? new Date(value) : null)),
  status: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const TripUpdateSchema = z.object({
  userId: z.string(),
  name: z.string().min(1).optional(),
  coverImageUrl: z.string().optional().nullable(),
  baseCurrency: z.string().optional().nullable(),
  startDate: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  endDate: z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value ? new Date(value) : null)),
  status: z.string().optional(),
  notes: z.string().optional().nullable(),
});

const TripDeleteSchema = z.object({
  userId: z.string(),
});

const FundingCreateSchema = z.object({
  userId: z.string(),
  tripId: z.string(),
  walletId: z.string().optional().nullable(),
  bankTransactionId: z.string().optional().nullable(),
  // Conversions, transfers between trips and statement top-ups are created by the
  // server together with the records they depend on.
  sourceType: z
    .enum(["manual", "transfer", "bank_wallet_topup", "opening_balance"])
    .default("manual"),
  sourceCurrency: z.string().default("SGD"),
  sourceAmount: z.number(),
  destinationCurrency: z.string(),
  destinationAmount: z.number(),
  fxRate: z.number().optional().nullable(),
  feeAmount: z.number().optional().nullable(),
  feeCurrency: z.string().optional().nullable(),
  // Required when neither currency is the trip's base currency.
  baseAmount: z.number().positive().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

const FundingMatchReviewSchema = z.object({
  userId: z.string(),
  action: z.enum(["accept", "reject", "replace"]),
  bankTransactionId: z.string().optional().nullable(),
});

const FundingMergeSchema = z.object({
  userId: z.string(),
  targetFundingId: z.string(),
});

const FundingUpdateSchema = z.object({
  userId: z.string(),
  walletId: z.string().optional().nullable(),
  sourceCurrency: z.string().optional(),
  sourceAmount: z.number().optional(),
  destinationCurrency: z.string().optional(),
  destinationAmount: z.number().optional(),
  fxRate: z.number().optional().nullable(),
  feeAmount: z.number().optional().nullable(),
  feeCurrency: z.string().optional().nullable(),
  baseAmount: z.number().positive().optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

const FundingDeleteSchema = z.object({
  userId: z.string(),
});

const WalletCreateSchema = z.object({
  userId: z.string(),
  name: z.string().min(1),
  currency: z
    .string()
    .min(3)
    .max(3)
    .transform((value) => value.toUpperCase()),
  color: z
    .string()
    .regex(/^#([0-9A-Fa-f]{6})$/, "Invalid wallet color")
    .optional()
    .nullable(),
});

const WalletRecalculateSchema = z.object({
  userId: z.string(),
  mode: z.enum(["manual", "weighted"]),
  fxRate: z.number().optional().nullable(),
});

const ImportSpendingsSchema = z.object({
  userId: z.string(),
  walletId: z.string().optional().nullable(),
  parserId: z.string().optional().nullable(),
  transactions: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      label: z.string().optional().nullable(),
      categoryId: z.string().optional().nullable(),
      entryType: z
        .enum(["spending", "reimbursement", "funding_out", "funding_in"])
        .optional(),
      linkage: z
        .object({
          type: z.literal("reimbursement"),
          reimbursesAllocations: z
            .array(
              z.object({
                transactionId: z.string().optional(),
                pendingBatchIndex: z.number().optional(),
                amountBase: z.number(),
              }),
            )
            .optional(),
          reimbursementBaseAmount: z.number().optional(),
          reimbursingFxRate: z.number().optional(),
          leftoverCategoryId: z.string().optional().nullable(),
        })
        .optional()
        .nullable(),
      amountIn: z.number().optional().nullable(),
      amountOut: z.number().optional().nullable(),
      fundingOut: z
        .object({
          destinationType: z.enum(["bank", "trip", "external"]).optional(),
          destinationTripId: z.string().optional().nullable(),
          bankTransactionId: z.string().optional().nullable(),
          destinationCurrency: z.string().optional().nullable(),
          destinationAmount: z.number().optional().nullable(),
          fxRate: z.number().optional().nullable(),
          feeAmount: z.number().optional().nullable(),
          feeCurrency: z.string().optional().nullable(),
        })
        .optional()
        .nullable(),
      metadata: z.record(z.any()).optional().nullable(),
    }),
  ),
});

const TripEntriesQuerySchema = z.object({
  userId: z.string(),
  search: z.string().optional(),
  walletId: z.string().optional(),
  categoryId: z.string().optional(),
  type: z.enum(["spending", "reimbursement", "funding_out", "funding_in"]).optional(),
  dateFrom: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  dateTo: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  offset: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
});

const TripEntriesFilterSchema = z.object({
  search: z.string().optional(),
  walletId: z.string().optional(),
  categoryId: z.string().optional(),
  dateFrom: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  dateTo: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
});

const TripReimbursementSearchQuerySchema = z.object({
  userId: z.string(),
  search: z.string().optional(),
  walletId: z.string().optional(),
  categoryId: z.string().optional(),
  dateFrom: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  dateTo: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined)),
  amountBaseEquals: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  offset: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  excludeEntryId: z.string().optional(),
});

const TripReimbursementLinkSchema = z.object({
  userId: z.string(),
  reimbursedAllocations: z
    .array(
      z.object({
        transactionId: z.string(),
        amountBase: z.number(),
      }),
    )
    .min(1),
  leftoverCategoryId: z.string().optional().nullable(),
  reimbursementBaseAmount: z.number().optional().nullable(),
  reimbursingFxRate: z.number().optional().nullable(),
  syncToBankLedger: z.boolean().optional(),
});

const TripEntryClearLinkageSchema = z.object({
  userId: z.string(),
});

const TripEntriesBulkUpdateByIdsSchema = z.object({
  userId: z.string(),
  ids: z.array(z.string()).min(1),
  updates: z.object({
    categoryId: z.string().optional().nullable(),
    date: z
      .string()
      .optional()
      .transform((value) => (value ? new Date(value) : undefined)),
  }),
});

const TripEntriesBulkUpdateByFilterSchema = z.object({
  userId: z.string(),
  filters: TripEntriesFilterSchema,
  excludeIds: z.array(z.string()).optional(),
  updates: z.object({
    categoryId: z.string().optional().nullable(),
    date: z
      .string()
      .optional()
      .transform((value) => (value ? new Date(value) : undefined)),
  }),
});

const TripEntriesBulkDeleteByIdsSchema = z.object({
  userId: z.string(),
  ids: z.array(z.string()).min(1),
});

const TripEntriesBulkDeleteByFilterSchema = z.object({
  userId: z.string(),
  filters: TripEntriesFilterSchema,
  excludeIds: z.array(z.string()).optional(),
});

const SourceTransactionsQuerySchema = z.object({
  userId: z.string(),
  search: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  offset: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
});

const AddEntriesFromSourceSchema = z.object({
  userId: z.string(),
  transactionIds: z.array(z.string()).min(1),
  categoryId: z.string().optional().nullable(),
  entryType: z.enum(["spending", "reimbursement", "funding_out"]).optional(),
  fundingOut: z
    .object({
      destinationType: z.enum(["bank", "trip", "wallet", "external"]).optional(),
      destinationTripId: z.string().optional().nullable(),
      destinationWalletId: z.string().optional().nullable(),
      bankTransactionId: z.string().optional().nullable(),
      destinationCurrency: z.string().optional().nullable(),
      destinationAmount: z.number().optional().nullable(),
      fxRate: z.number().optional().nullable(),
      feeAmount: z.number().optional().nullable(),
      feeCurrency: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

const TripEntryCreateSchema = z.object({
  userId: z.string(),
  walletId: z.string().optional().nullable(),
  type: z.enum(["spending", "reimbursement", "funding_out"]),
  date: z.string().transform((value) => new Date(value)),
  description: z.string().min(1),
  label: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  localCurrency: z.string().trim().length(3),
  localAmount: z.number().positive(),
  // Omit to value a wallet entry at the wallet's average rate.
  baseAmount: z.number().positive().optional().nullable(),
  fxRate: z.number().positive().optional().nullable(),
  feeAmount: z.number().optional().nullable(),
  feeCurrency: z.string().optional().nullable(),
  fundingOut: z
    .object({
      destinationType: z.enum(["bank", "trip", "wallet", "external"]).optional(),
      destinationTripId: z.string().optional().nullable(),
      destinationWalletId: z.string().optional().nullable(),
      bankTransactionId: z.string().optional().nullable(),
      destinationCurrency: z.string().optional().nullable(),
      destinationAmount: z.number().optional().nullable(),
      fxRate: z.number().optional().nullable(),
      feeAmount: z.number().optional().nullable(),
      feeCurrency: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

const OutgoingFundingCandidatesQuerySchema = z.object({
  userId: z.string(),
  sourceTripId: z.string().optional(),
  search: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
  offset: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined)),
});

const AddFundingsFromOutgoingEntriesSchema = z.object({
  userId: z.string(),
  sourceEntryIds: z.array(z.string()).min(1),
  walletId: z.string().optional().nullable(),
});

tripsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    if (!userId) return res.status(400).json({ error: "Missing userId" });
    const trips = await TripService.getTrips(userId);
    res.json({ trips });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch trips" });
  }
});

tripsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const input = TripCreateSchema.parse(req.body);
    const trip = await TripService.createTrip(input.userId, {
      name: input.name,
      coverImageUrl: input.coverImageUrl ?? null,
      baseCurrency: input.baseCurrency ?? "",
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      status: input.status ?? undefined,
      notes: input.notes,
    });
    res.json({ trip });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to create trip" });
  }
});

tripsRouter.get("/:id/wallets", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    const tripId = String(req.params.id || "");
    if (!userId || !tripId) {
      return res.status(400).json({ error: "Missing userId or tripId" });
    }
    const wallets = await TripService.getWallets(userId, tripId);
    res.json({ wallets });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch wallets" });
  }
});

tripsRouter.post("/:id/wallets", async (req: Request, res: Response) => {
  try {
    const input = WalletCreateSchema.parse(req.body);
    const tripId = String(req.params.id || "");
    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }
    const wallet = await TripService.createWallet(input.userId, tripId, {
      name: input.name,
      currency: input.currency,
      color: input.color ?? null,
    });
    res.json({ wallet });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to create wallet" });
  }
});

tripsRouter.post(
  "/:id/wallets/:walletId/recalculate",
  async (req: Request, res: Response) => {
    try {
      const input = WalletRecalculateSchema.parse(req.body);
      const tripId = String(req.params.id || "");
      const walletId = String(req.params.walletId || "");
      if (!tripId || !walletId) {
        return res.status(400).json({ error: "Missing tripId or walletId" });
      }
      const result = await TripService.recalculateWalletEntriesToBase(
        input.userId,
        tripId,
        walletId,
        {
          mode: input.mode,
          fxRate: input.fxRate ?? null,
        },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(400)
        .json({ error: error.message || "Failed to recalculate wallet entries" });
    }
  },
);

tripsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    const tripId = String(req.params.id || "");
    if (!userId || !tripId) {
      return res.status(400).json({ error: "Missing userId or tripId" });
    }
    const trip = await TripService.getTrip(userId, tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json({ trip });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch trip" });
  }
});

tripsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const input = TripUpdateSchema.parse(req.body);
    const tripId = String(req.params.id || "");
    if (!tripId) return res.status(400).json({ error: "Missing tripId" });
    const trip = await TripService.updateTrip(input.userId, tripId, {
      name: input.name,
      coverImageUrl: input.coverImageUrl,
      baseCurrency: input.baseCurrency,
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status,
      notes: input.notes,
    });
    res.json({ trip });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to update trip" });
  }
});

tripsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const input = TripDeleteSchema.parse(req.body);
    const tripId = String(req.params.id || "");
    if (!tripId) return res.status(400).json({ error: "Missing tripId" });
    await TripService.deleteTrip(input.userId, tripId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to delete trip" });
  }
});

tripsRouter.get("/:id/fundings", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    const tripId = String(req.params.id || "");
    if (!userId || !tripId) {
      return res.status(400).json({ error: "Missing userId or tripId" });
    }
    const fundings = await TripService.getTripFundings(userId, tripId);
    res.json({ fundings });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch fundings" });
  }
});

tripsRouter.post("/:id/fundings", async (req: Request, res: Response) => {
  try {
    const input = FundingCreateSchema.parse({ ...req.body, tripId: req.params.id });
    const funding = await TripService.createFunding(input.userId, {
      tripId: input.tripId,
      walletId: input.walletId,
      bankTransactionId: input.bankTransactionId,
      sourceType: input.sourceType,
      sourceCurrency: input.sourceCurrency,
      sourceAmount: input.sourceAmount,
      destinationCurrency: input.destinationCurrency,
      destinationAmount: input.destinationAmount,
      fxRate: input.fxRate ?? null,
      feeAmount: input.feeAmount ?? null,
      feeCurrency: input.feeCurrency ?? null,
      baseAmount: input.baseAmount ?? null,
      metadata: input.metadata ?? null,
    });
    res.json({
      funding: funding.funding,
      propagationTrace: funding.propagationTrace ?? null,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to create funding" });
  }
});

tripsRouter.patch("/:id/fundings/:fundingId/match", async (req: Request, res: Response) => {
  try {
    const input = FundingMatchReviewSchema.parse(req.body);
    const tripId = String(req.params.id || "");
    const fundingId = String(req.params.fundingId || "");
    if (!tripId || !fundingId) {
      return res.status(400).json({ error: "Missing tripId or fundingId" });
    }

    const funding = await TripService.reviewFundingMatch(
      input.userId,
      tripId,
      fundingId,
      {
        action: input.action,
        bankTransactionId: input.bankTransactionId ?? null,
      },
    );
    res.json({ funding });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to review funding match" });
  }
});

tripsRouter.patch("/:id/fundings/:fundingId/merge", async (req: Request, res: Response) => {
  try {
    const input = FundingMergeSchema.parse(req.body);
    const tripId = String(req.params.id || "");
    const fundingId = String(req.params.fundingId || "");
    if (!tripId || !fundingId) {
      return res.status(400).json({ error: "Missing tripId or fundingId" });
    }

    const funding = await TripService.mergeImportedFundingIntoExisting(
      input.userId,
      tripId,
      fundingId,
      input.targetFundingId,
    );
    res.json({ funding });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to merge funding" });
  }
});

tripsRouter.patch("/:id/fundings/:fundingId", async (req: Request, res: Response) => {
  try {
    const input = FundingUpdateSchema.parse(req.body);
    const tripId = String(req.params.id || "");
    const fundingId = String(req.params.fundingId || "");
    if (!tripId || !fundingId) {
      return res.status(400).json({ error: "Missing tripId or fundingId" });
    }

    const funding = await TripService.updateFunding(input.userId, tripId, fundingId, buildFundingUpdatePayload({
      walletId: input.walletId,
      sourceCurrency: input.sourceCurrency,
      sourceAmount: input.sourceAmount,
      destinationCurrency: input.destinationCurrency,
      destinationAmount: input.destinationAmount,
      fxRate: input.fxRate,
      feeAmount: input.feeAmount,
      feeCurrency: input.feeCurrency,
      baseAmount: input.baseAmount,
      metadata: input.metadata,
    }));
    res.json({
      funding: funding.funding,
      propagationTrace: funding.propagationTrace ?? null,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to update funding" });
  }
});

tripsRouter.delete("/:id/fundings/:fundingId", async (req: Request, res: Response) => {
  try {
    const input = FundingDeleteSchema.parse(req.body);
    const tripId = String(req.params.id || "");
    const fundingId = String(req.params.fundingId || "");
    if (!tripId || !fundingId) {
      return res.status(400).json({ error: "Missing tripId or fundingId" });
    }

    const result = await TripService.deleteFunding(input.userId, tripId, fundingId);
    res.json({
      success: true,
      propagationTrace: result.propagationTrace ?? null,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to delete funding" });
  }
});

tripsRouter.post("/:id/spendings/import", async (req: Request, res: Response) => {
  try {
    const input = ImportSpendingsSchema.parse(req.body);
    const result = await TripService.importTripSpendings(
      input.userId,
      req.params.id,
      input.walletId,
      input.parserId,
      input.transactions,
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to import trip spendings" });
  }
});

tripsRouter.get("/:id/funding-candidates", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    const tripId = String(req.params.id || "");
    const search = req.query.search ? String(req.query.search) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    if (!userId || !tripId) {
      return res.status(400).json({ error: "Missing userId or tripId" });
    }
    const result = await TripService.getFundingCandidates(
      userId,
      tripId,
      search,
      limit,
      offset,
    );
    res.json({
      ...result,
      limit,
      offset,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch candidates" });
  }
});

tripsRouter.get("/:id/source-transactions", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }
    const query = SourceTransactionsQuerySchema.parse(req.query);
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const result = await TripService.getSourceTransactionCandidates(
      query.userId,
      tripId,
      query.search,
      limit,
      offset,
    );
    res.json({
      ...result,
      limit,
      offset,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch source transactions" });
  }
});

tripsRouter.get("/:id/outgoing-funding-candidates", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }
    const query = OutgoingFundingCandidatesQuerySchema.parse(req.query);
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const result = await TripService.getOutgoingFundingEntryCandidates(
      query.userId,
      tripId,
      query.sourceTripId,
      query.search,
      limit,
      offset,
    );
    res.json({ ...result, limit, offset });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch outgoing funding candidates" });
  }
});

tripsRouter.post("/:id/fundings/from-outgoing-entries", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }
    const input = AddFundingsFromOutgoingEntriesSchema.parse(req.body);
    const result = await TripService.addFundingsFromOutgoingEntries(
      input.userId,
      tripId,
      input.sourceEntryIds,
      input.walletId ?? null,
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to import fundings from outgoing entries" });
  }
});

tripsRouter.post("/:id/entries/from-main", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }
    const input = AddEntriesFromSourceSchema.parse(req.body);
    const result = await TripService.addEntriesFromSourceTransactions(
      input.userId,
      tripId,
      {
        transactionIds: input.transactionIds,
        categoryId: input.categoryId ?? null,
        entryType: input.entryType,
        fundingOut: input.fundingOut ?? null,
      },
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to add transactions from bank ledger" });
  }
});

tripsRouter.post("/:id/entries", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }
    const input = TripEntryCreateSchema.parse(req.body);
    const entry = await TripService.createTripEntry(input.userId, tripId, {
      walletId: input.walletId ?? null,
      type: input.type,
      date: input.date,
      description: input.description,
      label: input.label ?? null,
      categoryId: input.categoryId ?? null,
      localCurrency: input.localCurrency,
      localAmount: input.localAmount,
      baseAmount: input.baseAmount,
      fxRate: input.fxRate ?? null,
      feeAmount: input.feeAmount ?? null,
      feeCurrency: input.feeCurrency ?? null,
      fundingOut: input.fundingOut ?? null,
      metadata: input.metadata ?? null,
    });
    res.json({ entry });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to create trip entry" });
  }
});

tripsRouter.get("/:id/wallet-summaries", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    const tripId = String(req.params.id || "");
    if (!userId || !tripId) {
      return res.status(400).json({ error: "Missing userId or tripId" });
    }
    const wallets = await TripService.getTripWalletSummaries(userId, tripId);
    res.json({ wallets });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch wallet summaries" });
  }
});

tripsRouter.get("/:id/entries", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) return res.status(400).json({ error: "Missing tripId" });

    const query = TripEntriesQuerySchema.parse(req.query);
    const result = await TripService.getTripEntries(query.userId, tripId, {
      search: query.search,
      walletId: query.walletId,
      categoryId: query.categoryId,
      type: query.type,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit: query.limit,
      offset: query.offset,
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to fetch trip entries" });
  }
});

tripsRouter.get(
  "/:id/entries/search-reimbursement",
  async (req: Request, res: Response) => {
    try {
      const tripId = String(req.params.id || "");
      if (!tripId) return res.status(400).json({ error: "Missing tripId" });
      const query = TripReimbursementSearchQuerySchema.parse(req.query);
      const result = await TripService.searchTripEntriesForReimbursement(
        query.userId,
        tripId,
        query.search,
        query.limit || 20,
        query.offset || 0,
        query.excludeEntryId,
        {
          walletId: query.walletId,
          categoryId: query.categoryId,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          amountBaseEquals:
            typeof query.amountBaseEquals === "number" &&
            Number.isFinite(query.amountBaseEquals)
              ? query.amountBaseEquals
              : undefined,
        },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(400)
        .json({ error: error.message || "Failed to search reimbursement entries" });
    }
  },
);

tripsRouter.post(
  "/:id/entries/:entryId/link-reimbursement",
  async (req: Request, res: Response) => {
    try {
      const tripId = String(req.params.id || "");
      const entryId = String(req.params.entryId || "");
      if (!tripId || !entryId) {
        return res.status(400).json({ error: "Missing tripId or entryId" });
      }
      const input = TripReimbursementLinkSchema.parse(req.body);
      const result = await TripService.createTripReimbursementLink(
        input.userId,
        tripId,
        entryId,
        input.reimbursedAllocations,
        input.leftoverCategoryId ?? null,
        {
          reimbursementBaseAmount: input.reimbursementBaseAmount ?? null,
          reimbursingFxRate: input.reimbursingFxRate ?? null,
        },
        {
          syncToBankLedger: input.syncToBankLedger === true,
        },
      );
      res.json(result);
    } catch (error: any) {
      res
        .status(400)
        .json({ error: error.message || "Failed to link reimbursement" });
    }
  },
);

tripsRouter.delete(
  "/:id/entries/:entryId/linkage",
  async (req: Request, res: Response) => {
    try {
      const tripId = String(req.params.id || "");
      const entryId = String(req.params.entryId || "");
      if (!tripId || !entryId) {
        return res.status(400).json({ error: "Missing tripId or entryId" });
      }
      const input = TripEntryClearLinkageSchema.parse(req.body);
      const result = await TripService.clearTripEntryLinkage(
        input.userId,
        tripId,
        entryId,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || "Failed to clear linkage" });
    }
  },
);

tripsRouter.patch("/:id/entries/bulk-by-ids", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) return res.status(400).json({ error: "Missing tripId" });
    const input = TripEntriesBulkUpdateByIdsSchema.parse(req.body);
    const result = await TripService.bulkUpdateEntriesByIds(
      input.userId,
      tripId,
      input.ids,
      {
        categoryId: input.updates.categoryId,
        date: input.updates.date,
      },
    );
    res.json({ success: true, updatedCount: result.count });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to bulk update entries" });
  }
});

tripsRouter.patch(
  "/:id/entries/bulk-by-filter",
  async (req: Request, res: Response) => {
    try {
      const tripId = String(req.params.id || "");
      if (!tripId) return res.status(400).json({ error: "Missing tripId" });
      const input = TripEntriesBulkUpdateByFilterSchema.parse(req.body);
      const result = await TripService.bulkUpdateEntriesByFilter(
        input.userId,
        tripId,
        {
          search: input.filters.search,
          walletId: input.filters.walletId,
          categoryId: input.filters.categoryId,
          dateFrom: input.filters.dateFrom,
          dateTo: input.filters.dateTo,
        },
        input.excludeIds,
        {
          categoryId: input.updates.categoryId,
          date: input.updates.date,
        },
      );
      res.json({ success: true, updatedCount: result.count });
    } catch (error: any) {
      res
        .status(400)
        .json({ error: error.message || "Failed to bulk update entries by filter" });
    }
  },
);

tripsRouter.delete("/:id/entries/bulk-by-ids", async (req: Request, res: Response) => {
  try {
    const tripId = String(req.params.id || "");
    if (!tripId) return res.status(400).json({ error: "Missing tripId" });
    const input = TripEntriesBulkDeleteByIdsSchema.parse(req.body);
    const result = await TripService.bulkDeleteEntriesByIds(
      input.userId,
      tripId,
      input.ids,
    );
    res.json({ success: true, deletedCount: result.count });
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to bulk delete entries" });
  }
});

tripsRouter.delete(
  "/:id/entries/bulk-by-filter",
  async (req: Request, res: Response) => {
    try {
      const tripId = String(req.params.id || "");
      if (!tripId) return res.status(400).json({ error: "Missing tripId" });
      const input = TripEntriesBulkDeleteByFilterSchema.parse(req.body);
      const result = await TripService.bulkDeleteEntriesByFilter(
        input.userId,
        tripId,
        {
          search: input.filters.search,
          walletId: input.filters.walletId,
          categoryId: input.filters.categoryId,
          dateFrom: input.filters.dateFrom,
          dateTo: input.filters.dateTo,
        },
        input.excludeIds,
      );
      res.json({ success: true, deletedCount: result.count });
    } catch (error: any) {
      res
        .status(400)
        .json({ error: error.message || "Failed to bulk delete entries by filter" });
    }
  },
);

const TripEntryUpdateSchema = z.object({
  userId: z.string(),
  date: z.string().transform((value) => new Date(value)).optional(),
  description: z.string().min(1).optional(),
  label: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  walletId: z.string().optional().nullable(),
  localCurrency: z.string().trim().length(3).optional(),
  localAmount: z.number().positive().optional(),
  baseAmount: z.number().positive().optional().nullable(),
  fxRate: z.number().positive().optional().nullable(),
  fundingOut: TripEntryCreateSchema.shape.fundingOut,
});

// Registered after the bulk routes so "bulk-by-ids" is never taken for an entry id.
tripsRouter.patch("/:id/entries/:entryId", async (req: Request, res: Response) => {
  try {
    const input = TripEntryUpdateSchema.parse(req.body);
    const { userId, ...changes } = input;
    const result = await TripService.updateTripEntry(
      userId,
      String(req.params.id || ""),
      String(req.params.entryId || ""),
      changes,
    );
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to update trip entry" });
  }
});

tripsRouter.get("/:id/analytics", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    const tripId = String(req.params.id || "");
    if (!userId || !tripId) {
      return res.status(400).json({ error: "Missing userId or tripId" });
    }
    const analytics = await TripService.getTripAnalytics(userId, tripId);
    res.json(analytics);
  } catch (error: any) {
    res.status(400).json({ error: error.message || "Failed to fetch trip analytics" });
  }
});
