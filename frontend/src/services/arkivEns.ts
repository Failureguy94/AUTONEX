import type { EnsAgentIdentity } from '@/ens/types';
import type { WalletClient } from 'viem';
import { saveArkivAgentEnsIdentity } from '@/services/arkiv/operations';

const STORAGE_KEY = 'autonex:ens-agent-references';

export interface ArkivEnsReference {
  agentId: string;
  ensName: string;
  parentName: string;
  walletAddress: string;
  resolverAddress: string;
  registryAddress: string;
  transactionHash: string;
  chainId: number;
  createdAt: string;
  identityStatus: EnsAgentIdentity['identityStatus'];
}

export function toArkivEnsReference(identity: EnsAgentIdentity): ArkivEnsReference {
  return {
    agentId: identity.agentId,
    ensName: identity.ensName,
    parentName: identity.parentName,
    walletAddress: identity.walletAddress,
    resolverAddress: identity.resolverAddress,
    registryAddress: identity.registryAddress,
    transactionHash: identity.transactionHash,
    chainId: identity.chainId,
    createdAt: identity.createdAt,
    identityStatus: identity.identityStatus,
  };
}

/**
 * Persist through a configured Arkiv writer when available. The local fallback
 * is only a reference cache and never the authoritative ENS record store.
 */
export async function persistEnsReference(identity: EnsAgentIdentity): Promise<void> {
  const reference = toArkivEnsReference(identity);
  const endpoint = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_ARKIV_ENS_ENDPOINT;
  if (endpoint) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reference),
    });
    if (!response.ok) throw new Error(`Arkiv reference persistence failed (${response.status})`);
    return;
  }

  const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, ArkivEnsReference>;
  current[identity.agentId] = reference;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export async function persistEnsReferenceToArkiv(walletClient: WalletClient, identity: EnsAgentIdentity) {
  return saveArkivAgentEnsIdentity(walletClient, {
    ...toArkivEnsReference(identity),
    createdAt: Math.floor(new Date(identity.createdAt).getTime() / 1000),
  });
}

export function loadEnsReference(agentId: string): ArkivEnsReference | null {
  const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, ArkivEnsReference>;
  return current[agentId] ?? null;
}
