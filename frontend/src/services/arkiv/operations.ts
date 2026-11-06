import { ExpirationTime, addr, u64, dec } from '@arkiv-network/sdk';
import { and, eq } from '@arkiv-network/sdk/query';
import { getAddress, type Hex, type WalletClient } from 'viem';
import { arkivPublicClient, getArkivWalletClient } from './client';
import { assertSufficientTglm, fetchTglmBalance } from './balance';
import {
  RunSchema,
  DeliverableSchema,
  SwarmRoundSchema,
  AuditLogSchema,
  UserSchema,
  ProjectSchema,
  ContextRefSchema,
} from './schemas';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface CreateRunInput {
  runId: string;
  taskClass: string;
  mode: 'office' | 'swarm';
  goalSummary: string;
  dag?: { nodes: any[]; edges: any[] };
}

export interface CreateDeliverableInput {
  runId: string;
  projectSlug: string;
  files: Record<string, string>;
  reportMd: string;
  l2TestsPass: boolean;
  l3Score?: string | number;
}

export interface CreateSwarmRoundInput {
  runId: string;
  round: number;
  swarmSize: number;
  agreementPct: number;
  moderator: string;
  clustersCount: number;
  ballotsCount: number;
  vetoTriggered: boolean;
  consensusData: any;
}

export interface CreateAuditLogInput {
  runId: string;
  action: 'file.read' | 'file.write' | 'shell.exec';
  decision: 'once' | 'always' | 'reject';
  agentId: string;
  resource: string;
  diffPreview?: string;
}

export interface RegisterUserInput {
  userId: string;
  displayName: string;
}

export interface CreateProjectInput {
  projectId: string;
  userId: string;
  name: string;
  description?: string;
}

export interface SaveContextRefInput {
  reportId: string;
  projectId: string;
  userId: string;
  storageProvider?: string;
  swarmRef: string;
  contentHash: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  summary?: string;
}

/**
 * 1. Create a Run Entity on Arkiv Rabdi DB-Chain
 * Signed by the user's connected wallet and paid in tGLM.
 */
export async function createArkivRun(walletClient: WalletClient, input: CreateRunInput) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const goalClean = input.goalSummary.slice(0, 120);

  const values: any = {
    run_id: input.runId,
    owner: addr(userAddress),
    task_class: input.taskClass.slice(0, 30),
    mode: input.mode,
    status: 'IN_PROGRESS',
    created_at: u64(now),
    goal_summary: goalClean,
  };

  if (input.dag) {
    const jsonStr = JSON.stringify(input.dag);
    values.dag_json = encoder.encode(jsonStr);
  }

  const result = await arkivWallet.createEntity(RunSchema, values, {
    expiration: ExpirationTime.fromDays(90),
  });

  return {
    entityKey: result.entityKey as Hex,
    txHash: result.txHash as Hex,
    expiresAt: result.expiresAt,
  };
}

/**
 * 2. Update Run Status on Arkiv (IN_PROGRESS -> SUCCESS / HALTED)
 */
export async function updateArkivRunStatus(
  walletClient: WalletClient,
  entityKey: Hex,
  status: 'SUCCESS' | 'HALTED',
  durationS?: number,
  totalTokens?: number
) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const setPayload: any = { status };

  if (durationS !== undefined) {
    setPayload.duration_s = u64(BigInt(Math.max(0, Math.round(durationS))));
  }
  if (totalTokens !== undefined) {
    setPayload.total_tokens = u64(BigInt(Math.max(0, Math.round(totalTokens))));
  }

  const result = await arkivWallet.patchEntity(RunSchema, entityKey, {
    set: setPayload,
  });

  return { txHash: result.txHash as Hex };
}

/**
 * 3. Publish Project Deliverable and Automated Test Proofs to Arkiv
 * Replaces local disk lock-in with verifiable on-chain storage.
 */
export async function createArkivDeliverable(
  walletClient: WalletClient,
  input: CreateDeliverableInput
) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);

  // Bundle files into JSON UTF-8 bytes
  const bundleString = JSON.stringify(input.files);
  let bundleBytes = encoder.encode(bundleString);

  // Enforce Arkiv 128 KiB entity payload constraint
  if (bundleBytes.length > 120_000) {
    const trimmed: Record<string, string> = {};
    let currentBytes = 0;
    for (const [f, content] of Object.entries(input.files)) {
      if (currentBytes + content.length > 100_000) break;
      trimmed[f] = content;
      currentBytes += content.length;
    }
    trimmed['__TRUNCATION_NOTE__.txt'] = 'Large project partially trimmed to adhere to 128 KiB Arkiv block limit.';
    bundleBytes = encoder.encode(JSON.stringify(trimmed));
  }

  const reportBytes = encoder.encode(input.reportMd || '# Execution Deliverables');
  const totalLines = Object.values(input.files).reduce((acc, c) => acc + c.split('\n').length, 0);

  const values = {
    run_id: input.runId,
    owner: addr(userAddress),
    project_slug: input.projectSlug.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60),
    l2_tests_pass: input.l2TestsPass,
    l3_score: dec(String(input.l3Score ?? '100.00')),
    file_count: u64(BigInt(Object.keys(input.files).length)),
    total_lines: u64(BigInt(totalLines)),
    bundle_bytes: bundleBytes,
    report_md: reportBytes,
  };

  const result = await arkivWallet.createEntity(DeliverableSchema, values, {
    expiration: ExpirationTime.fromDays(90),
  });

  return {
    entityKey: result.entityKey as Hex,
    txHash: result.txHash as Hex,
    expiresAt: result.expiresAt,
  };
}

/**
 * 4. Publish Swarm Deliberation Consensus Proof
 */
export async function createArkivSwarmRound(
  walletClient: WalletClient,
  input: CreateSwarmRoundInput
) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const consensusBytes = encoder.encode(JSON.stringify(input.consensusData));

  const values = {
    run_id: input.runId,
    round: u64(BigInt(input.round)),
    swarm_size: u64(BigInt(input.swarmSize)),
    agreement: dec(input.agreementPct.toFixed(2)),
    moderator: input.moderator.slice(0, 30),
    clusters_cnt: u64(BigInt(input.clustersCount)),
    ballots_cnt: u64(BigInt(input.ballotsCount)),
    veto_triggered: input.vetoTriggered,
    consensus_json: consensusBytes,
  };

  const result = await arkivWallet.createEntity(SwarmRoundSchema, values, {
    expiration: ExpirationTime.fromDays(30),
  });

  return {
    entityKey: result.entityKey as Hex,
    txHash: result.txHash as Hex,
    expiresAt: result.expiresAt,
  };
}

/**
 * 5. Record Operator Security Authorization (Audit Log)
 */
export async function createArkivAuditLog(
  walletClient: WalletClient,
  input: CreateAuditLogInput
) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const values: any = {
    run_id: input.runId,
    operator: addr(userAddress),
    action: input.action,
    decision: input.decision,
    agent_id: input.agentId.slice(0, 30),
    timestamp: u64(BigInt(Math.floor(Date.now() / 1000))),
    resource: input.resource.slice(0, 120),
  };

  if (input.diffPreview) {
    values.diff_preview = encoder.encode(input.diffPreview.slice(0, 8000));
  }

  const result = await arkivWallet.createEntity(AuditLogSchema, values, {
    expiration: ExpirationTime.fromDays(90),
  });

  return {
    entityKey: result.entityKey as Hex,
    txHash: result.txHash as Hex,
  };
}

/**
 * 6. Extend Entity Lifetime on Arkiv
 */
export async function extendArkivEntity(
  walletClient: WalletClient,
  entityKey: Hex,
  days = 90
) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const result = await arkivWallet.extendEntity({
    entityKey,
    expiration: ExpirationTime.fromDays(days),
  });

  return { txHash: result.txHash as Hex };
}

/**
 * 7. Delete Entity from Arkiv
 */
export async function deleteArkivEntity(walletClient: WalletClient, entityKey: Hex) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const result = await arkivWallet.deleteEntity({ entityKey });
  return { txHash: result.txHash as Hex };
}

/**
 * 8. Register User Identity on Arkiv
 */
export async function registerArkivUser(walletClient: WalletClient, input: RegisterUserInput) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const now = BigInt(Math.floor(Date.now() / 1000));

  const values: any = {
    user_id: input.userId.slice(0, 64),
    wallet: addr(userAddress),
    display_name: input.displayName.slice(0, 100),
    created_at: u64(now),
  };

  const result = await arkivWallet.createEntity(UserSchema, values, {
    expiration: ExpirationTime.fromDays(90),
  });

  return {
    entityKey: result.entityKey as Hex,
    txHash: result.txHash as Hex,
  };
}

/**
 * 9. Create Project Record on Arkiv
 */
export async function createArkivProject(walletClient: WalletClient, input: CreateProjectInput) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);
  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const now = BigInt(Math.floor(Date.now() / 1000));

  const values: any = {
    project_id: input.projectId.slice(0, 64),
    user_id: input.userId.slice(0, 64),
    owner: addr(userAddress),
    name: input.name.slice(0, 100),
    status: 'ACTIVE',
    created_at: u64(now),
  };

  if (input.description) {
    values.description = input.description.slice(0, 120);
  }

  const result = await arkivWallet.createEntity(ProjectSchema, values, {
    expiration: ExpirationTime.fromDays(90),
  });

  return {
    entityKey: result.entityKey as Hex,
    txHash: result.txHash as Hex,
  };
}

/**
 * 10. Save Context Reference on Arkiv (Pointer to Swarm Content Address)
 */
export async function saveArkivContextRef(walletClient: WalletClient, input: SaveContextRefInput) {
  if (!walletClient.account) throw new Error('Wallet not connected.');
  const userAddress = getAddress(walletClient.account.address);

  // Verify wallet is on Rabdi DB-Chain before creating entities.
  // Also guard against walletClient.chain being undefined (wagmi not yet resolved),
  // in which case the actual chain is unknown and we must treat it as a mismatch.
  if (!walletClient.chain || walletClient.chain.id !== 7794095) {
    const actualId = walletClient.chain?.id ?? 'unknown';
    throw new Error(
      `Chain ID mismatch: Wallet is connected to Chain ID ${actualId}. ` +
      `Rabdi DB-Chain (Chain ID 7794095) is required to anchor checkpoints on Arkiv.`
    );
  }

  await assertSufficientTglm(userAddress);

  const arkivWallet = getArkivWalletClient(walletClient);
  const now = BigInt(Math.floor(Date.now() / 1000));

  const values: any = {
    report_id: input.reportId.slice(0, 64),
    project_id: input.projectId.slice(0, 64),
    user_id: input.userId.slice(0, 64),
    owner: addr(userAddress),
    storage_provider: (input.storageProvider || 'swarm').slice(0, 32),
    swarm_ref: input.swarmRef.slice(0, 128),
    content_hash: input.contentHash.slice(0, 128),
    file_name: input.fileName.slice(0, 100),
    content_type: input.contentType.slice(0, 64),
    file_size: u64(BigInt(input.fileSize)),
    created_at: u64(now),
  };

  if (input.summary) {
    values.summary = input.summary.slice(0, 120);
  }

  try {
    const result = await arkivWallet.createEntity(ContextRefSchema, values, {
      expiration: ExpirationTime.fromDays(90),
    });

    return {
      entityKey: result.entityKey as Hex,
      txHash: result.txHash as Hex,
    };
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    const msg = (err?.shortMessage || err?.message || String(err)).toLowerCase();

    if (code === 4100 || msg.includes('4100') || msg.includes('unauthorized')) {
      throw new Error(
        `MetaMask RPC Error 4100: Unauthorized account or method. The active signer (${userAddress}) ` +
        `has not been authorized by MetaMask. Please approve account access via eth_requestAccounts.`
      );
    }

    if (
      msg.includes('without revert data') ||
      msg.includes('execution reverted') ||
      msg.includes('contractfunctionexecutionerror')
    ) {
      let balanceInfo = '';
      try {
        const bal = await fetchTglmBalance(userAddress);
        if (bal.value < 100_000_000_000_000n) {
          balanceInfo = ` Current balance is ${bal.formatted} tGLM.`;
        }
      } catch {}

      throw new Error(
        `Arkiv Rabdi DB-Chain transaction reverted during execution.${balanceInfo} ` +
        `Please ensure your wallet (${userAddress}) is connected to Rabdi DB-Chain (Chain ID 7794095) with sufficient tGLM for storage and gas fees. ` +
        `Free testnet tGLM can be claimed at https://hub.arkiv.network/.`
      );
    }

    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC READ QUERIES (Zero gas, no wallet required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely extracts an attribute from an Arkiv entity.
 * Handles both the SDK's $attributes map structure and raw flat properties.
 */
function getAttr(e: any, name: string): any {
  if (!e) return undefined;
  if (e.$attributes && e.$attributes[name] !== undefined) {
    const val = e.$attributes[name];
    return val && val.value !== undefined ? val.value : val;
  }
  return e[name];
}

/**
 * Query public runs across the network (no wallet connection required)
 */
export async function queryPublicRuns(limit = 25) {
  try {
    const filter = eq('arkiv.schema', 'autonex.run');
    const res = await arkivPublicClient.query(filter as any, { limit });
    return (res.entities || []).map((e: any) => ({
      key: (e.$key || e.key) as Hex,
      owner: (getAttr(e, 'owner') || e.$owner || e.owner || '') as string,
      runId: String(getAttr(e, 'run_id') ?? e.run_id ?? (e.$key || e.key || '').slice(0, 16)),
      taskClass: String(getAttr(e, 'task_class') ?? e.task_class ?? 'Simulation Run'),
      mode: String(getAttr(e, 'mode') ?? e.mode ?? 'office'),
      status: String(getAttr(e, 'status') ?? e.status ?? 'COMMITTED'),
      createdAt: Number(getAttr(e, 'created_at') ?? e.created_at ?? e.$createdAt ?? 0) * 1000,
      goalSummary: String(getAttr(e, 'goal_summary') ?? e.goal_summary ?? 'Multi-agent simulation run'),
      durationS: Number(getAttr(e, 'duration_s') ?? e.duration_s ?? 0),
      totalTokens: Number(getAttr(e, 'total_tokens') ?? e.total_tokens ?? 0),
    }));
  } catch (err) {
    console.warn('[Arkiv] queryPublicRuns failed:', err);
    return [];
  }
}

/**
 * Fetch any entity directly by its 32-byte hex key
 */
export async function getEntityByKey(entityKey: Hex) {
  try {
    const entity = await arkivPublicClient.getEntity(entityKey);
    return entity;
  } catch (err) {
    console.warn('[Arkiv] getEntityByKey failed:', err);
    return null;
  }
}

/**
 * Retrieve deliverable code files and test results by direct entity key
 */
export async function getDeliverableByKey(entityKey: Hex) {
  try {
    const e: any = await arkivPublicClient.getEntity(entityKey, DeliverableSchema);
    if (!e) return null;
    const rawBundle = getAttr(e, 'bundle_bytes') || e.bundle_bytes;
    let files: Record<string, string> = {};
    if (rawBundle) {
      try {
        files = JSON.parse(typeof rawBundle === 'string' ? rawBundle : decoder.decode(rawBundle as any));
      } catch {}
    }
    const rawReport = getAttr(e, 'report_md') || e.report_md;
    const reportMd = rawReport ? (typeof rawReport === 'string' ? rawReport : decoder.decode(rawReport as any)) : '';

    return {
      key: (e.$key || e.key) as Hex,
      runId: String(getAttr(e, 'run_id') ?? e.run_id ?? ''),
      projectSlug: String(getAttr(e, 'project_slug') ?? e.project_slug ?? ''),
      l2TestsPass: Boolean(getAttr(e, 'l2_tests_pass') ?? e.l2_tests_pass),
      l3Score: String(getAttr(e, 'l3_score') ?? e.l3_score ?? '100'),
      fileCount: Number(getAttr(e, 'file_count') ?? e.file_count ?? Object.keys(files).length),
      totalLines: Number(getAttr(e, 'total_lines') ?? e.total_lines ?? 0),
      files,
      reportMd,
    };
  } catch (err) {
    console.warn('[Arkiv] getDeliverableByKey failed:', err);
    return null;
  }
}

/**
 * Query user runs by owner address
 */
export async function queryUserRuns(ownerAddress: string, limit = 25) {
  try {
    const checked = getAddress(ownerAddress);
    const filter = and(
      eq('arkiv.schema', 'autonex.run'),
      eq('owner', checked)
    );
    const res = await arkivPublicClient.query(filter as any, { limit });
    return (res.entities || []).map((e: any) => ({
      key: (e.$key || e.key) as Hex,
      owner: (getAttr(e, 'owner') || e.$owner || e.owner || checked) as string,
      runId: String(getAttr(e, 'run_id') ?? e.run_id ?? (e.$key || e.key || '').slice(0, 16)),
      taskClass: String(getAttr(e, 'task_class') ?? e.task_class ?? 'Simulation Run'),
      mode: String(getAttr(e, 'mode') ?? e.mode ?? 'office'),
      status: String(getAttr(e, 'status') ?? e.status ?? 'COMMITTED'),
      createdAt: Number(getAttr(e, 'created_at') ?? e.created_at ?? e.$createdAt ?? 0) * 1000,
      goalSummary: String(getAttr(e, 'goal_summary') ?? e.goal_summary ?? 'User project run'),
      durationS: Number(getAttr(e, 'duration_s') ?? e.duration_s ?? 0),
      totalTokens: Number(getAttr(e, 'total_tokens') ?? e.total_tokens ?? 0),
    }));
  } catch (err) {
    console.warn('[Arkiv] queryUserRuns failed:', err);
    return [];
  }
}

/**
 * Retrieve deliverable code files and test results by run_id
 */
export async function getDeliverableByRunId(runId: string) {
  try {
    const filter = and(
      eq('arkiv.schema', 'autonex.deliverable'),
      eq('run_id', runId)
    );
    const res = await arkivPublicClient.query(filter as any, { limit: 1 });
    if (!res.entities || res.entities.length === 0) return null;

    const e: any = res.entities[0];
    const rawBundle = getAttr(e, 'bundle_bytes') || e.bundle_bytes;
    let files: Record<string, string> = {};
    if (rawBundle) {
      try {
        files = JSON.parse(typeof rawBundle === 'string' ? rawBundle : decoder.decode(rawBundle));
      } catch {}
    }
    const rawReport = getAttr(e, 'report_md') || e.report_md;
    const reportMd = rawReport ? (typeof rawReport === 'string' ? rawReport : decoder.decode(rawReport)) : '';

    return {
      key: (e.$key || e.key) as Hex,
      runId: String(getAttr(e, 'run_id') ?? e.run_id ?? ''),
      projectSlug: String(getAttr(e, 'project_slug') ?? e.project_slug ?? ''),
      l2TestsPass: Boolean(getAttr(e, 'l2_tests_pass') ?? e.l2_tests_pass),
      l3Score: String(getAttr(e, 'l3_score') ?? e.l3_score ?? '100'),
      fileCount: Number(getAttr(e, 'file_count') ?? e.file_count ?? Object.keys(files).length),
      totalLines: Number(getAttr(e, 'total_lines') ?? e.total_lines ?? 0),
      files,
      reportMd,
    };
  } catch (err) {
    console.warn('[Arkiv] getDeliverableByRunId failed:', err);
    return null;
  }
}

/**
 * Retrieve swarm deliberation consensus proof by run_id
 */
export async function getSwarmRoundByRunId(runId: string, round = 1) {
  try {
    const filter = and(
      eq('arkiv.schema', 'autonex.swarm_round'),
      eq('run_id', runId),
      eq('round', BigInt(round))
    );
    const res = await arkivPublicClient.query(filter as any, { limit: 1 });
    if (!res.entities || res.entities.length === 0) return null;

    const e: any = res.entities[0];
    const rawConsensus = getAttr(e, 'consensus_json') || e.consensus_json;
    let consensusData: any = {};
    if (rawConsensus) {
      try {
        consensusData = JSON.parse(typeof rawConsensus === 'string' ? rawConsensus : decoder.decode(rawConsensus));
      } catch {}
    }

    return {
      key: (e.$key || e.key) as Hex,
      runId: String(getAttr(e, 'run_id') ?? e.run_id ?? ''),
      round: Number(getAttr(e, 'round') ?? e.round ?? 1),
      swarmSize: Number(getAttr(e, 'swarm_size') ?? e.swarm_size ?? 20),
      agreement: String(getAttr(e, 'agreement') ?? e.agreement ?? '0'),
      moderator: String(getAttr(e, 'moderator') ?? e.moderator ?? 'Diya'),
      clustersCount: Number(getAttr(e, 'clusters_cnt') ?? e.clusters_cnt ?? 0),
      ballotsCount: Number(getAttr(e, 'ballots_cnt') ?? e.ballots_cnt ?? 0),
      vetoTriggered: Boolean(getAttr(e, 'veto_triggered') ?? e.veto_triggered),
      consensusData,
    };
  } catch (err) {
    console.warn('[Arkiv] getSwarmRoundByRunId failed:', err);
    return null;
  }
}

/**
 * Retrieve immutable human permission audits for a run
 */
export async function getAuditLogsByRunId(runId: string) {
  try {
    const filter = and(
      eq('arkiv.schema', 'autonex.audit_log'),
      eq('run_id', runId)
    );
    const res = await arkivPublicClient.query(filter as any, { limit: 50 });
    return (res.entities || []).map((e: any) => ({
      key: (e.$key || e.key) as Hex,
      action: String(getAttr(e, 'action') ?? e.action ?? ''),
      decision: String(getAttr(e, 'decision') ?? e.decision ?? ''),
      agentId: String(getAttr(e, 'agent_id') ?? e.agent_id ?? ''),
      timestamp: Number(getAttr(e, 'timestamp') ?? e.timestamp ?? e.$createdAt ?? 0) * 1000,
      resource: String(getAttr(e, 'resource') ?? e.resource ?? ''),
      diffPreview: getAttr(e, 'diff_preview') ? decoder.decode(getAttr(e, 'diff_preview')) : undefined,
    }));
  } catch (err) {
    console.warn('[Arkiv] getAuditLogsByRunId failed:', err);
    return [];
  }
}

/**
 * Query 1: User Lookup by Wallet Address
 */
export async function getArkivUserByWallet(walletAddress: string) {
  try {
    const checked = getAddress(walletAddress);
    const filter = and(
      eq('arkiv.schema', 'autonex.user'),
      eq('wallet', checked)
    );
    const res = await arkivPublicClient.query(filter as any, { limit: 1 });
    if (!res.entities || res.entities.length === 0) return null;
    const e: any = res.entities[0];
    return {
      key: (e.$key || e.key) as Hex,
      userId: String(getAttr(e, 'user_id') ?? e.user_id ?? ''),
      wallet: String(getAttr(e, 'wallet') ?? e.wallet ?? checked),
      displayName: String(getAttr(e, 'display_name') ?? e.display_name ?? ''),
      createdAt: Number(getAttr(e, 'created_at') ?? e.created_at ?? e.$createdAt ?? 0) * 1000,
    };
  } catch (err) {
    console.warn('[Arkiv] getArkivUserByWallet failed:', err);
    return null;
  }
}

/**
 * Query 2: Projects Lookup by User ID
 */
export async function getArkivProjectsByUser(userId: string) {
  try {
    const filter = and(
      eq('arkiv.schema', 'autonex.project'),
      eq('user_id', userId)
    );
    const res = await arkivPublicClient.query(filter as any, { limit: 50 });
    return (res.entities || []).map((e: any) => ({
      key: (e.$key || e.key) as Hex,
      projectId: String(getAttr(e, 'project_id') ?? e.project_id ?? ''),
      userId: String(getAttr(e, 'user_id') ?? e.user_id ?? ''),
      owner: String(getAttr(e, 'owner') ?? e.$owner ?? e.owner ?? ''),
      name: String(getAttr(e, 'name') ?? e.name ?? ''),
      status: String(getAttr(e, 'status') ?? e.status ?? 'ACTIVE'),
      createdAt: Number(getAttr(e, 'created_at') ?? e.created_at ?? e.$createdAt ?? 0) * 1000,
      description: getAttr(e, 'description') ? String(getAttr(e, 'description')) : undefined,
    }));
  } catch (err) {
    console.warn('[Arkiv] getArkivProjectsByUser failed:', err);
    return [];
  }
}

/**
 * Query 3: Context / Report Reference Lookup by Project ID
 */
export async function getArkivContextRefsByProject(projectId: string, limit = 25) {
  try {
    const filter = and(
      eq('arkiv.schema', 'autonex.context_ref'),
      eq('project_id', projectId)
    );
    const res = await arkivPublicClient.query(filter as any, { limit });
    return (res.entities || []).map((e: any) => ({
      key: (e.$key || e.key) as Hex,
      reportId: String(getAttr(e, 'report_id') ?? e.report_id ?? ''),
      projectId: String(getAttr(e, 'project_id') ?? e.project_id ?? ''),
      userId: String(getAttr(e, 'user_id') ?? e.user_id ?? ''),
      owner: String(getAttr(e, 'owner') ?? e.$owner ?? e.owner ?? ''),
      storageProvider: String(getAttr(e, 'storage_provider') ?? e.storage_provider ?? 'swarm'),
      swarmRef: String(getAttr(e, 'swarm_ref') ?? e.swarm_ref ?? ''),
      contentHash: String(getAttr(e, 'content_hash') ?? e.content_hash ?? ''),
      fileName: String(getAttr(e, 'file_name') ?? e.file_name ?? ''),
      contentType: String(getAttr(e, 'content_type') ?? e.content_type ?? 'application/json'),
      fileSize: Number(getAttr(e, 'file_size') ?? e.file_size ?? 0),
      createdAt: Number(getAttr(e, 'created_at') ?? e.created_at ?? e.$createdAt ?? 0) * 1000,
      summary: getAttr(e, 'summary') ? String(getAttr(e, 'summary')) : undefined,
    }));
  } catch (err) {
    console.warn('[Arkiv] getArkivContextRefsByProject failed:', err);
    return [];
  }
}

/**
 * Query 4: Latest Context Reference for a Project
 */
export async function getLatestArkivContextRef(projectId: string) {
  const refs = await getArkivContextRefsByProject(projectId, 10);
  if (!refs || refs.length === 0) return null;
  // Sort descending by creation timestamp to ensure latest
  refs.sort((a, b) => b.createdAt - a.createdAt);
  return refs[0];
}

/**
 * Retrieve Single Context Reference by Report ID (with optional direct entityKey fallback)
 */
export async function getArkivContextRefByReportId(reportId: string, entityKey?: Hex) {
  try {
    // 1. Direct getEntity by key if provided (zero indexer lag)
    if (entityKey) {
      try {
        const direct: any = await arkivPublicClient.getEntity(entityKey);
        if (direct) {
          return {
            key: entityKey,
            reportId: String(getAttr(direct, 'report_id') ?? reportId),
            projectId: String(getAttr(direct, 'project_id') ?? ''),
            userId: String(getAttr(direct, 'user_id') ?? ''),
            owner: String(getAttr(direct, 'owner') ?? direct.$owner ?? ''),
            storageProvider: String(getAttr(direct, 'storage_provider') ?? 'swarm'),
            swarmRef: String(getAttr(direct, 'swarm_ref') ?? ''),
            contentHash: String(getAttr(direct, 'content_hash') ?? ''),
            fileName: String(getAttr(direct, 'file_name') ?? ''),
            contentType: String(getAttr(direct, 'content_type') ?? 'application/json'),
            fileSize: Number(getAttr(direct, 'file_size') ?? 0),
            createdAt: Number(getAttr(direct, 'created_at') ?? direct.$createdAt ?? 0) * 1000,
            summary: getAttr(direct, 'summary') ? String(getAttr(direct, 'summary')) : undefined,
          };
        }
      } catch {}
    }

    const filter = and(
      eq('arkiv.schema', 'autonex.context_ref'),
      eq('report_id', reportId)
    );
    
    // Attempt with retry to accommodate indexer propagation time
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await arkivPublicClient.query(filter as any, { limit: 1 });
      if (res.entities && res.entities.length > 0) {
        const e: any = res.entities[0];
        return {
          key: (e.$key || e.key) as Hex,
          reportId: String(getAttr(e, 'report_id') ?? e.report_id ?? ''),
          projectId: String(getAttr(e, 'project_id') ?? e.project_id ?? ''),
          userId: String(getAttr(e, 'user_id') ?? e.user_id ?? ''),
          owner: String(getAttr(e, 'owner') ?? e.$owner ?? e.owner ?? ''),
          storageProvider: String(getAttr(e, 'storage_provider') ?? e.storage_provider ?? 'swarm'),
          swarmRef: String(getAttr(e, 'swarm_ref') ?? e.swarm_ref ?? ''),
          contentHash: String(getAttr(e, 'content_hash') ?? e.content_hash ?? ''),
          fileName: String(getAttr(e, 'file_name') ?? e.file_name ?? ''),
          contentType: String(getAttr(e, 'content_type') ?? e.content_type ?? 'application/json'),
          fileSize: Number(getAttr(e, 'file_size') ?? e.file_size ?? 0),
          createdAt: Number(getAttr(e, 'created_at') ?? e.created_at ?? e.$createdAt ?? 0) * 1000,
          summary: getAttr(e, 'summary') ? String(getAttr(e, 'summary')) : undefined,
        };
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  } catch (err) {
    console.warn('[Arkiv] getArkivContextRefByReportId failed:', err);
    return null;
  }
}

/**
 * Query All Public Context References (Across all projects)
 */
export async function getAllArkivContextRefs(limit = 30) {
  try {
    const filter = eq('arkiv.schema', 'autonex.context_ref');
    const res = await arkivPublicClient.query(filter as any, { limit });
    return (res.entities || []).map((e: any) => ({
      key: (e.$key || e.key) as Hex,
      reportId: String(getAttr(e, 'report_id') ?? e.report_id ?? ''),
      projectId: String(getAttr(e, 'project_id') ?? e.project_id ?? ''),
      userId: String(getAttr(e, 'user_id') ?? e.user_id ?? ''),
      owner: String(getAttr(e, 'owner') ?? e.$owner ?? e.owner ?? ''),
      storageProvider: String(getAttr(e, 'storage_provider') ?? e.storage_provider ?? 'swarm'),
      swarmRef: String(getAttr(e, 'swarm_ref') ?? e.swarm_ref ?? ''),
      contentHash: String(getAttr(e, 'content_hash') ?? e.content_hash ?? ''),
      fileName: String(getAttr(e, 'file_name') ?? e.file_name ?? ''),
      contentType: String(getAttr(e, 'content_type') ?? e.content_type ?? 'application/json'),
      fileSize: Number(getAttr(e, 'file_size') ?? e.file_size ?? 0),
      createdAt: Number(getAttr(e, 'created_at') ?? e.created_at ?? e.$createdAt ?? 0) * 1000,
      summary: getAttr(e, 'summary') ? String(getAttr(e, 'summary')) : undefined,
    }));
  } catch (err) {
    console.warn('[Arkiv] getAllArkivContextRefs failed:', err);
    return [];
  }
}

