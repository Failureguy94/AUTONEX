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
 * User-friendly parser for Web3 and Arkiv RPC transaction errors
 */
export function formatArkivError(error: unknown): string {
  const msg = String(error instanceof Error ? error.message : error);

  if (
    msg.includes('User rejected') ||
    msg.includes('ACTION_REJECTED') ||
    msg.includes('denied transaction') ||
    msg.includes('user rejected action')
  ) {
    return 'Transaction cancelled by user in wallet.';
  }
  if (msg.includes('insufficient funds') || msg.includes('Insufficient tGLM')) {
    return 'Insufficient tGLM balance for storage fee. Claim tokens from hub.arkiv.network.';
  }
  if (
    msg.includes('ChainMismatchError') ||
    msg.includes('wrong chain') ||
    msg.includes('Wrong network') ||
    /switch to the rabdi/i.test(msg) ||
    /wallet switch required/i.test(msg) ||
    /unrecognized chain/i.test(msg)
  ) {
    return 'Please switch your wallet to the Rabdi DB-Chain Testnet (Chain ID 7794095).';
  }
  if (msg.includes('MissingAccessKeyError') || msg.includes('rate limit')) {
    return 'Arkiv RPC rate limit reached. Configure VITE_ARKIV_ACCESS_KEY in .env.local.';
  }
  if (msg.includes('EntityTooLargeError') || msg.includes('MAX_ENTITY_BYTES')) {
    return 'Payload exceeds Arkiv limit of 128 KiB per entity.';
  }
  return msg.slice(0, 160);
}

