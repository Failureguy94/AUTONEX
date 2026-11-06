import { formatEther, type Address } from 'viem';
import { arkivPublicClient } from './client';

export const RABDI_FAUCET_URL = 'https://hub.arkiv.network/';
export const RABDI_EXPLORER_URL = 'https://rabdi.explorer.arkiv.network';

/**
 * Retrieve the actual native tGLM balance for a wallet address on Rabdi DB-Chain
 */
export async function fetchTglmBalance(address: Address): Promise<{ value: bigint; formatted: string }> {
  try {
    const value = await arkivPublicClient.getBalance({ address });
    const fullEther = formatEther(value);
    const num = parseFloat(fullEther);
    const formatted = num >= 1 ? num.toFixed(3) : num.toFixed(4);
    return { value, formatted };
  } catch (err) {
    console.warn('[Arkiv] Failed to fetch balance:', err);
    return { value: 0n, formatted: '0.000' };
  }
}

/**
 * Validates whether the account has enough tGLM to execute a write transaction.
 * Defaults to minimum reserve of 0.0001 tGLM for storage gas.
 */
export async function assertSufficientTglm(
  address: Address,
  minimumWei = 100_000_000_000_000n
): Promise<void> {
  const { value } = await fetchTglmBalance(address);
  if (value < minimumWei) {
    throw new Error(
      `Insufficient tGLM balance (${formatEther(value)} tGLM). ` +
      `Writing to Arkiv DB-Chain requires testnet tGLM for storage and gas fees. ` +
      `Claim free tokens from the faucet at ${RABDI_FAUCET_URL}`
    );
  }
}

/**
 * Safely extracts a meaningful error message from any error, object, or RPC response.
 * Guarantees never returning '[object Object]'.
 */
function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') {
    const trimmed = error.trim();
    return trimmed === '[object Object]' ? '' : trimmed;
  }
  if (typeof error === 'object') {
    const err = error as Record<string, any>;

    const candidates = [
      err.shortMessage,
      err.message,
      err.details,
      err.reason,
      err.data?.message,
      err.data?.originalError?.message,
      err.error?.message,
    ];

    for (const cand of candidates) {
      if (typeof cand === 'string' && cand.trim() && cand.trim() !== '[object Object]') {
        return cand.trim();
      }
    }

    if (err.cause) {
      const causeMsg = extractErrorMessage(err.cause);
      if (causeMsg && causeMsg !== '[object Object]') return causeMsg;
    }

    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}' && json !== '[]') {
        return json;
      }
    } catch {
      // Ignore cyclic structure
    }

    if (typeof err.toString === 'function') {
      try {
        const s = err.toString();
        if (s && s !== '[object Object]') return s;
      } catch {
        // Ignore
      }
    }
  }

  const fallback = String(error);
  return fallback === '[object Object]' ? '' : fallback;
}

/**
 * User-friendly parser for Web3 and Arkiv RPC transaction errors
 */
export function formatArkivError(error: unknown): string {
  const msg = extractErrorMessage(error);
  const code =
    (error as any)?.code ??
    (error as any)?.cause?.code ??
    (error as any)?.data?.code ??
    (error as any)?.data?.originalError?.code;

  if (
    code === 4001 ||
    msg.includes('User rejected') ||
    msg.includes('ACTION_REJECTED') ||
    msg.includes('denied transaction') ||
    msg.includes('user rejected action') ||
    msg.includes('User denied account authorization') ||
    /user rejected/i.test(msg) ||
    /user cancelled/i.test(msg) ||
    /user denied/i.test(msg)
  ) {
    return 'Transaction cancelled by user in wallet.';
  }

  if (
    code === 4100 ||
    msg.includes('4100') ||
    msg.includes('unauthorized') ||
    msg.includes('not been authorized')
  ) {
    return 'MetaMask account unauthorized. Please approve wallet account access via eth_requestAccounts.';
  }

  if (msg.includes('authorization mismatch') || msg.includes('Wallet authorization mismatch')) {
    return msg;
  }

  if (
    msg.includes('without revert data') ||
    msg.includes('execution reverted') ||
    msg.includes('contractfunctionexecutionerror')
  ) {
    return 'Arkiv Rabdi DB-Chain transaction reverted. Please verify your wallet is connected to Chain ID 7794095 with sufficient tGLM for storage and gas fees.';
  }

  if (
    msg.includes('insufficient funds') ||
    msg.includes('Insufficient tGLM') ||
    msg.includes('gas required exceeds allowance')
  ) {
    return 'Insufficient tGLM balance for storage fee. Claim tokens from hub.arkiv.network.';
  }

  if (
    code === 4902 ||
    msg.includes('ChainMismatchError') ||
    msg.includes('wrong chain') ||
    msg.includes('Wrong network') ||
    msg.includes('unrecognized chain') ||
    msg.includes('Unknown chain') ||
    msg.includes('does not match') ||
    msg.includes('not been added') ||
    /switch to the rabdi/i.test(msg) ||
    /wallet switch required/i.test(msg) ||
    /unrecognized chain/i.test(msg) ||
    // Only treat "chain id" references as a mismatch when they explicitly indicate a wrong/different chain
    /chain id mismatch/i.test(msg) ||
    /connected to chain id/i.test(msg) ||
    /wrong chain id/i.test(msg) ||
    /incorrect chain/i.test(msg)
  ) {
    return 'Please switch your wallet to the Rabdi DB-Chain Testnet (Chain ID 7794095).';
  }

  if (msg.includes('MissingAccessKeyError') || msg.includes('rate limit') || msg.includes('429')) {
    return 'Arkiv RPC rate limit reached. Configure VITE_ARKIV_ACCESS_KEY in .env.local.';
  }

  if (msg.includes('EntityTooLargeError') || msg.includes('MAX_ENTITY_BYTES')) {
    return 'Payload exceeds Arkiv limit of 128 KiB per entity.';
  }

  if (!msg || msg === '[object Object]') {
    return 'Wallet operation failed. Please verify your connection to Rabdi DB-Chain (Chain ID 7794095).';
  }

  return msg.slice(0, 160);
}

