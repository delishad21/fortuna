import * as tripActions from "@/app/actions/trips";
import type { TripActionResult } from "@/app/actions/trips";

/**
 * Trip mutations that throw the data-service message on failure. The server
 * actions return it as a value because Next.js hides thrown messages in production.
 */
function unwrap<T>(result: TripActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export const createTrip = async (
  ...args: Parameters<typeof tripActions.createTrip>
) => unwrap(await tripActions.createTrip(...args));

export const updateTrip = async (
  ...args: Parameters<typeof tripActions.updateTrip>
) => unwrap(await tripActions.updateTrip(...args));

export const deleteTrip = async (
  ...args: Parameters<typeof tripActions.deleteTrip>
) => unwrap(await tripActions.deleteTrip(...args));

export const createTripFunding = async (
  ...args: Parameters<typeof tripActions.createTripFunding>
) => unwrap(await tripActions.createTripFunding(...args));

export const reviewTripFundingMatch = async (
  ...args: Parameters<typeof tripActions.reviewTripFundingMatch>
) => unwrap(await tripActions.reviewTripFundingMatch(...args));

export const mergeTripFunding = async (
  ...args: Parameters<typeof tripActions.mergeTripFunding>
) => unwrap(await tripActions.mergeTripFunding(...args));

export const updateTripFunding = async (
  ...args: Parameters<typeof tripActions.updateTripFunding>
) => unwrap(await tripActions.updateTripFunding(...args));

export const deleteTripFunding = async (
  ...args: Parameters<typeof tripActions.deleteTripFunding>
) => unwrap(await tripActions.deleteTripFunding(...args));

export const createWallet = async (
  ...args: Parameters<typeof tripActions.createWallet>
) => unwrap(await tripActions.createWallet(...args));

export const recalculateWalletEntriesToBase = async (
  ...args: Parameters<typeof tripActions.recalculateWalletEntriesToBase>
) => unwrap(await tripActions.recalculateWalletEntriesToBase(...args));

export const importTripSpendings = async (
  ...args: Parameters<typeof tripActions.importTripSpendings>
) => unwrap(await tripActions.importTripSpendings(...args));

export const createTripReimbursementLink = async (
  ...args: Parameters<typeof tripActions.createTripReimbursementLink>
) => unwrap(await tripActions.createTripReimbursementLink(...args));

export const clearTripEntryLinkage = async (
  ...args: Parameters<typeof tripActions.clearTripEntryLinkage>
) => unwrap(await tripActions.clearTripEntryLinkage(...args));

export const addEntriesFromSourceTransactions = async (
  ...args: Parameters<typeof tripActions.addEntriesFromSourceTransactions>
) => unwrap(await tripActions.addEntriesFromSourceTransactions(...args));

export const createTripEntry = async (
  ...args: Parameters<typeof tripActions.createTripEntry>
) => unwrap(await tripActions.createTripEntry(...args));

export const updateTripEntry = async (
  ...args: Parameters<typeof tripActions.updateTripEntry>
) => unwrap(await tripActions.updateTripEntry(...args));

export const addFundingsFromOutgoingEntries = async (
  ...args: Parameters<typeof tripActions.addFundingsFromOutgoingEntries>
) => unwrap(await tripActions.addFundingsFromOutgoingEntries(...args));

export const bulkUpdateTripEntriesByIds = async (
  ...args: Parameters<typeof tripActions.bulkUpdateTripEntriesByIds>
) => unwrap(await tripActions.bulkUpdateTripEntriesByIds(...args));

export const bulkUpdateTripEntriesByFilter = async (
  ...args: Parameters<typeof tripActions.bulkUpdateTripEntriesByFilter>
) => unwrap(await tripActions.bulkUpdateTripEntriesByFilter(...args));

export const bulkDeleteTripEntriesByIds = async (
  ...args: Parameters<typeof tripActions.bulkDeleteTripEntriesByIds>
) => unwrap(await tripActions.bulkDeleteTripEntriesByIds(...args));

export const bulkDeleteTripEntriesByFilter = async (
  ...args: Parameters<typeof tripActions.bulkDeleteTripEntriesByFilter>
) => unwrap(await tripActions.bulkDeleteTripEntriesByFilter(...args));
