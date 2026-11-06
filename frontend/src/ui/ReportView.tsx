import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAccount, useWalletClient } from 'wagmi';
import { useStore } from '@/state/store';
import { Icon, I } from './Icons';
import { fmtEffort } from '@/state/events';
import { jsPDF } from 'jspdf';
import { generateProjectFiles, downloadProjectZip, downloadMarkdownReport, downloadSingleFile } from '@/services/projectBundle';
import { uploadContextWorkflow, retrieveContextWorkflow } from '@/services/storageWorkflow';
import { RABDI_EXPLORER_URL, RABDI_FAUCET_URL, fetchTglmBalance, formatArkivError } from '@/services/arkiv/balance';
import { rabdiChain, switchOrAddRabdiNetwork, ensureRabdiWalletClient } from '@/config/chain';
import { CheckpointSummaryView } from './CheckpointSummaryView';
import { generateCheckpointSummary, formatCheckpointSummaryMarkdown, type CheckpointSummary } from '@/services/checkpointSummary';

function Md({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((l, i) => {
        if (l.startsWith('## ')) return <h2 key={i} className="font-heading font-bold text-lg mt-4">{l.slice(3)}</h2>;
        if (l.startsWith('# ')) return <h1 key={i} className="font-heading font-bold text-2xl mt-2">{l.slice(2)}</h1>;
        if (l.startsWith('- ')) return <li key={i} className="text-sm font-body ml-5 list-disc">{inline(l.slice(2))}</li>;
        if (l.startsWith('> ')) return <blockquote key={i} className="text-sm font-body border-l-2 pl-3 text-ink/70" style={{ borderColor: 'var(--accent)' }}>{inline(l.slice(2))}</blockquote>;
        if (l.trim() === '') return <div key={i} className="h-1" />;
        return <p key={i} className="text-sm font-body leading-relaxed">{inline(l)}</p>;
      })}
    </div>
  );
}

function inline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    if (p.startsWith('`')) return <code key={i} className="font-mono text-xs bg-ink/8 rounded px-1">{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

export function ReportView() {
  const { address: wagmiAddress, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();

  // Active address from wagmi or direct window.ethereum
  const activeAddress = useMemo(() => {
    if (wagmiAddress) return wagmiAddress;
    if (typeof window !== 'undefined' && (window as any).ethereum?.selectedAddress) {
      return (window as any).ethereum.selectedAddress as string;
    }
    return null;
  }, [wagmiAddress]);

  const isWrongNetwork = Boolean(
    activeAddress && chainId !== undefined && chainId !== rabdiChain.id
  );

  const [tglmBalance, setTglmBalance] = useState<string | null>(null);
  const [switchingNetwork, setSwitchingNetwork] = useState(false);

  const open = useStore((s) => s.reportOpen);
  const report = useStore((s) => s.report);
  const checkpointSummaryFromStore = useStore((s) => s.checkpointSummary);
  const goal = useStore((s) => s.goal) || 'Build a real-time crypto price tracker in React with the name of project as "CRYPTracker"';
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const edges = useStore((s) => s.edges);
  const notes = useStore((s) => s.notes);
  const runEvents = useStore((s) => s.runEvents);
  const metrics = useStore((s) => s.metrics);
  const executionState = useStore((s) => s.executionState);
  const executionError = useStore((s) => s.executionError);
  const contextStages = useStore((s) => s.contextStages);
  const fileEdits = useStore((s) => s.fileEdits);
  const checkpoint = useStore((s) => s.checkpoint);
  const simClock = useStore((s) => s.simClock);
  const realElapsed = useStore((s) => s.realElapsed);
  const effortLogical = useStore((s) => s.effortLogical);
  const modelId = useStore((s) => s.modelId);
  const triage = useStore((s) => s.triage);
  const paused = useStore((s) => s.paused);

  const [activeTab, setActiveTab] = useState<'report' | 'files' | 'checkpoint' | 'storage'>('report');
  const [selectedFile, setSelectedFile] = useState<string>('src/App.tsx');
  const [copied, setCopied] = useState(false);
  const [building, setBuilding] = useState(0);
  const [zipping, setZipping] = useState(false);

  // Checkpoint Summary local states
  const [manualSummary, setManualSummary] = useState<CheckpointSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [jsonCopied, setJsonCopied] = useState(false);

  // Decentralized Swarm + Arkiv Storage State
  const [uploadingStorage, setUploadingStorage] = useState(false);
  const [storageResult, setStorageResult] = useState<any | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [verifyingSwarm, setVerifyingSwarm] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (activeAddress && open) {
      fetchTglmBalance(activeAddress as any)
        .then((b) => setTglmBalance(b.formatted))
        .catch(() => setTglmBalance('0.000'));
    } else {
      setTglmBalance(null);
    }
  }, [activeAddress, open, activeTab]);

  const dirMatch = report?.report_markdown?.match(/\*\*Output Directory:\*\*\s*`([^`]+)`/);
  const localOutputDir = dirMatch
    ? dirMatch[1]
    : (report?.sources?.[0]?.url
      ? report.sources[0].url.replace(/^file:\/\/\/?/, '').replace(/\/[^/]+$/, '').replace(/\//g, '\\')
      : 'D:\\AUTONEX\\output\\ProjectOutput');
  const projectName = localOutputDir.split(/[\\/]/).filter(Boolean).pop() || 'ProjectOutput';

  const [realFiles, setRealFiles] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!open || !localOutputDir) return;
    fetch(`http://localhost:8000/api/deliverables?dir=${encodeURIComponent(localOutputDir)}`)
      .then(r => r.json())
      .then(d => {
        if (d.files && Object.keys(d.files).length > 0) {
          setRealFiles(d.files);
          setSelectedFile(Object.keys(d.files)[0]);
        }
      })
      .catch(() => {});
  }, [open, localOutputDir]);

  const fallbackFiles = useMemo(() => generateProjectFiles(goal), [goal]);
  const files = realFiles || fallbackFiles;
  const fileKeys = useMemo(() => Object.keys(files), [files]);

  // Derived real-time Checkpoint Summary
  const activeSummary = useMemo<CheckpointSummary | null>(() => {
    if (manualSummary) return manualSummary;
    if (checkpointSummaryFromStore) return checkpointSummaryFromStore;
    try {
      return generateCheckpointSummary(
        {
          goal,
          tasks,
          edges,
          agents,
          notes,
          runEvents,
          metrics,
          executionState,
          executionError,
          contextStages,
          fileEdits,
          checkpoint,
          report,
          simClock,
          realElapsed,
          effortLogical,
          modelId,
          triage,
          paused,
        },
        files,
        localOutputDir
      );
    } catch (err: any) {
      console.error('Failed to generate checkpoint summary:', err);
      return null;
    }
  }, [
    manualSummary,
    checkpointSummaryFromStore,
    goal,
    tasks,
    edges,
    agents,
    notes,
    runEvents,
    metrics,
    executionState,
    executionError,
    contextStages,
    fileEdits,
    checkpoint,
    report,
    simClock,
    realElapsed,
    effortLogical,
    modelId,
    triage,
    paused,
    files,
    localOutputDir,
  ]);

  if (!open) return null;
  // If no report and no tasks/events at all, do not open empty modal
  if (!report && !activeSummary && Object.keys(tasks).length === 0) return null;

  const handleRefreshSummary = () => {
    setSummaryLoading(true);
    setSummaryError(null);
    setTimeout(() => {
      try {
        const fresh = generateCheckpointSummary(
          useStore.getState(),
          files,
          localOutputDir
        );
        if (!fresh) {
          setSummaryError('Cannot generate checkpoint summary: No active or past agent execution data found.');
        } else {
          setManualSummary(fresh);
          useStore.setState({ checkpointSummary: fresh });
        }
      } catch (err: any) {
        setSummaryError(err?.message || 'Failed to refresh checkpoint summary');
      } finally {
        setSummaryLoading(false);
      }
    }, 250);
  };

  const handleCopyJson = () => {
    if (!activeSummary) return;
    navigator.clipboard.writeText(JSON.stringify(activeSummary, null, 2));
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    setZipping(true);
    try {
      await downloadProjectZip(goal, files);
    } finally {
      setZipping(false);
    }
  };

  const handleDownloadMarkdown = () => {
    let md = report?.report_markdown || '';
    if (activeSummary) {
      const summaryMd = formatCheckpointSummaryMarkdown(activeSummary);
      if (md) {
        md = `${md}\n\n---\n\n${summaryMd}`;
      } else {
        md = summaryMd;
      }
    }
    downloadMarkdownReport(goal, md);
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(localOutputDir);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStoreOnSwarmAndArkiv = async () => {
    setUploadingStorage(true);
    setStorageError(null);
    try {
      // Ensure we have an active, Rabdi-configured wallet client
      const client = await ensureRabdiWalletClient(walletClient);
      const signer = client.account?.address || activeAddress;
      if (!signer) {
        throw new Error('Please connect your Web3 wallet first.');
      }

      // Package strictly the AI-generated summary/checkpoint context (no raw codebase file dumps)
      const summary = activeSummary || generateCheckpointSummary(useStore.getState(), files, localOutputDir);
      const summaryMarkdown = summary ? formatCheckpointSummaryMarkdown(summary) : (report?.report_markdown || 'Autonomous Run Summary');

      const payload = JSON.stringify(
        {
          type: 'autonex_summary_checkpoint_context',
          version: '1.0.0',
          goal,
          timestamp: new Date().toISOString(),
          checkpointSummary: summary,
          summaryMarkdown,
          fileInventory: fileKeys, // Only list of file paths/names, no code contents
          metadata: {
            projectId: projectName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            projectName,
            signer,
            modelId: useStore.getState().modelId,
          },
        },
        null,
        2
      );

      const res = await uploadContextWorkflow(client, payload, {
        projectId: projectName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        userId: signer,
        fileName: `${projectName.toLowerCase()}-summary-context.json`,
        contentType: 'application/json',
        summary: `AI Summary & Context Checkpoint for ${goal.slice(0, 50)}...`,
      });

      setStorageResult(res);
      fetchTglmBalance(signer as any).then((b) => setTglmBalance(b.formatted)).catch(() => {});
    } catch (err: any) {
      setStorageError(formatArkivError(err));
    } finally {
      setUploadingStorage(false);
    }
  };

  const handleVerifySwarmIntegrity = async () => {
    if (!storageResult?.reportId) return;
    setVerifyingSwarm(true);
    setVerifyStatus(null);
    try {
      const check = await retrieveContextWorkflow(storageResult.reportId, storageResult.entityKey);
      if (check.verified) {
        setVerifyStatus('✓ Cryptographic SHA-256 Verified! Swarm content matches on-chain Arkiv record bit-for-bit.');
      } else {
        setVerifyStatus('⚠ Warning: Hash mismatch detected between Swarm and Arkiv.');
      }
    } catch (err: any) {
      setVerifyStatus(`Verification failed: ${err.message}`);
    } finally {
      setVerifyingSwarm(false);
    }
  };

  const exportPdf = async () => {
    setBuilding(1);
    await wait(350); setBuilding(2);
    await wait(350); setBuilding(3);
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    let y = 60;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor('#E4572E');
    doc.text('AUTONEX - Final Synthesis Report', 40, y); y += 26;
    doc.setTextColor('#2B2B2E'); doc.setFontSize(10); doc.setFont('helvetica', 'normal');

    const effLog = report?.effort_logical_s ?? effortLogical;
    const effReal = report?.effort_real_s ?? realElapsed;
    doc.text(`Organizational effort ${fmtEffort(effLog)} vs real time ${(effReal / 60).toFixed(1)} min`, 40, y); y += 24;

    if (report?.report_markdown) {
      for (const line of report.report_markdown.split('\n')) {
        if (!line.trim()) { y += 8; continue; }
        const h = line.startsWith('## '), h1 = line.startsWith('# ');
        doc.setFont('helvetica', h || h1 ? 'bold' : 'normal');
        doc.setFontSize(h1 ? 15 : h ? 12 : 10);
        const text = line.replace(/^#+ /, '').replace(/^> /, '').replace(/\*\*/g, '').replace(/`/g, '');
        const wrapped = doc.splitTextToSize(text, W - 80) as string[];
        doc.text(wrapped, 40, y);
        y += wrapped.length * (h1 ? 20 : h ? 17 : 13) + 3;
        if (y > 760) { doc.addPage(); y = 60; }
      }
    }

    if (report?.sources?.length) {
      y += 14; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Sources', 40, y); y += 16;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      for (const s of report.sources) {
        doc.text(`${s.verified ? '[verified]' : '[unverified]'} ${s.title} - ${s.url}`, 40, y, { maxWidth: W - 80 });
        y += 22;
      }
    }
    if (y > 640) { doc.addPage(); y = 60; }
    y += 10; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Org chart', 40, y); y += 16;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    for (const a of Object.values(agents)) {
      doc.text(`${'  '.repeat(a.role === 'manager' ? 0 : a.role === 'lead' ? 1 : 2)}- ${a.name} (${a.role}${a.department ? ', ' + a.department : ''}) - ${a.done ?? 0} tasks done`, 40, y);
      y += 13;
      if (y > 760) { doc.addPage(); y = 60; }
    }
    y += 10; doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Task timeline', 40, y); y += 16;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    for (const t of Object.values(tasks)) {
      doc.text(`${t.id}  ${t.status.padEnd(8)} ${t.description}`, 40, y, { maxWidth: W - 80 });
      y += 13;
      if (y > 760) { doc.addPage(); y = 60; }
    }

    // Include Checkpoint Summary in PDF
    if (activeSummary) {
      if (y > 600) { doc.addPage(); y = 60; }
      y += 14; doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor('#E4572E');
      doc.text('Checkpoint Summary', 40, y); y += 18;
      doc.setFontSize(9); doc.setTextColor('#2B2B2E'); doc.setFont('helvetica', 'normal');
      doc.text(`Status: ${activeSummary.metadata.status} | Progress: ${activeSummary.projectOverview.progressPct}% | Updated: ${activeSummary.metadata.createdAtFormatted}`, 40, y); y += 14;
      doc.text(`Completed Tasks: ${activeSummary.projectOverview.tasksDone}/${activeSummary.projectOverview.tasksTotal} (${activeSummary.projectOverview.tasksPending} queued, ${activeSummary.projectOverview.tasksRunning} active)`, 40, y); y += 14;
      if (activeSummary.pendingTasksAndNextSteps.recommendedNextActions.length > 0) {
        doc.setFont('helvetica', 'bold'); doc.text('Recommended Next Steps:', 40, y); y += 14;
        doc.setFont('helvetica', 'normal');
        for (const action of activeSummary.pendingTasksAndNextSteps.recommendedNextActions.slice(0, 4)) {
          const wrapped = doc.splitTextToSize(`• ${action}`, W - 80) as string[];
          doc.text(wrapped, 40, y);
          y += wrapped.length * 12 + 2;
          if (y > 760) { doc.addPage(); y = 60; }
        }
      }
    }

    doc.save(`${projectName}-report.pdf`);
    await wait(300);
    setBuilding(0);
  };

  const statusLabel = activeSummary?.metadata.status.toUpperCase() || (report ? 'COMPLETE' : 'IN PROGRESS');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="absolute inset-0 z-40 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => e.target === e.currentTarget && useStore.setState({ reportOpen: false })}>
      <motion.div initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        className="w-[880px] max-h-[88vh] rounded-2xl bg-paper shadow-2xl border border-ink/10 overflow-hidden flex flex-col">

        {/* Modal Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-ink/10 blueprint-grid">
          <div className="w-2.5 h-8 rounded-full" style={{ background: 'var(--accent)' }} />
          <div className="flex-1">
            <h2 className="font-heading font-bold text-lg flex items-center gap-2">
              Deliverables & Final Report
              <span className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${
                statusLabel === 'COMPLETE' || statusLabel === 'COMPLETED'
                  ? 'bg-emerald-500/15 text-emerald-700'
                  : statusLabel === 'INTERRUPTED'
                  ? 'bg-amber-500/15 text-amber-700'
                  : 'bg-blue-500/15 text-blue-700'
              }`}>
                {statusLabel}
              </span>
            </h2>
            <p className="text-xs font-mono text-ink/50">
              Organizational effort {fmtEffort(report?.effort_logical_s ?? effortLogical)} vs real time {(((report?.effort_real_s ?? realElapsed)) / 60).toFixed(1)} min
            </p>
          </div>

          {/* Action Download Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadZip}
              disabled={zipping}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-white text-xs font-heading shadow-md transition-all hover:opacity-95"
              style={{ background: '#2563EB' }}
              title="Download full project source code as .ZIP"
            >
              <Icon d={I.download} size={13} />
              {zipping ? 'Zipping...' : 'Download Code (.ZIP)'}
            </button>

            <button
              onClick={handleDownloadMarkdown}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-ink/80 text-xs font-heading bg-ink/5 hover:bg-ink/10 transition-colors"
              title="Download report with Checkpoint Summary as Markdown (.md)"
            >
              <Icon d={I.download} size={13} />
              Report (.md)
            </button>

            <button
              onClick={exportPdf}
              disabled={building > 0}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-white text-xs font-heading shadow-md transition-all"
              style={{ background: 'var(--accent)' }}
            >
              <Icon d={I.download} size={13} />
              {building === 0 ? 'Export PDF' : `Exporting ${building}/3`}
            </button>

            <button onClick={() => useStore.setState({ reportOpen: false })} className="p-1 text-ink/40 hover:text-ink">
              <Icon d={I.x} size={16} />
            </button>
          </div>
        </div>

        {/* Local Disk Location Banner */}
        <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-ink/80 font-mono">
            <span className="font-semibold text-amber-700">Output Folder:</span>
            <span className="bg-paper px-2 py-0.5 rounded border border-ink/10">{localOutputDir}</span>
          </div>
          <button
            onClick={handleCopyPath}
            className="text-[11px] font-heading font-medium text-amber-800 hover:text-amber-950 underline decoration-dotted"
          >
            {copied ? 'Path Copied!' : 'Copy Local Path'}
          </button>
        </div>

        {/* Tab Selector: 4 Tabs in exact required order */}
        <div className="flex items-center gap-4 px-6 pt-3 border-b border-ink/10 text-xs font-heading font-medium">
          {/* Tab 1: Executive Synthesis Report */}
          <button
            onClick={() => setActiveTab('report')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'report' ? 'border-[var(--accent)] text-ink font-bold' : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            <Icon d={I.check} size={13} />
            Executive Synthesis Report
          </button>

          {/* Tab 2: Project Deliverables & Source Code ({fileKeys.length} files) */}
          <button
            onClick={() => setActiveTab('files')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'files' ? 'border-[var(--accent)] text-ink font-bold' : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            <Icon d={I.layers} size={13} />
            Project Deliverables & Source Code ({fileKeys.length} files)
          </button>

          {/* Tab 3: Checkpoint Summary */}
          <button
            onClick={() => setActiveTab('checkpoint')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'checkpoint' ? 'border-[var(--accent)] text-ink font-bold' : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            <Icon d={I.chart} size={13} />
            Checkpoint Summary
          </button>

          {/* Tab 4: Decentralized Storage (Swarm + Arkiv) */}
          <button
            onClick={() => setActiveTab('storage')}
            className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'storage' ? 'border-[var(--accent)] text-ink font-bold' : 'border-transparent text-ink/50 hover:text-ink'
            }`}
          >
            <Icon d={I.database} size={13} />
            Decentralized Storage (Swarm + Arkiv)
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto px-8 py-5">
          {activeTab === 'checkpoint' ? (
            <CheckpointSummaryView
              summary={activeSummary}
              loading={summaryLoading}
              error={summaryError}
              onRefresh={handleRefreshSummary}
              onCopyJson={handleCopyJson}
              jsonCopied={jsonCopied}
            />
          ) : activeTab === 'storage' ? (
            <div className="space-y-5 max-w-2xl py-2">
              <div className="space-y-1">
                <h3 className="font-heading font-bold text-base text-ink">
                  Decentralized Context & Checkpoint Storage
                </h3>
                <p className="text-xs font-body text-ink/70 leading-relaxed">
                  Store the structured AI checkpoint summary and execution context on <strong>Ethereum Swarm</strong> content-addressed storage while anchoring ownership, timestamps, and cryptographic SHA-256 integrity hashes on the <strong>Arkiv Rabdi DB-Chain</strong>. Codebase files remain on local disk; only the AI synthesis and file inventory manifest are stored on-chain / on Swarm.
                </p>
              </div>

              {storageResult ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-heading font-bold text-emerald-800">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Successfully Anchored to Ethereum Swarm & Arkiv Rabdi DB-Chain!</span>
                    </div>
                    <p className="text-[11px] font-mono text-emerald-700">
                      File payload was content-addressed and pinned to Swarm. Authoritative pointer record registered on Arkiv.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-lg bg-ink/3 border border-ink/10 space-y-1">
                      <span className="text-[10px] text-ink/40 uppercase">Swarm BZZ Reference</span>
                      <div className="font-bold text-ink truncate" title={storageResult.swarmReference}>
                        {storageResult.swarmReference}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-ink/3 border border-ink/10 space-y-1">
                      <span className="text-[10px] text-ink/40 uppercase">SHA-256 Hash</span>
                      <div className="font-bold text-ink truncate" title={storageResult.contentHash}>
                        {storageResult.contentHash}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-ink/3 border border-ink/10 space-y-1">
                      <span className="text-[10px] text-ink/40 uppercase">Arkiv Entity Key</span>
                      <a
                        href={`${RABDI_EXPLORER_URL}/entity/${storageResult.entityKey}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-emerald-700 hover:underline truncate block"
                        title={storageResult.entityKey}
                      >
                        {storageResult.entityKey.slice(0, 16)}... ↗
                      </a>
                    </div>
                    <div className="p-3 rounded-lg bg-ink/3 border border-ink/10 space-y-1">
                      <span className="text-[10px] text-ink/40 uppercase">Rabdi Transaction Hash</span>
                      <a
                        href={`${RABDI_EXPLORER_URL}/tx/${storageResult.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-emerald-700 hover:underline truncate block"
                        title={storageResult.txHash}
                      >
                        {storageResult.txHash.slice(0, 16)}... ↗
                      </a>
                    </div>
                  </div>

                  {verifyStatus && (
                    <div className={`p-3 rounded-lg text-xs font-mono ${
                      verifyStatus.startsWith('✓') ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}>
                      {verifyStatus}
                    </div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={handleVerifySwarmIntegrity}
                      disabled={verifyingSwarm}
                      className="px-4 py-2 rounded-xl text-xs font-heading font-semibold text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ background: 'var(--accent)' }}
                    >
                      {verifyingSwarm ? 'Fetching from Swarm...' : '✓ Verify Swarm Integrity'}
                    </button>
                    <button
                      onClick={() => {
                        useStore.setState({
                          arkivHistoryOpen: true,
                          reportOpen: false,
                          arkivActiveTab: 'swarm_context',
                        });
                      }}
                      className="px-4 py-2 rounded-xl text-xs font-heading bg-ink/5 hover:bg-ink/10 text-ink/80 transition-colors"
                    >
                      Open in Arkiv Ledger ↗
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-ink/3 border border-ink/10 space-y-2 text-xs font-mono text-ink/75">
                    <div className="flex justify-between">
                      <span className="text-ink/40">Target Project:</span>
                      <span className="font-semibold">{projectName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Payload Content:</span>
                      <span className="font-semibold text-emerald-700">AI Checkpoint & Context Summary (JSON + MD)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Milestones Recorded:</span>
                      <span className="font-semibold">{activeSummary?.projectOverview.tasksDone ?? 0}/{activeSummary?.projectOverview.tasksTotal ?? 0} tasks completed</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Codebase Files:</span>
                      <span className="font-semibold text-ink/60">Local Only ({fileKeys.length} files cataloged, zero code uploaded)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Target Network:</span>
                      <span className="font-semibold text-emerald-700">Arkiv Rabdi DB-Chain (7794095) + Ethereum Swarm</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-ink/40">Signer Wallet:</span>
                      {activeAddress ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold font-mono text-ink/90">
                            {activeAddress.slice(0, 6)}...{activeAddress.slice(-4)}
                          </span>
                          <a
                            href={`${RABDI_EXPLORER_URL}/address/${activeAddress}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-blue-600 hover:underline"
                            title="View on Rabdi Explorer"
                          >
                            ↗
                          </a>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              setStorageError(null);
                              await ensureRabdiWalletClient(walletClient);
                            } catch (e: any) {
                              setStorageError(formatArkivError(e));
                            }
                          }}
                          className="px-2 py-0.5 rounded text-[11px] font-heading font-semibold bg-[var(--accent)] text-white hover:opacity-90 cursor-pointer"
                        >
                          Connect Wallet
                        </button>
                      )}
                    </div>
                    {activeAddress && (
                      <div className="flex justify-between items-center">
                        <span className="text-ink/40">tGLM Balance:</span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-semibold ${
                              tglmBalance === '0.000' || tglmBalance === '0.0000'
                                ? 'text-amber-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {tglmBalance !== null ? `${tglmBalance} tGLM` : 'Checking...'}
                          </span>
                          <a
                            href={RABDI_FAUCET_URL}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] underline text-blue-600 font-sans hover:text-blue-800"
                            title="Claim free testnet tGLM from Arkiv Hub"
                          >
                            Faucet ↗
                          </a>
                        </div>
                      </div>
                    )}
                  </div>

                  {isWrongNetwork && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs font-mono flex items-center justify-between">
                      <div>
                        <span className="font-bold">Wrong Network:</span> Currently on Chain ID {chainId || 'unknown'}.
                        <div className="text-[10px] opacity-80">Arkiv requires Rabdi DB-Chain (Chain ID {rabdiChain.id}).</div>
                      </div>
                      <button
                        type="button"
                        disabled={switchingNetwork}
                        onClick={async () => {
                          setSwitchingNetwork(true);
                          try {
                            setStorageError(null);
                            await switchOrAddRabdiNetwork();
                          } catch (e: any) {
                            setStorageError(formatArkivError(e));
                          } finally {
                            setSwitchingNetwork(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-amber-600 text-white font-semibold text-xs hover:bg-amber-700 shrink-0 cursor-pointer"
                      >
                        {switchingNetwork ? 'Switching...' : 'Switch to Rabdi'}
                      </button>
                    </div>
                  )}

                  {storageError && (
                    <div className="p-3 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-xs font-mono">
                      {storageError}
                    </div>
                  )}

                  <button
                    onClick={handleStoreOnSwarmAndArkiv}
                    disabled={uploadingStorage}
                    className="w-full py-3 px-4 rounded-xl text-xs font-heading font-bold text-white shadow-md transition-all hover:opacity-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'var(--accent)' }}
                  >
                    {uploadingStorage ? (
                      <>
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span>Uploading to Swarm & Signing with Wallet on Arkiv...</span>
                      </>
                    ) : (
                      <>
                        <Icon d={I.database} size={14} />
                        <span>Store Context Summary on Swarm & Anchor to Arkiv</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : activeTab === 'report' ? (
            report ? (
              <div>
                <Md text={report.report_markdown} />
                {report.sources.length > 0 && (
                  <>
                    <h3 className="font-heading font-bold text-base mt-6 mb-2">Sources & References</h3>
                    <div className="space-y-1.5">
                      {report.sources.map((s) => (
                        <div key={s.url} className="flex items-center gap-2 text-sm font-body">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${s.verified ? 'bg-[#2f9e6e]/15 text-[#20714f]' : 'bg-ink/8 text-ink/50'}`}>
                            {s.verified ? 'verified' : 'unverified'}
                          </span>
                          <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-dotted text-ink/80">{s.title}</a>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="p-8 text-center space-y-3">
                <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 text-amber-700 mb-1">
                  <Icon d={I.chart} size={24} />
                </div>
                <h3 className="font-heading font-bold text-base text-ink">
                  Synthesis Report Pending / Interrupted
                </h3>
                <p className="text-xs font-body text-ink/70 max-w-md mx-auto leading-relaxed">
                  The final executive synthesis report is generated upon full project completion. Because execution is currently {activeSummary?.metadata.status.toLowerCase() || 'in progress'}, view the <strong>Checkpoint Summary</strong> tab to inspect completed and pending work.
                </p>
                <button
                  onClick={() => setActiveTab('checkpoint')}
                  className="px-4 py-2 rounded-xl text-xs font-heading font-semibold text-white shadow-xs hover:opacity-90 transition-opacity cursor-pointer"
                  style={{ background: 'var(--accent)' }}
                >
                  View Checkpoint Summary →
                </button>
              </div>
            )
          ) : (
            /* Deliverables / Source Code Tab */
            <div className="grid grid-cols-12 gap-4 h-[440px]">
              {/* File list sidebar */}
              <div className="col-span-4 border border-ink/10 rounded-xl bg-ink/2 p-2 overflow-y-auto space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-ink/40 px-2 py-1">Generated Files</div>
                {fileKeys.map((fk) => (
                  <button
                    key={fk}
                    onClick={() => setSelectedFile(fk)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors truncate flex items-center gap-2 ${
                      selectedFile === fk ? 'bg-[var(--accent)] text-white font-bold' : 'text-ink/75 hover:bg-ink/5'
                    }`}
                  >
                    <span>{fk.endsWith('.tsx') || fk.endsWith('.ts') ? 'TS' : fk.endsWith('.json') ? '{}' : 'MD'}</span>
                    <span className="truncate">{fk}</span>
                  </button>
                ))}
              </div>

              {/* Code viewer pane */}
              <div className="col-span-8 border border-ink/10 rounded-xl bg-ink/5 flex flex-col overflow-hidden">
                <div className="px-3 py-2 border-b border-ink/10 flex items-center justify-between bg-ink/3">
                  <span className="font-mono text-xs text-ink/70 font-semibold">{selectedFile}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(files[selectedFile] || '');
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      className="text-[11px] font-mono px-2 py-0.5 rounded bg-paper border border-ink/10 hover:bg-ink/5 text-ink/70"
                    >
                      {copied ? 'Copied!' : 'Copy Code'}
                    </button>
                    <button
                      onClick={() => downloadSingleFile(selectedFile.split('/').pop() || 'file.txt', files[selectedFile] || '')}
                      className="text-[11px] font-mono px-2 py-0.5 rounded bg-paper border border-ink/10 hover:bg-ink/5 text-ink/70 flex items-center gap-1"
                    >
                      <Icon d={I.download} size={11} />
                      Save
                    </button>
                  </div>
                </div>
                <pre className="flex-1 p-4 overflow-auto font-mono text-xs leading-relaxed text-ink/90 bg-[#FAF7F2] select-text">
                  <code>{files[selectedFile] || '// Select a file to view code'}</code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
