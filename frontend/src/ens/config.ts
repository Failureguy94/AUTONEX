import { sepolia } from 'viem/chains';
import type { Address } from 'viem';

export const ENS_CHAIN_ID = 11155111;
export const ENS_CHAIN = sepolia;

// Addresses are copied from ENS's official Sepolia ENSv2 deployment table:
// https://docs.ens.domains/learn/deployments/#sepolia-ensv2
export const ENSV2_DEPLOYMENTS = {
  ethRegistry: '0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4',
  permissionedResolverImpl: '0x115eb53f0c60696633855f90b138178fb40b2b2c',
  userRegistryImpl: '0x9bd8a88719068d09ecee662f36c0e3856708366a',
  universalResolver: '0x24e1d8e068620b647ca097f961a61055f4f42d72',
  verifiableFactory: '0xda70306c98e97ece36f997a21368e53298572991',
} as const satisfies Record<string, Address>;

const env = (key: string) => (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.[key];

export const ENS_RPC_URL = env('VITE_ENS_SEPOLIA_RPC_URL') || undefined;
export const ENS_PARENT_NAME = env('VITE_ENS_PARENT_NAME') || '';
