import { describe, expect, it } from 'vitest';
import { isAddress } from 'viem';
import { identityMatches, normalizeAgentLabel, resolutionStatus, textResource, ZERO_ADDRESS } from '@/ens/validation';
import { toArkivEnsReference } from '@/services/arkivEns';

describe('ENSv2 identity validation and persistence boundaries', () => {
  it('normalizes role names into valid ENS labels', () => expect(normalizeAgentLabel('  Research Agent! ')).toBe('research-agent'));
  it('rejects empty labels', () => expect(() => normalizeAgentLabel('---')).toThrow('valid ENS label'));
  it('caps labels at the ENS integration limit', () => expect(normalizeAgentLabel('a'.repeat(60))).toHaveLength(40));
  it('produces deterministic text resources for EAC', () => expect(textResource('description')).toBe(textResource('description')));
  it('uses a non-zero EAC resource for text keys', () => expect(textResource('description')).not.toBe(0n));
  it('recognizes the zero address sentinel', () => expect(isAddress(ZERO_ADDRESS)).toBe(true));
  it('marks a resolved identity active', () => expect(resolutionStatus('0x0000000000000000000000000000000000000001')).toBe('active'));
  it('marks a missing identity unresolved', () => expect(resolutionStatus(null)).toBe('unresolved'));
  it('verifies resolved address ownership case-insensitively', () => {
    expect(identityMatches({ walletAddress: '0x0000000000000000000000000000000000000001' }, '0x0000000000000000000000000000000000000001')).toBe(true);
  });
  it('rejects a resolved address that differs from the identity reference', () => {
    expect(identityMatches({ walletAddress: '0x0000000000000000000000000000000000000001' }, '0x0000000000000000000000000000000000000002')).toBe(false);
  });
  it('persists only application-level ENS references for Arkiv', () => {
    const ref = toArkivEnsReference({
      agentId: 'agent-1', ensName: 'research.example.eth', parentName: 'example.eth',
      walletAddress: '0x0000000000000000000000000000000000000001',
      resolverAddress: '0x0000000000000000000000000000000000000002',
      registryAddress: '0x0000000000000000000000000000000000000003',
      transactionHash: ('0x' + '1'.repeat(64)) as `0x${string}`, chainId: 11155111, createdAt: '2026-01-01T00:00:00.000Z',
      identityStatus: 'active', description: 'x', role: 'researcher', capabilities: 'search',
      endpoint: '', version: '1.0.0',
    });
    expect(ref).toEqual(expect.objectContaining({ agentId: 'agent-1', ensName: 'research.example.eth', chainId: 11155111 }));
    expect(ref).not.toHaveProperty('description');
  });
});
