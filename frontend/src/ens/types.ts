import type { Address, Hash } from 'viem';

export type IdentityStatus = 'active' | 'pending' | 'inactive' | 'unresolved' | 'failed';

export interface EnsAgentIdentity {
  agentId: string;
  ensName: string;
  parentName: string;
  walletAddress: Address;
  resolverAddress: Address;
  registryAddress: Address;
  transactionHash: Hash;
  chainId: number;
  createdAt: string;
  identityStatus: IdentityStatus;
  description: string;
  role: string;
  capabilities: string;
  endpoint: string;
  version: string;
}

export interface EnsParentNamespace {
  name: string;
  registryAddress: Address;
  labelHash: Hash;
  owner: Address;
  subregistryAddress: Address;
  verified: boolean;
}

export interface EnsIdentityDraft {
  agentId: string;
  agentName: string;
  role: string;
  description: string;
  capabilities: string;
  endpoint: string;
  version: string;
  walletAddress?: Address;
}
