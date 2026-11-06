import React, { useState } from 'react';
import { useStore } from '@/state/store';
import { Icon, I } from './Icons';
import { ensureRabdiWalletClient, rabdiChain } from '@/config/chain';
import { uploadContextWorkflow, retrieveContextWorkflow } from '@/services/storageWorkflow';
import { formatArkivError } from '@/services/arkiv/balance';

export function ErrorCheckpointModal() {
  const open = useStore((s) => s.errorCheckpointModalOpen);
  const data = useStore((s) => s.errorCheckpointData);
  const goal = useStore((s) => s.goal);
  const tasks = useStore((s) => s.tasks);
  const files = useStore((s) => s.fileEdits);
  const notes = useStore((s) => s.notes);
  const zgConnection = useStore((s) => s.zgConnection);
  const iai = useStore((s) => s.iai);
  const setOpen = useStore((s) => s.setErrorCheckpointModalOpen);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);

  if (!open) return null;

  const isTimeout = !!data?.isTimeout;
  const isCreditDepleted = data?.reason === 'credit_depletion' || /credit|quota|balance|402/i.test(data?.error || '');
  const dismissTimeoutPrompt = useStore((s) => s.dismissTimeoutPrompt);

  const errorText = data?.error || 'Execution halted: 0G Private Computer inference failed (Request ID: 47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5)';
  const failedAgent = data?.failedAgentName || 'Rohan (W_backend_0)';
  const recoveryAgent = data?.recoveryAgentName || 'Nisha (W_qa_0)';
  const requestId = data?.requestId || '47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5';
  const elapsedMinutes = data?.elapsedMinutes || 5;

  const taskList = Object.values(tasks);
  const tasksDone = taskList.filter((t) => t.status === 'done' || t.progress_pct === 100);
  const tasksInProgress = taskList.filter((t) => t.status === 'running' || t.status === 'ready' || t.status === 'pending');
  const tasksFailed = taskList.filter((t) => t.status === 'failed');

  const handleSaveToArkivAndSwarm = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // 1. Ensure user has an authorized Rabdi wallet client
      const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
      let walletClient = null;
      try {
        walletClient = await ensureRabdiWalletClient();
      } catch (e: any) {
        throw new Error(
          eth
            ? `Wallet switch required: ${e.message || 'Please approve switching to Rabdi DB-Chain in your wallet.'}`
            : 'No Web3 wallet detected. Please connect MetaMask or another Rabdi-compatible wallet.'
        );
      }

      const signerAddress = walletClient.account?.address || iai.walletAddress || '0x0000000000000000000000000000000000000000';
      const cleanProjectSlug = (goal.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 24) || 'autonex-checkpoint').toLowerCase();

      // 2. Prepare comprehensive checkpoint context payload - CONTEXT & PROJECT DETAILS ONLY (NO RAW CODEBASE DUMPS)
      const checkpointPayload = {
        metadata: {
          checkpointId: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          incidentType: isTimeout
            ? 'long_running_task_checkpoint'
            : isCreditDepleted
            ? 'credits_depleted_checkpoint'
            : '0g_inference_failure_recovery',
          timestamp: new Date().toISOString(),
          error: errorText,
          isTimeout,
          elapsedMinutes: isTimeout ? elapsedMinutes : undefined,
          requestId,
          failedAgent,
          recoveryAgent,
          signerAddress,
        },
        projectDetails: {
          projectName: cleanProjectSlug,
          objective: goal || 'Autonomous task execution',
          status: isTimeout ? 'In Progress' : 'Interrupted',
          tasksCompletedCount: tasksDone.length,
          tasksTotalCount: taskList.length,
          tasksSummary: taskList.map((t) => ({
            id: t.id,
            description: t.description,
            status: t.status,
            progressPct: t.progress_pct,
            assignedAgent: t.assigned_agent,
            targetFile: t.target_file,
          })),
          blackboardNotesCount: notes.length,
          recentNotes: notes.slice(-10),
          fileInventory: Object.keys(files).map((f) => ({
            fileName: f,
            revisions: (files[f] || []).length,
          })),
          zgConnection: {
            isVerified: zgConnection.isVerified,
            maskedKey: zgConnection.maskedKey,
            lastVerifiedAt: zgConnection.lastVerifiedAt,
          },
        },
        technicalContext: {
          runtime: 'AUTONEX Dual-Engine Spatial Floor',
          computeProvider: '0G Private Computer (Router: https://router-api.0g.ai/v1)',
          databaseNetwork: 'Arkiv Rabdi DB-Chain (Chain ID: 7794095)',
          storageNetwork: 'Ethereum Swarm (BZZ)',
        },
      };

      const payloadString = JSON.stringify(checkpointPayload, null, 2);

      // 3. Upload heavy context to Swarm and register pointer on Arkiv Rabdi DB-Chain
      const res = await uploadContextWorkflow(walletClient, payloadString, {
        projectId: cleanProjectSlug,
        userId: signerAddress,
        reportId: checkpointPayload.metadata.checkpointId,
        fileName: `checkpoint-${cleanProjectSlug}-context.json`,
        contentType: 'application/json',
        summary: `Recovery checkpoint for 0G Private Computer inference halt (Req: ${requestId.slice(0, 16)}...)`,
      });

      setSaveResult(res);
    } catch (err: any) {
      console.error('[ErrorCheckpointModal] Failed to save checkpoint:', err);
      setSaveError(formatArkivError(err) || err.message || 'Failed to save context to Arkiv and Swarm');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyIntegrity = async () => {
    if (!saveResult?.reportId) return;
    setVerifying(true);
    setVerifyStatus(null);
    try {
      const check = await retrieveContextWorkflow(saveResult.reportId, saveResult.entityKey);
      if (check.verified) {
        setVerifyStatus('✓ Cryptographic SHA-256 Verified! Swarm context matches on-chain Arkiv pointer bit-for-bit.');
      } else {
        setVerifyStatus('⚠ Warning: Hash mismatch detected between Swarm and Arkiv.');
      }
    } catch (err: any) {
      setVerifyStatus(`Verification failed: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const openInLedger = () => {
    useStore.setState({
      arkivHistoryOpen: true,
      arkivActiveTab: 'swarm_context',
      errorCheckpointModalOpen: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-paper rounded-2xl border border-ink/20 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          isTimeout
            ? 'bg-blue-500/10 border-blue-500/20'
            : isCreditDepleted
            ? 'bg-rose-500/10 border-rose-500/20'
            : 'bg-amber-500/10 border-amber-500/20'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shadow-xs ${
              isTimeout
                ? 'bg-blue-500/20 border-blue-500/30 text-blue-700'
                : isCreditDepleted
                ? 'bg-rose-500/20 border-rose-500/30 text-rose-700'
                : 'bg-amber-500/20 border-amber-500/30 text-amber-700'
            }`}>
              <Icon d={isTimeout ? I.coffee : I.alert} size={16} />
            </div>
            <div>
              <h2 className="text-sm font-heading font-bold text-ink">
                {isTimeout
                  ? 'Task In Progress · Taking Longer Than Expected'
                  : isCreditDepleted
                  ? 'Credits Depleted · Task Interrupted'
                  : 'Execution Halted · AI Task Incomplete'}
              </h2>
              <p className="text-[11px] font-mono text-ink/60">
                {isTimeout
                  ? `Running for ${elapsedMinutes} min · 5-minute Checkpoint Verification`
                  : isCreditDepleted
                  ? '0G Private Computer compute credits exhausted'
                  : 'Automatic Agent Failover & Checkpoint Synthesizer'}
              </p>
            </div>
          </div>
          <button
            onClick={() => isTimeout ? dismissTimeoutPrompt() : setOpen(false)}
            className="w-7 h-7 rounded-lg border border-ink/10 hover:bg-white flex items-center justify-center text-ink/60 hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-body">
          {/* Error / Timeout Details Alert */}
          <div className={`p-3.5 rounded-xl border font-mono space-y-1 ${
            isTimeout
              ? 'bg-blue-500/10 border-blue-500/20 text-blue-950'
              : isCreditDepleted
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-900'
              : 'bg-red-500/10 border-red-500/20 text-red-900'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`text-[10px] uppercase font-bold flex items-center gap-1 ${
                isTimeout ? 'text-blue-800' : isCreditDepleted ? 'text-rose-800' : 'text-red-700'
              }`}>
                <span className={`w-2 h-2 rounded-full animate-ping inline-block ${
                  isTimeout ? 'bg-blue-500' : isCreditDepleted ? 'bg-rose-500' : 'bg-red-500'
                }`} />
                {isTimeout
                  ? 'Execution Duration Alert (5 min interval)'
                  : isCreditDepleted
                  ? '0G Compute Credits Depleted'
                  : 'Inference Exception Captured'}
              </span>
              <span className={`text-[10px] font-semibold ${
                isTimeout ? 'text-blue-700' : 'text-red-600/70'
              }`}>
                {isTimeout ? 'STATUS: IN PROGRESS' : 'STATUS: INTERRUPTED'}
              </span>
            </div>
            <p className="text-xs font-semibold leading-relaxed break-words">
              {isTimeout
                ? `Your AI task has been in progress for over ${elapsedMinutes} minutes without completion. The model may be performing intensive reasoning or experiencing provider delays.`
                : isCreditDepleted
                ? `0G Private Computer compute credits or account balance have been depleted. The current task could not finish.`
                : errorText}
            </p>
            {requestId && !isTimeout && (
              <div className="text-[10px] text-red-700/80 pt-1 border-t border-red-500/15">
                <span className="font-bold">0G Request ID:</span> {requestId}
              </div>
            )}
          </div>

          {/* Autonomous Agent Switch Callout (only if not a pure timeout) */}
          {!isTimeout && (
            <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-blue-800 flex items-center gap-1.5">
                  <Icon d={I.users} size={12} />
                  Autonomous Agent Switch Engaged
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-900 font-mono">
                  Context Preserved
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-ink/80 pt-1">
                <div className="px-2.5 py-1 rounded-lg bg-white/80 border border-ink/15 text-red-700 flex items-center gap-1">
                  <span>Failed:</span>
                  <span className="font-bold">{failedAgent}</span>
                </div>
                <span className="text-blue-600 font-bold">➔</span>
                <div className="px-2.5 py-1 rounded-lg bg-white/80 border border-blue-400 text-blue-800 flex items-center gap-1 shadow-xs">
                  <span>Switched to:</span>
                  <span className="font-bold">{recoveryAgent}</span>
                </div>
              </div>
              <p className="text-[11px] text-blue-950/80 leading-normal">
                When {failedAgent} encountered an error, AUTONEX automatically handed
                control to {recoveryAgent}, who synthesized in-flight tasks, completed files, and system notes into a persistent context checkpoint.
              </p>
            </div>
          )}

          {/* Checkpoint Context Snapshot */}
          <div className="p-3.5 rounded-xl bg-white border border-ink/15 space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-ink/10 pb-2">
              <span className="text-[11px] font-heading font-bold text-ink flex items-center gap-1.5">
                <Icon d={I.database} size={12} />
                Execution Context Snapshot
              </span>
              <span className="text-[10px] font-mono text-ink/50">
                {new Date().toLocaleTimeString()}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded-lg bg-paper border border-ink/10">
                <span className="block text-[10px] text-ink/50">Tasks Completed</span>
                <span className="text-sm font-bold text-emerald-700">
                  {tasksDone.length} <span className="text-[10px] text-ink/40">/ {taskList.length}</span>
                </span>
              </div>
              <div className="p-2 rounded-lg bg-paper border border-ink/10">
                <span className="block text-[10px] text-ink/50">{isTimeout ? 'Tasks In Progress' : 'Tasks Interrupted'}</span>
                <span className={`text-sm font-bold ${isTimeout ? 'text-blue-700' : 'text-amber-700'}`}>
                  {tasksInProgress.length + tasksFailed.length}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-paper border border-ink/10">
                <span className="block text-[10px] text-ink/50">Notes & Logs</span>
                <span className="text-sm font-bold text-ink">
                  {notes.length}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-ink/70">
              <span className="font-semibold text-ink">Active Objective:</span> {goal || 'Autonomous coding sprint'}
            </div>
          </div>

          {/* Save Prompt & Storage Architecture Split */}
          {!saveResult && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h3 className="text-xs font-heading font-bold text-emerald-950">
                  {isTimeout
                    ? 'Do you want to save your progress context to Arkiv & Swarm or continue waiting?'
                    : isCreditDepleted
                    ? 'Credits depleted: Do you want to save your execution context to Arkiv & Swarm?'
                    : 'There might be an error: Do you want to save your context to Arkiv & Swarm?'}
                </h3>
              </div>
              <p className="text-[11px] text-emerald-900/80 leading-relaxed">
                AUTONEX divides decentralized persistence cleanly:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2.5 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="font-bold text-emerald-800 block mb-0.5">📦 Ethereum Swarm (BZZ)</span>
                  <span className="text-[10px] text-ink/70">
                    Stores the full project context manifest, milestone summary, and telemetry off-chain.
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="font-bold text-emerald-800 block mb-0.5">🌐 Arkiv Rabdi DB-Chain</span>
                  <span className="text-[10px] text-ink/70">
                    Anchors the immutable reference, project metadata, and cryptographic SHA-256 hash.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Save Error */}
          {saveError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-800 text-xs">
              <span className="font-bold">Save Failed:</span> {saveError}
            </div>
          )}

          {/* Save Success View */}
          {saveResult && (
            <div className="p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-heading font-bold text-emerald-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  ✓ Checkpoint Context Successfully Saved to Swarm + Arkiv!
                </span>
                <span className="text-[10px] font-mono text-emerald-800">
                  Chain ID: {rabdiChain.id}
                </span>
              </div>

              <div className="space-y-2 text-[11px] font-mono">
                <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="block text-[10px] text-ink/50 uppercase">Swarm BZZ Content Reference</span>
                  <span className="font-bold text-emerald-800 select-all break-all">
                    {saveResult.swarmReference}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="block text-[10px] text-ink/50 uppercase">Cryptographic SHA-256 Digest</span>
                  <span className="font-bold text-emerald-800 select-all break-all">
                    {saveResult.contentHash}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                    <span className="block text-[10px] text-ink/50 uppercase">Arkiv Entity Key</span>
                    <span className="font-bold text-ink select-all break-all">
                      {saveResult.entityKey?.slice(0, 16)}...{saveResult.entityKey?.slice(-8)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                    <span className="block text-[10px] text-ink/50 uppercase">Rabdi Transaction Hash</span>
                    <a
                      href={`https://rabdi.explorer.arkiv.network/tx/${saveResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-emerald-700 hover:underline select-all break-all inline-flex items-center gap-1"
                    >
                      {saveResult.txHash?.slice(0, 14)}... ↗
                    </a>
                  </div>
                </div>
              </div>

              {verifyStatus && (
                <div
                  className={`p-2.5 rounded-lg text-[11px] font-mono ${
                    verifyStatus.includes('Verified')
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  {verifyStatus}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleVerifyIntegrity}
                  disabled={verifying}
                  className="px-3 py-1.5 rounded-lg bg-white border border-emerald-500/30 text-emerald-800 text-xs font-heading font-semibold hover:bg-emerald-50 transition-colors shadow-xs"
                >
                  {verifying ? 'Verifying on Swarm...' : '✓ Verify Swarm Integrity'}
                </button>
                <button
                  type="button"
                  onClick={openInLedger}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-heading font-semibold transition-colors shadow-xs flex items-center gap-1"
                >
                  Open in Arkiv Ledger ↗
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-paper border-t border-ink/10 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (isTimeout) {
                dismissTimeoutPrompt();
              } else {
                setOpen(false);
              }
            }}
            className="px-3.5 py-2 rounded-xl border border-ink/20 hover:bg-white text-xs font-heading text-ink/70 hover:text-ink transition-colors"
          >
            {saveResult ? 'Close' : isTimeout ? 'Continue Waiting' : 'Dismiss / Keep in Memory'}
          </button>

          {!saveResult && (
            <button
              type="button"
              onClick={handleSaveToArkivAndSwarm}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-heading font-semibold shadow-md flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Uploading to Swarm & Signing on Arkiv...</span>
                </>
              ) : (
                <>
                  <Icon d={I.database} size={14} />
                  <span>Save Context to Arkiv + Swarm</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

