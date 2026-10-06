import * as walletActions from "@/app/actions/tripWallets";
import type { TripActionResult } from "@/app/actions/trips";

/**
 * Wallet actions that throw the data-service message on failure. The server
 * actions return it as a value because Next.js hides thrown messages in production.
 */
function unwrap<T>(result: TripActionResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export const getTripWallets = async (
  ...args: Parameters<typeof walletActions.getTripWallets>
) => unwrap(await walletActions.getTripWallets(...args));

export const updateTripWallet = async (
  ...args: Parameters<typeof walletActions.updateTripWallet>
) => unwrap(await walletActions.updateTripWallet(...args));

export const deleteTripWallet = async (
  ...args: Parameters<typeof walletActions.deleteTripWallet>
) => unwrap(await walletActions.deleteTripWallet(...args));

export const mergeTripWallet = async (
  ...args: Parameters<typeof walletActions.mergeTripWallet>
) => unwrap(await walletActions.mergeTripWallet(...args));

export const getWalletAccounts = async (
  ...args: Parameters<typeof walletActions.getWalletAccounts>
) => unwrap(await walletActions.getWalletAccounts(...args));

export const createWalletAccount = async (
  ...args: Parameters<typeof walletActions.createWalletAccount>
) => unwrap(await walletActions.createWalletAccount(...args));

export const updateWalletAccount = async (
  ...args: Parameters<typeof walletActions.updateWalletAccount>
) => unwrap(await walletActions.updateWalletAccount(...args));

export const getCarryOverCandidates = async (
  ...args: Parameters<typeof walletActions.getCarryOverCandidates>
) => unwrap(await walletActions.getCarryOverCandidates(...args));

export const getCarryOverSources = async (
  ...args: Parameters<typeof walletActions.getCarryOverSources>
) => unwrap(await walletActions.getCarryOverSources(...args));

export const carryOverWallets = async (
  ...args: Parameters<typeof walletActions.carryOverWallets>
) => unwrap(await walletActions.carryOverWallets(...args));
