import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateSHA256,
  uploadContextFile,
  getContextFile,
  verifyContentIntegrity,
} from '@/services/swarm/operations';
import { getFallbackStorage } from '@/services/swarm/client';

describe('Ethereum Swarm Content-Addressed Storage & Hashing', () => {
  beforeEach(() => {
    getFallbackStorage().clear();
  });

  it('1. Cryptographic SHA-256: computes standard sha256: hex string', async () => {
    const text = 'Hello AUTONEX on Ethereum Swarm!';
    const hash = await calculateSHA256(text);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Deterministic check
    const hash2 = await calculateSHA256(text);
    expect(hash2).toBe(hash);

    // Difference check
    const hashDiff = await calculateSHA256('Different text');
    expect(hashDiff).not.toBe(hash);
  });

  it('2. SHA-256: works with Uint8Array binary buffers', async () => {
    const bytes = new TextEncoder().encode('Binary payload content');
    const hash = await calculateSHA256(bytes);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('3. Upload Context File: generates 64-char Swarm content address & SHA-256 hash', async () => {
    const payload = JSON.stringify({
      project: 'CRYPTracker',
      summary: 'Automated consensus deliverable',
      timestamp: Date.now(),
    });

    const res = await uploadContextFile(payload, 'deliverable.json', 'application/json');

    expect(res.swarmReference).toHaveLength(64);
    expect(res.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(res.fileName).toBe('deliverable.json');
    expect(res.contentType).toBe('application/json');
    expect(res.fileSize).toBe(new TextEncoder().encode(payload).byteLength);
  });

  it('4. Get Context File: retrieves stored content from content reference', async () => {
    const sampleMd = '# AUTONEX Deliverable Report\n\n- Milestone 1: Done\n- Milestone 2: Done';
    const upload = await uploadContextFile(sampleMd, 'report.md', 'text/markdown');

    const retrieved = await getContextFile(upload.swarmReference);

    expect(retrieved.content).toBe(sampleMd);
    expect(retrieved.contentType).toBe('text/markdown');
    expect(retrieved.fileSize).toBe(new TextEncoder().encode(sampleMd).byteLength);
  });

  it('5. Verify Content Integrity: correctly validates intact and detects tampered data', async () => {
    const originalContent = 'Valid untampered report data';
    const originalHash = await calculateSHA256(originalContent);

    // Untampered match
    const isValid = await verifyContentIntegrity(originalContent, originalHash);
    expect(isValid).toBe(true);

    // Tampered mismatch
    const isTamperedValid = await verifyContentIntegrity(originalContent + ' [tampered]', originalHash);
    expect(isTamperedValid).toBe(false);
  });

  it('6. Error Handling: throws clean descriptive error when reference not found', async () => {
    const nonExistentRef = '0000000000000000000000000000000000000000000000000000000000000000';
    await expect(getContextFile(nonExistentRef)).rejects.toThrow();
  });
});

