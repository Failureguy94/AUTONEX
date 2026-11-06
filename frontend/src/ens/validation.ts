import { keccak256, stringToHex } from 'viem';
import type { Address } from 'viem';
import type { EnsAgentIdentity } from './types';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export function normalizeAgentLabel(input: string): string {
  const label = input.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!label) throw new Error('Agent name must produce a valid ENS label.');
  return label;
}

export function textResource(key: string): bigint {
  return BigInt(keccak256(stringToHex(key)));
}

export function identityMatches(identity: Pick<EnsAgentIdentity, 'walletAddress'>, resolvedAddress: Address | null): boolean {
  return Boolean(resolvedAddress && identity.walletAddress.toLowerCase() === resolvedAddress.toLowerCase());
}

export function resolutionStatus(resolvedAddress: Address | null): EnsAgentIdentity['identityStatus'] {
  return resolvedAddress ? 'active' : 'unresolved';
}
