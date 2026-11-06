import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  uploadContextWorkflow,
  retrieveContextWorkflow,
  setupUserAndProjectWorkflow,
} from '@/services/storageWorkflow';
import { getFallbackStorage } from '@/services/swarm/client';
import * as arkivOps from '@/services/arkiv/operations';

describe('Unified Arkiv + Swarm Storage Workflow Pipeline', () => {
  beforeEach(() => {
    getFallbackStorage().clear();
    vi.restoreAllMocks();
  });

  const mockWalletClient: any = {
    account: { address: '0x1234567890123456789012345678901234567890' },
  };

  it('1. Upload Context Workflow: uploads file to Swarm and anchors metadata on Arkiv', async () => {
    // Mock saveArkivContextRef
    vi.spyOn(arkivOps, 'saveArkivContextRef').mockResolvedValueOnce({
      entityKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as any,
      txHash: '0x9876543210987654321098765432109876543210987654321098765432109876' as any,
    });

    const fileContent = JSON.stringify({
      milestone: 'Deliverable complete',
      tests: '100% pass',
      author: 'AUTONEX AI Floor',
    });

    const result = await uploadContextWorkflow(mockWalletClient, fileContent, {
      projectId: 'project-autonex-v1',
      userId: 'user-42',
      fileName: 'context.json',
      summary: 'Automated synthesis bundle',
    });

    expect(result.reportId).toBeDefined();
    expect(result.projectId).toBe('project-autonex-v1');
    expect(result.userId).toBe('user-42');
    expect(result.swarmReference).toHaveLength(64);
    expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.entityKey).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    expect(result.txHash).toBe('0x9876543210987654321098765432109876543210987654321098765432109876');

    // Verify it was stored in Swarm
    const storage = getFallbackStorage();
    expect(storage.has(result.swarmReference)).toBe(true);
  });

  it('2. Retrieve Context Workflow: fetches from Arkiv & Swarm, verifies SHA-256 integrity', async () => {
    const rawContent = '# Project Specification\n\nVerified by Arkiv DB-Chain';
    const rawBytes = new TextEncoder().encode(rawContent);
    const mockHash = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const mockSwarmRef = '1122334455667788990011223344556677889900112233445566778899001122';

    // Seed fallback storage
    getFallbackStorage().set(mockSwarmRef, {
      content: rawContent,
      contentType: 'text/markdown',
      timestamp: Date.now(),
    });

    // Mock getArkivContextRefByReportId with real SHA-256 of rawContent
    const { calculateSHA256 } = await import('@/services/swarm/operations');
    const realHash = await calculateSHA256(rawContent);

    vi.spyOn(arkivOps, 'getArkivContextRefByReportId').mockResolvedValueOnce({
      key: '0xentity123' as any,
      reportId: 'rep_123',
      projectId: 'project-autonex-v1',
      userId: 'user-42',
      owner: '0x1234567890123456789012345678901234567890',
      storageProvider: 'swarm',
      swarmRef: mockSwarmRef,
      contentHash: realHash,
      fileName: 'spec.md',
      contentType: 'text/markdown',
      fileSize: rawBytes.byteLength,
      createdAt: Date.now(),
      summary: 'Spec doc',
    });

    const retrieved = await retrieveContextWorkflow('rep_123');

    expect(retrieved.verified).toBe(true);
    expect(retrieved.content).toBe(rawContent);
    expect(retrieved.contentType).toBe('text/markdown');
    expect(retrieved.expectedHash).toBe(realHash);
    expect(retrieved.actualHash).toBe(realHash);
    expect(retrieved.metadata.reportId).toBe('rep_123');
    expect(retrieved.metadata.projectId).toBe('project-autonex-v1');
  });

  it('3. Security / Tamper Detection: flags verified: false if Swarm content was altered', async () => {
    const originalContent = 'Original sensitive payload';
    const tamperedContent = 'Original sensitive payload [MODIFIED BY ATTACKER]';
    const mockSwarmRef = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

    // Swarm holds tampered content
    getFallbackStorage().set(mockSwarmRef, {
      content: tamperedContent,
      contentType: 'text/plain',
      timestamp: Date.now(),
    });

    const { calculateSHA256 } = await import('@/services/swarm/operations');
    const originalHash = await calculateSHA256(originalContent);

    // Arkiv holds original expected hash
    vi.spyOn(arkivOps, 'getArkivContextRefByReportId').mockResolvedValueOnce({
      key: '0xentity456' as any,
      reportId: 'rep_456',
      projectId: 'project-autonex-v1',
      userId: 'user-42',
      owner: '0x1234567890123456789012345678901234567890',
      storageProvider: 'swarm',
      swarmRef: mockSwarmRef,
      contentHash: originalHash,
      fileName: 'tampered.txt',
      contentType: 'text/plain',
      fileSize: 100,
      createdAt: Date.now(),
      summary: undefined,
    });

    const result = await retrieveContextWorkflow('rep_456');

    expect(result.verified).toBe(false);
    expect(result.expectedHash).not.toBe(result.actualHash);
  });

  it('4. Setup User & Project Workflow: registers user identity and creates project on Arkiv', async () => {
    vi.spyOn(arkivOps, 'registerArkivUser').mockResolvedValueOnce({
      entityKey: '0xuserkey' as any,
      txHash: '0xusertx' as any,
    });
    vi.spyOn(arkivOps, 'createArkivProject').mockResolvedValueOnce({
      entityKey: '0xprojectkey' as any,
      txHash: '0xprojecttx' as any,
    });

    const setup = await setupUserAndProjectWorkflow(mockWalletClient, {
      userId: 'user-100',
      displayName: 'Alice Developer',
      projectId: 'proj-defi',
      projectName: 'DeFi Swarm Engine',
      projectDescription: 'Automated AMM arbitrage agent fleet',
    });

    expect(setup.userResult.entityKey).toBe('0xuserkey');
    expect(setup.projectResult.entityKey).toBe('0xprojectkey');
  });
});
