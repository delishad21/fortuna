type FundingNormalizationInput = {
  sourceCurrency: string;
  sourceAmount: number;
  destinationCurrency: string;
  destinationAmount?: number | null;
  fxRate?: number | null;
  feeAmount?: number | null;
  feeCurrency?: string | null;
  baseCurrency: string;
  baseAmount?: number | null;
};

type TripImportBaseAmountInput = {
  localAmount: number;
  localCurrency: string;
  statementAmount: number;
  statementCurrency: string;
  baseCurrency: string;
  metadata?: Record<string, unknown> | null;
};

type ImpactedReimbursementEntryIdsInput = {
  reimbursementEntryId: string;
  previousTargetIds: string[];
  nextTargetIds: string[];
};

type FundingInBankMatchInput = {
  fundingSourceAmount: number;
  fundingSourceCurrency: string;
  bankAmountOut: number;
  bankCurrency: string;
};

type FundingOutFeeBaseAmountInput = {
  feeAmount: number;
  feeCurrency: string;
  baseCurrency: string;
  sourceCurrency: string;
  destinationCurrency: string;
  sourceAmount: number;
  sourceBaseAmount: number;
  fxRate: number;
};

type FundingOutFeeCurrencyValidationInput = {
  feeCurrency: string | null;
  sourceCurrency: string;
  destinationCurrency: string;
  tripBaseCurrency: string;
};

type FundingBaseAmountPreservationInput = {
  fundingCoreValueChanged: boolean;
  sourceCurrency: string;
  destinationCurrency: string;
  baseCurrency: string;
};

type FundingCoreValueChangeInput = {
  current: {
    sourceCurrency: string;
    sourceAmount: number;
    destinationCurrency: string;
    destinationAmount: number;
    fxRate?: number | null;
  };
  next: {
    sourceCurrency?: string;
    sourceAmount?: number | null;
    destinationCurrency?: string;
    destinationAmount?: number | null;
    fxRate?: number | null;
  };
};

type FundingUpdatePayloadInput = {
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
};

type ReimbursementLeftoverBaseInput = {
  reimbursementBaseAmount: number;
  allocationBaseAmounts: number[];
};

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const toCurrency = (value: unknown, fallback = ""): string => {
  const raw = String(value ?? fallback).trim().toUpperCase();
  return raw || fallback.toUpperCase();
};

export const normalizeCurrencyCode = (value: unknown, fallback = "SGD"): string => {
  const raw = String(value ?? "").trim();
  const normalized = (raw || String(fallback ?? "")).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("Currency must be a 3-letter ISO code.");
  }
  return normalized;
};

export const normalizeOptionalCurrencyUpdate = (
  value: unknown,
): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  return raw ? normalizeCurrencyCode(raw) : null;
};

export const normalizeFundingValues = (input: FundingNormalizationInput) => {
  const sourceCurrency = toCurrency(input.sourceCurrency);
  const destinationCurrency = toCurrency(input.destinationCurrency);
  const baseCurrency = toCurrency(input.baseCurrency, "SGD");
  const sourceAmount = Number(input.sourceAmount || 0);

  if (!sourceCurrency || !destinationCurrency) {
    throw new Error("Source and destination currencies are required.");
  }
  if (!(sourceAmount > 0)) {
    throw new Error("Source amount must be greater than 0.");
  }

  const rawFeeAmount = Number(input.feeAmount || 0);
  const feeAmount = rawFeeAmount > 0 ? rawFeeAmount : 0;
  const feeCurrency = feeAmount
    ? toCurrency(input.feeCurrency, sourceCurrency)
    : null;

  if (
    feeCurrency &&
    feeCurrency !== sourceCurrency &&
    feeCurrency !== destinationCurrency
  ) {
    throw new Error(
      "Fee currency must be either source currency or destination currency.",
    );
  }

  const requestedDestinationAmount =
    input.destinationAmount === null || input.destinationAmount === undefined
      ? null
      : Number(input.destinationAmount);
  const requestedFxRate =
    input.fxRate === null || input.fxRate === undefined
      ? null
      : Number(input.fxRate);

  let fxRate = 1;
  let destinationAmount = requestedDestinationAmount ?? 0;
  let feeInDestination = 0;

  if (sourceCurrency === destinationCurrency) {
    fxRate = 1;
    feeInDestination = feeAmount;
    const expectedDestination = sourceAmount - feeInDestination;
    if (!(expectedDestination > 0)) {
      throw new Error("Fee exceeds source amount.");
    }

    if (requestedDestinationAmount !== null) {
      if (Math.abs(requestedDestinationAmount - expectedDestination) > 0.01) {
        throw new Error(
          "For same-currency funding, destination amount must equal source amount minus fee.",
        );
      }
      destinationAmount = requestedDestinationAmount;
    } else {
      destinationAmount = expectedDestination;
    }
  } else {
    if (requestedFxRate !== null && requestedDestinationAmount !== null) {
      const provisionalFeeInDestination =
        feeAmount > 0 && feeCurrency === sourceCurrency
          ? feeAmount / requestedFxRate
          : feeAmount;
      const expectedSource =
        (requestedDestinationAmount + provisionalFeeInDestination) *
        requestedFxRate;
      if (Math.abs(expectedSource - sourceAmount) > 0.01) {
        throw new Error(
          "Provide either destination amount or FX rate, or ensure both are consistent with source and fee.",
        );
      }
      fxRate = requestedFxRate;
      destinationAmount = requestedDestinationAmount;
      feeInDestination = provisionalFeeInDestination;
    } else if (requestedFxRate !== null) {
      if (!(requestedFxRate > 0)) {
        throw new Error("FX rate must be greater than 0.");
      }
      fxRate = requestedFxRate;
      feeInDestination =
        feeAmount > 0 && feeCurrency === sourceCurrency
          ? feeAmount / fxRate
          : feeAmount;
      destinationAmount = sourceAmount / fxRate - feeInDestination;
    } else if (requestedDestinationAmount !== null) {
      if (!(requestedDestinationAmount > 0)) {
        throw new Error("Destination amount must be greater than 0.");
      }
      destinationAmount = requestedDestinationAmount;
      feeInDestination =
        feeAmount > 0 && feeCurrency === destinationCurrency
          ? feeAmount
          : 0;
      const denominator = destinationAmount + feeInDestination;
      if (!(denominator > 0)) {
        throw new Error("Destination amount must remain greater than 0.");
      }
      fxRate = sourceAmount / denominator;
    } else {
      throw new Error("Either destination amount or FX rate is required.");
    }
  }

  if (!(destinationAmount > 0)) {
    throw new Error(
      "Destination amount must remain greater than 0 after fee deduction.",
    );
  }
  if (!(fxRate > 0)) {
    throw new Error("FX rate must be greater than 0.");
  }

  const explicitBaseAmount = Number(input.baseAmount || 0);
  let baseAmount: number;
  if (sourceCurrency === baseCurrency) {
    baseAmount = sourceAmount;
  } else if (destinationCurrency === baseCurrency) {
    baseAmount = destinationAmount + feeInDestination;
  } else if (explicitBaseAmount > 0) {
    baseAmount = explicitBaseAmount;
  } else {
    throw new Error(
      "A base amount is required when neither funding currency matches the trip base currency.",
    );
  }

  return {
    sourceCurrency,
    sourceAmount,
    destinationCurrency,
    destinationAmount,
    fxRate,
    feeAmount: feeAmount > 0 ? feeAmount : null,
    feeCurrency: feeAmount > 0 ? feeCurrency : null,
    baseAmount,
  };
};

export const validateFundingInBankMatch = (input: FundingInBankMatchInput) => {
  const fundingSourceAmount = Number(input.fundingSourceAmount || 0);
  const bankAmountOut = Number(input.bankAmountOut || 0);
  const fundingSourceCurrency = toCurrency(input.fundingSourceCurrency);
  const bankCurrency = toCurrency(input.bankCurrency);

  if (!(bankAmountOut > 0)) {
    throw new Error(
      "Linked bank transaction must be a debit (amount out) for funding in.",
    );
  }
  if (Math.abs(fundingSourceAmount - bankAmountOut) > 0.01) {
    throw new Error(
      "Source amount must match the linked bank transaction amount out.",
    );
  }
  if (bankCurrency !== fundingSourceCurrency) {
    throw new Error(
      "Source currency must match the linked bank transaction currency.",
    );
  }
};

export const resolveFundingOutFeeBaseAmount = (
  input: FundingOutFeeBaseAmountInput,
) => {
  const feeAmount = Number(input.feeAmount || 0);
  if (!(feeAmount > 0)) return 0;

  const feeCurrency = toCurrency(input.feeCurrency);
  const baseCurrency = toCurrency(input.baseCurrency);
  const sourceCurrency = toCurrency(input.sourceCurrency);
  const destinationCurrency = toCurrency(input.destinationCurrency);
  const sourceAmount = Number(input.sourceAmount || 0);
  const sourceBaseAmount = Number(input.sourceBaseAmount || 0);
  const fxRate = Number(input.fxRate || 0);

  if (feeCurrency === baseCurrency) return feeAmount;

  const sourceToBaseRate =
    sourceAmount > 0 && sourceBaseAmount > 0 ? sourceBaseAmount / sourceAmount : 1;

  if (feeCurrency === sourceCurrency) {
    return feeAmount * sourceToBaseRate;
  }
  if (feeCurrency === destinationCurrency && fxRate > 0) {
    return feeAmount * fxRate * sourceToBaseRate;
  }

  return feeAmount * sourceToBaseRate;
};

export const shouldPreserveFundingBaseAmount = (
  input: FundingBaseAmountPreservationInput,
) => {
  if (input.fundingCoreValueChanged) return false;

  const sourceCurrency = toCurrency(input.sourceCurrency);
  const destinationCurrency = toCurrency(input.destinationCurrency);
  const baseCurrency = toCurrency(input.baseCurrency, "SGD");

  return sourceCurrency !== baseCurrency && destinationCurrency !== baseCurrency;
};

export const hasFundingCoreValueChanged = (
  input: FundingCoreValueChangeInput,
) => {
  const changedCurrency = (next: string | undefined, current: string) =>
    next !== undefined && toCurrency(next) !== toCurrency(current);
  const changedNumber = (
    next: number | null | undefined,
    current: number | null | undefined,
  ) => {
    if (next === undefined) return false;
    const nextNumber = toNumber(next);
    const currentNumber = toNumber(current);
    if (nextNumber === null || currentNumber === null) {
      return nextNumber !== currentNumber;
    }
    return Math.abs(nextNumber - currentNumber) > 0.0001;
  };

  return (
    changedCurrency(input.next.sourceCurrency, input.current.sourceCurrency) ||
    changedNumber(input.next.sourceAmount, input.current.sourceAmount) ||
    changedCurrency(
      input.next.destinationCurrency,
      input.current.destinationCurrency,
    ) ||
    changedNumber(
      input.next.destinationAmount,
      input.current.destinationAmount,
    ) ||
    changedNumber(input.next.fxRate, input.current.fxRate ?? null)
  );
};

export const buildFundingUpdatePayload = (input: FundingUpdatePayloadInput) => ({
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
});

export const validateFundingOutFeeCurrency = (
  input: FundingOutFeeCurrencyValidationInput,
) => {
  const feeCurrency = toCurrency(input.feeCurrency);
  if (!feeCurrency) return;

  const sourceCurrency = toCurrency(input.sourceCurrency);
  const destinationCurrency = toCurrency(input.destinationCurrency);
  const tripBaseCurrency = toCurrency(input.tripBaseCurrency, "SGD");

  if (
    feeCurrency !== sourceCurrency &&
    feeCurrency !== destinationCurrency &&
    feeCurrency !== tripBaseCurrency
  ) {
    throw new Error(
      "Funding out fee currency must be either the source, destination, or trip base currency.",
    );
  }
};

export const collectImpactedReimbursementEntryIds = (
  input: ImpactedReimbursementEntryIdsInput,
) => {
  return Array.from(
    new Set(
      [
        input.reimbursementEntryId,
        ...input.previousTargetIds,
        ...input.nextTargetIds,
      ]
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
  );
};

export const calculateReimbursementLeftoverBase = (
  input: ReimbursementLeftoverBaseInput,
) => {
  const reimbursementBaseAmount = Number(input.reimbursementBaseAmount || 0);
  const allocatedBaseAmount = input.allocationBaseAmounts.reduce(
    (sum, amount) => sum + Number(amount || 0),
    0,
  );

  return Number(Math.max(reimbursementBaseAmount - allocatedBaseAmount, 0).toFixed(4));
};

export const resolveTripImportBaseAmount = (input: TripImportBaseAmountInput) => {
  const metadata = input.metadata || {};
  const localCurrency = toCurrency(input.localCurrency, input.baseCurrency);
  const statementCurrency = toCurrency(input.statementCurrency, input.baseCurrency);
  const baseCurrency = toCurrency(input.baseCurrency, "SGD");
  const manualBaseAmount = toNumber(metadata.manualBaseAmount);
  const manualFxRate = toNumber(metadata.manualFxRate);

  if (manualBaseAmount && manualBaseAmount > 0) {
    return manualBaseAmount;
  }
  if (manualFxRate && manualFxRate > 0) {
    return input.localAmount * manualFxRate;
  }

  if (localCurrency === baseCurrency) return input.localAmount;
  if (statementCurrency === baseCurrency) return input.statementAmount;

  const fxRate = toNumber(metadata.fxRate);
  const fxBaseCurrency = toCurrency(
    metadata.fxBaseCurrency || metadata.baseCurrency,
  );
  const fxQuoteCurrency = toCurrency(
    metadata.fxQuoteCurrency || metadata.quoteCurrency,
  );

  if (fxRate && fxRate > 0) {
    if (fxBaseCurrency === baseCurrency && fxQuoteCurrency === localCurrency) {
      return input.localAmount / fxRate;
    }
    if (fxBaseCurrency === localCurrency && fxQuoteCurrency === baseCurrency) {
      return input.localAmount * fxRate;
    }
    if (fxBaseCurrency === baseCurrency && fxQuoteCurrency === statementCurrency) {
      return input.statementAmount / fxRate;
    }
    if (fxBaseCurrency === statementCurrency && fxQuoteCurrency === baseCurrency) {
      return input.statementAmount * fxRate;
    }
  }

  throw new Error(
    "A base amount is required when neither import currency matches the trip base currency.",
  );
};
