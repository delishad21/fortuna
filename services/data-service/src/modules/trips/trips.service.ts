import { TripRepository } from "./trips.repository";

export class TripService {
  static createTrip(userId: string, data: {
    name: string;
    coverImageUrl?: string | null;
    baseCurrency: string;
    startDate: Date;
    endDate?: Date | null;
    status?: string;
    notes?: string | null;
  }) {
    return TripRepository.createTrip(userId, data);
  }

  static getTrips(userId: string) {
    return TripRepository.findMany(userId);
  }

  static getTrip(userId: string, tripId: string) {
    return TripRepository.findById(userId, tripId);
  }

  static updateTrip(
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
    return TripRepository.updateTrip(userId, tripId, data);
  }

  static deleteTrip(userId: string, tripId: string) {
    return TripRepository.deleteTrip(userId, tripId);
  }

  static getTripFundings(userId: string, tripId: string) {
    return TripRepository.getFundingsByTrip(userId, tripId);
  }

  static createFunding(userId: string, input: {
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
    metadata?: Record<string, any> | null;
  }) {
    return TripRepository.createFunding(userId, input);
  }

  static reviewFundingMatch(
    userId: string,
    tripId: string,
    fundingId: string,
    input: {
      action: "accept" | "reject" | "replace";
      bankTransactionId?: string | null;
    },
  ) {
    return TripRepository.reviewFundingMatch(userId, tripId, fundingId, input);
  }

  static mergeImportedFundingIntoExisting(
    userId: string,
    tripId: string,
    importedFundingId: string,
    targetFundingId: string,
  ) {
    return TripRepository.mergeImportedFundingIntoExisting(
      userId,
      tripId,
      importedFundingId,
      targetFundingId,
    );
  }

  static updateFunding(
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
    return TripRepository.updateFunding(userId, tripId, fundingId, input);
  }

  static deleteFunding(userId: string, tripId: string, fundingId: string) {
    return TripRepository.deleteFunding(userId, tripId, fundingId);
  }

  static createWallet(
    userId: string,
    tripId: string,
    data: { name: string; currency: string; color?: string | null },
  ) {
    return TripRepository.createWallet(userId, tripId, data);
  }

  static getWallets(userId: string, tripId: string) {
    return TripRepository.findWallets(userId, tripId);
  }

  static recalculateWalletEntriesToBase(
    userId: string,
    tripId: string,
    walletId: string,
    input: {
      mode: "manual" | "weighted";
      fxRate?: number | null;
    },
  ) {
    return TripRepository.recalculateWalletEntriesToBase(
      userId,
      tripId,
      walletId,
      input,
    );
  }

  static importTripSpendings(
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
    return TripRepository.importTripSpendings(
      userId,
      tripId,
      walletId,
      parserId,
      transactions,
    );
  }

  static searchTripEntriesForReimbursement(
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
    return TripRepository.searchTripEntriesForReimbursement(
      userId,
      tripId,
      search,
      limit,
      offset,
      excludeEntryId,
      filters,
    );
  }

  static createTripReimbursementLink(
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
    return TripRepository.createTripReimbursementLink(
      userId,
      tripId,
      reimbursementEntryId,
      allocations,
      leftoverCategoryId ?? null,
      valuation,
      options,
    );
  }

  static clearTripEntryLinkage(
    userId: string,
    tripId: string,
    entryId: string,
  ) {
    return TripRepository.clearTripEntryLinkage(userId, tripId, entryId);
  }

  static getFundingCandidates(
    userId: string,
    tripId: string,
    search?: string,
    limit: number = 100,
    offset: number = 0,
  ) {
    return TripRepository.getFundingCandidates(
      userId,
      tripId,
      search,
      limit,
      offset,
    );
  }

  static getTripWalletSummaries(userId: string, tripId: string) {
    return TripRepository.getTripWalletSummaries(userId, tripId);
  }

  static getTripEntries(
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
    return TripRepository.getTripEntries(userId, tripId, filters);
  }

  static bulkUpdateEntriesByIds(
    userId: string,
    tripId: string,
    ids: string[],
    updates: { categoryId?: string | null; date?: Date },
  ) {
    return TripRepository.bulkUpdateEntriesByIds(userId, tripId, ids, updates);
  }

  static bulkUpdateEntriesByFilter(
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
    return TripRepository.bulkUpdateEntriesByFilter(
      userId,
      tripId,
      filters,
      excludeIds,
      updates,
    );
  }

  static bulkDeleteEntriesByIds(userId: string, tripId: string, ids: string[]) {
    return TripRepository.bulkDeleteEntriesByIds(userId, tripId, ids);
  }

  static bulkDeleteEntriesByFilter(
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
    return TripRepository.bulkDeleteEntriesByFilter(
      userId,
      tripId,
      filters,
      excludeIds,
    );
  }

  static getSourceTransactionCandidates(
    userId: string,
    tripId: string,
    search?: string,
    limit: number = 100,
    offset: number = 0,
  ) {
    return TripRepository.getSourceTransactionCandidates(
      userId,
      tripId,
      search,
      limit,
      offset,
    );
  }

  static addEntriesFromSourceTransactions(
    userId: string,
    tripId: string,
    input: {
      transactionIds: string[];
      categoryId?: string | null;
      entryType?: "spending" | "reimbursement" | "funding_out";
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
    return TripRepository.addEntriesFromSourceTransactions(userId, tripId, input);
  }

  static createTripEntry(
    userId: string,
    tripId: string,
    input: {
      walletId?: string | null;
      type: "spending" | "reimbursement" | "funding_out";
      date: Date;
      description: string;
      label?: string | null;
      categoryId?: string | null;
      localCurrency: string;
      localAmount: number;
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
      metadata?: Record<string, any> | null;
    },
  ) {
    return TripRepository.createTripEntry(userId, tripId, input);
  }

  static getOutgoingFundingEntryCandidates(
    userId: string,
    tripId: string,
    sourceTripId?: string,
    search?: string,
    limit: number = 100,
    offset: number = 0,
  ) {
    return TripRepository.getOutgoingFundingEntryCandidates(
      userId,
      tripId,
      sourceTripId,
      search,
      limit,
      offset,
    );
  }

  static addFundingsFromOutgoingEntries(
    userId: string,
    tripId: string,
    sourceEntryIds: string[],
    walletId?: string | null,
  ) {
    return TripRepository.addFundingsFromOutgoingEntries(
      userId,
      tripId,
      sourceEntryIds,
      walletId,
    );
  }

  static getTripAnalytics(userId: string, tripId: string) {
    return TripRepository.getTripAnalytics(userId, tripId);
  }
}
