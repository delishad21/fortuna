export type FundingInputMode = "amount" | "fxRate";

interface NormalizeFundingEditInput {
  sourceCurrency: string;
  sourceAmount: number;
  destinationCurrency: string;
  destinationAmountInput?: number | null;
  fxRateInput?: number | null;
  inputMode: FundingInputMode;
  feeAmount?: number | null;
  feeCurrency?: string | null;
}

interface NormalizeFundingEditResult {
  sourceCurrency: string;
  sourceAmount: number;
  destinationCurrency: string;
  destinationAmount: number;
  fxRate: number;
  feeAmount: number | null;
  feeCurrency: string | null;
}

export function normalizeFundingEditInput(
  input: NormalizeFundingEditInput,
): NormalizeFundingEditResult {
  const sourceCurrency = String(input.sourceCurrency || "").toUpperCase();
  const destinationCurrency = String(input.destinationCurrency || "").toUpperCase();
  const sourceAmount = Number(input.sourceAmount || 0);

  if (!sourceCurrency || !destinationCurrency) {
    throw new Error("Source and destination currencies are required.");
  }
  if (!(sourceAmount > 0)) {
    throw new Error("Source amount must be greater than 0.");
  }

  const feeAmountValue = Number(input.feeAmount || 0);
  const feeAmount = feeAmountValue > 0 ? feeAmountValue : null;
  const feeCurrency = feeAmount
    ? String(input.feeCurrency || sourceCurrency).toUpperCase()
    : null;

  if (
    feeCurrency &&
    feeCurrency !== sourceCurrency &&
    feeCurrency !== destinationCurrency
  ) {
    throw new Error(
      "Fee currency must be either the source currency or destination currency.",
    );
  }

  let fxRate = 1;
  let destinationAmount = 0;

  if (sourceCurrency === destinationCurrency) {
    fxRate = 1;
    const expectedNet = sourceAmount - (feeAmount || 0);
    if (!(expectedNet > 0)) {
      throw new Error("Fee exceeds source amount.");
    }

    if (input.inputMode === "amount") {
      const requestedDestination = Number(input.destinationAmountInput || 0);
      if (!(requestedDestination > 0)) {
        throw new Error("Destination amount must be greater than 0.");
      }
      if (Math.abs(requestedDestination - expectedNet) > 0.01) {
        throw new Error(
          "For same-currency funding, destination amount must equal source amount minus fee.",
        );
      }
      destinationAmount = requestedDestination;
    } else {
      destinationAmount = expectedNet;
    }
  } else if (input.inputMode === "fxRate") {
    fxRate = Number(input.fxRateInput || 0);
    if (!(fxRate > 0)) {
      throw new Error("FX rate must be greater than 0.");
    }

    const grossDestination = sourceAmount / fxRate;
    const feeInDestination =
      feeAmount && feeCurrency === sourceCurrency
        ? feeAmount / fxRate
        : (feeAmount ?? 0);
    destinationAmount = grossDestination - feeInDestination;
  } else {
    destinationAmount = Number(input.destinationAmountInput || 0);
    if (!(destinationAmount > 0)) {
      throw new Error("Destination amount must be greater than 0.");
    }

    if (feeAmount && feeCurrency === sourceCurrency) {
      fxRate = (sourceAmount - feeAmount) / destinationAmount;
    } else if (feeAmount && feeCurrency === destinationCurrency) {
      fxRate = sourceAmount / (destinationAmount + feeAmount);
    } else {
      fxRate = sourceAmount / destinationAmount;
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

  return {
    sourceCurrency,
    sourceAmount,
    destinationCurrency,
    destinationAmount,
    fxRate,
    feeAmount,
    feeCurrency,
  };
}

