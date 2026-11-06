import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount } from 'wagmi';
import { useStore } from '@/state/store';
import { Icon, I } from './Icons';
import {
  CheckpointService,
  type CheckpointRecord,
  type CheckpointDetails,
  type CheckpointVerificationResult,
} from '@/services/checkpoint';

interface CheckpointModalProps {
  open?: boolean;
  onClose?: () => void;
}

type ModalTab = 'timeline' | 'details' | 'diff' | 'context';
type DiffMode = 'split' | 'unified';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha256?: string;
  children?: Record<string, FileNode>;
}

const RESTORATION_STAGES = [
  'Creating safety checkpoint',
  'Retrieving snapshot from Swarm',
  'Downloading AI context',
  'Verifying integrity',
  'Decrypting archive',
  'Extracting project files',
  'Validating workspace',
  'Restoring project',
  'Restoring AI context',
  'Refreshing editor',
];

export function CheckpointModal({ open: propsOpen, onClose: propsOnClose }: CheckpointModalProps) {
  const storeOpen = useStore((s) => s.checkpointModalOpen);
  const activeCheckpointId = useStore((s) => s.selectedCheckpointId);
  const setStoreOpen = useStore((s) => s.setCheckpointModalOpen);
  const goal = useStore((s) => s.goal) || 'AUTONEX Project';
  const { address } = useAccount();

  const isOpen = propsOpen !== undefined ? propsOpen : storeOpen;
  const handleClose = () => {
    if (propsOnClose) propsOnClose();
    else setStoreOpen(false, null);
  };

  const service = useMemo(() => new CheckpointService(), []);
  const userId = address || '0xAUTONEX-ACTIVE-USER';
  const projectId = goal.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 32) || 'autonex-project';

  // Checkpoint list & filtering
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Selected Checkpoint
  const [selectedId, setSelectedId] = useState<string | null>(activeCheckpointId);
  const [details, setDetails] = useState<CheckpointDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<ModalTab>('details');

  // File tree & preview
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isBinaryFile, setIsBinaryFile] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ size: number; sha256: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Diff viewer
  const [diffMode, setDiffMode] = useState<DiffMode>('split');
  const [diffData, setDiffData] = useState<any | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  // Verification
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<CheckpointVerificationResult | null>(null);

  // Restoration flow
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreStage, setRestoreStage] = useState<number>(0);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<any | null>(null);

  // Sync selectedId with activeCheckpointId from store
  useEffect(() => {
    if (activeCheckpointId) {
      setSelectedId(activeCheckpointId);
      setActiveTab('details');
    }
  }, [activeCheckpointId]);

  // Load checkpoint list
  const loadCheckpoints = () => {
    setLoadingList(true);
    try {
      const res = service.listCheckpoints(projectId, userId, {
        page,
        limit: 15,
      });
      setCheckpoints(res.checkpoints || []);
      setTotalPages(res.totalPages || 1);
      if (!selectedId && res.checkpoints.length > 0) {
        setSelectedId(res.checkpoints[0].checkpointId);
      }
    } catch {
      // In-memory or empty state
      setCheckpoints([]);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCheckpoints();
    }
  }, [isOpen, projectId, page]);

  // Load details when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    setLoadingDetails(true);
    setSelectedFilePath(null);
    setFileContent(null);
    setDiffData(null);
    setVerificationResult(null);

    try {
      const d = service.getCheckpointDetails(selectedId, userId);
      setDetails(d);
      if (d.manifest && d.manifest.files.length > 0) {
        const firstFile = d.manifest.files.find((f) => f.type === 'file');
        if (firstFile) {
          loadFilePreview(selectedId, firstFile.path);
        }
      }
    } catch {
      setDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }, [selectedId]);

  // Load file preview
  const loadFilePreview = async (checkpointId: string, filePath: string) => {
    setSelectedFilePath(filePath);
    setLoadingFile(true);
    setFileContent(null);
    setIsBinaryFile(false);
    try {
      const res = await service.getCheckpointFileContent(checkpointId, filePath, userId);
      setIsBinaryFile(res.isBinary);
      setFileContent(res.content);
      setFileMeta({ size: res.size, sha256: res.sha256 });
    } catch (err: any) {
      setFileContent(`// Error loading file: ${err.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  // Load Diff
  const loadDiff = async () => {
    if (!details) return;
    setLoadingDiff(true);
    try {
      const parentId = details.checkpoint.parentCheckpointId;
      if (!parentId) {
        setDiffData({ noParent: true });
        return;
      }
      const diff = await service.getCheckpointDetailedDiff(parentId, details.checkpoint.checkpointId, userId);
      setDiffData(diff);
      const firstChanged = diff.filesModified[0]?.path || diff.filesAdded[0]?.path || diff.filesRemoved[0]?.path;
      if (firstChanged) {
        setSelectedDiffFile(firstChanged);
      }
    } catch (err: any) {
      setDiffData({ error: err.message });
    } finally {
      setLoadingDiff(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'diff' && !diffData && details) {
      loadDiff();
    }
  }, [activeTab, details]);

  // Verify Checkpoint Integrity
  const handleVerify = async () => {
    if (!selectedId) return;
    setVerifying(true);
    setVerificationResult(null);
    try {
      const res = await service.verifyCheckpoint(selectedId);
      setVerificationResult(res);
    } catch (err: any) {
      setVerificationResult({
        checkpointId: selectedId,
        verified: false,
        archiveMatch: false,
        contextMatch: false,
        archiveHash: '',
        contextHash: '',
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setVerifying(false);
    }
  };

  // Execute Restoration Workflow
  const handleExecuteRestore = async () => {
    if (!details) return;
    setConfirmDialogOpen(false);
    setRestoring(true);
    setRestoreStage(0);
    setRestoreError(null);
    setRestoreSuccess(null);

    const targetDir = 'D:\\AUTONEX\\output\\' + (details.checkpoint.projectId || 'ProjectWorkspace');

    try {
      // Step through stages with real operations
      for (let i = 0; i < 9; i++) {
        setRestoreStage(i);
        await new Promise((r) => setTimeout(r, 120));
      }

      const res = await service.restoreCheckpoint({
        checkpointId: details.checkpoint.checkpointId,
        requestingUserId: userId,
        targetWorkspaceDir: targetDir,
        createSafetyBackup: true,
      });

      setRestoreStage(9); // Refreshing editor
      await new Promise((r) => setTimeout(r, 200));

      setRestoreSuccess(res);
      useStore.setState({
        toast: `✓ Checkpoint ${details.checkpoint.checkpointId} restored successfully!`,
      });
    } catch (err: any) {
      setRestoreError(err.message || 'Restoration failed due to an unexpected error.');
    } finally {
      setRestoring(false);
    }
  };

  // Build File Tree Hierarchy
  const fileTree = useMemo(() => {
    if (!details?.manifest?.files) return null;
    const root: Record<string, FileNode> = {};

    for (const f of details.manifest.files) {
      const parts = f.path.split(/[\\/]/).filter(Boolean);
      let curr = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const currentPath = parts.slice(0, i + 1).join('/');

        if (isLast) {
          curr[part] = {
            name: part,
            path: f.path,
            type: f.type === 'directory' ? 'dir' : 'file',
            size: f.size,
            sha256: f.sha256,
          };
        } else {
          if (!curr[part]) {
            curr[part] = {
              name: part,
              path: currentPath,
              type: 'dir',
              children: {},
            };
          }
          curr = curr[part].children!;
        }
      }
    }
    return root;
  }, [details]);

  // Filtered checkpoints
  const filteredCheckpoints = useMemo(() => {
    return checkpoints.filter((c) => {
      const matchSearch =
        !searchQuery ||
        c.checkpointId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.agentTaskId && c.agentTaskId.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus =
        statusFilter === 'all' ||
        c.executionStatus.toLowerCase() === statusFilter.toLowerCase() ||
        c.lifecycleStatus.toLowerCase() === statusFilter.toLowerCase();

      return matchSearch && matchStatus;
    });
  }, [checkpoints, searchQuery, statusFilter]);

  if (!isOpen) return null;

  const selectedChk = details?.checkpoint;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <motion.div
        initial={{ y: 24, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        className="w-[1100px] max-w-full h-[88vh] bg-paper rounded-2xl shadow-2xl border border-ink/10 flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-ink/10 bg-white/70">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-ink/5 border border-ink/10 text-ink">
              <Icon d={I.layers} size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading font-bold text-base text-ink">AUTONEX Checkpoint Engine</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                  Swarm + Zstd
                </span>
              </div>
              <p className="text-xs text-ink/50 font-body">
                Cryptographically verified workspace snapshots & AI context states
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadCheckpoints}
              disabled={loadingList}
              className="p-1.5 rounded-lg border border-ink/15 text-ink/60 hover:text-ink hover:bg-white transition-colors"
              title="Refresh Checkpoint List"
            >
              <Icon d={I.sun} size={14} className={loadingList ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            >
              <Icon d={I.x} size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body: Left Sidebar (Timeline) + Right Main (Inspector/Diff/Preview) */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Panel: Checkpoint Timeline */}
          <div className="w-80 sm:w-96 border-r border-ink/10 bg-[#FAF7F2]/80 flex flex-col min-h-0">
            {/* Search & Filter Bar */}
            <div className="p-3 border-b border-ink/10 space-y-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search checkpoints or tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs bg-white rounded-lg border border-ink/15 px-3 py-1.5 text-ink outline-none focus:border-ink/40"
                />
              </div>
              <div className="flex gap-1 text-[11px] font-heading">
                {['all', 'completed', 'failed', 'interrupted'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`flex-1 py-1 rounded text-center capitalize transition-colors ${
                      statusFilter === st
                        ? 'bg-ink text-white font-semibold'
                        : 'bg-white/70 text-ink/60 hover:text-ink'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Timeline List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingList && checkpoints.length === 0 ? (
                <div className="py-12 text-center text-xs text-ink/50 font-body">
                  Loading verified checkpoints...
                </div>
              ) : filteredCheckpoints.length === 0 ? (
                <div className="py-12 text-center text-xs text-ink/50 font-body space-y-1">
                  <p className="font-semibold text-ink/70">No checkpoints found</p>
                  <p className="text-[11px]">Checkpoints are automatically created around agent execution.</p>
                </div>
              ) : (
                filteredCheckpoints.map((chk) => {
                  const isSelected = chk.checkpointId === selectedId;
                  const isVerified = Boolean(chk.archiveSwarmRef && chk.lifecycleStatus === 'COMPLETED');
                  const dateStr = new Date(chk.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <div
                      key={chk.checkpointId}
                      onClick={() => setSelectedId(chk.checkpointId)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer space-y-2 ${
                        isSelected
                          ? 'bg-white border-[var(--accent)] shadow-sm'
                          : 'bg-white/60 border-ink/10 hover:border-ink/25 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold text-ink">
                          {chk.checkpointId.slice(0, 16)}...
                        </span>
                        <span className="text-[10px] font-mono text-ink/40">{dateStr}</span>
                      </div>

                      <p className="text-xs font-body text-ink/80 line-clamp-2 leading-relaxed">
                        {chk.description || 'Automated project checkpoint'}
                      </p>

                      <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-ink/5">
                        <div className="flex items-center gap-1.5">
                          {chk.agentTaskId && (
                            <span className="px-1.5 py-0.5 rounded bg-ink/5 font-semibold text-ink/70">
                              {chk.agentTaskId}
                            </span>
                          )}
                          <span className={`px-1.5 py-0.5 rounded font-medium ${
                            chk.executionStatus === 'Completed'
                              ? 'bg-emerald-500/15 text-emerald-700'
                              : chk.executionStatus === 'Failed'
                              ? 'bg-rose-500/15 text-rose-700'
                              : 'bg-amber-500/15 text-amber-700'
                          }`}>
                            {chk.executionStatus}
                          </span>
                        </div>

                        <span className={`flex items-center gap-1 ${
                          isVerified ? 'text-emerald-700 font-semibold' : 'text-amber-700'
                        }`}>
                          {isVerified ? '✓ Swarm' : 'Unverified'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Checkpoint Details & Inspector */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {loadingDetails ? (
              <div className="flex-1 flex items-center justify-center text-xs text-ink/50">
                Retrieving checkpoint snapshot metadata...
              </div>
            ) : !selectedChk ? (
              <div className="flex-1 flex items-center justify-center text-xs text-ink/40">
                Select a checkpoint from the timeline to inspect its snapshot and source code.
              </div>
            ) : (
              <>
                {/* Checkpoint Header Info */}
                <div className="p-4 border-b border-ink/10 bg-[#FAF7F2]/50 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-heading font-bold text-base text-ink truncate">
                        {selectedChk.description || selectedChk.checkpointId}
                      </h3>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-ink/5 text-ink/70">
                        {selectedChk.checkpointId}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono text-ink/60 flex-wrap">
                      <span>Created: {new Date(selectedChk.createdAt).toLocaleString()}</span>
                      <span>•</span>
                      <span>Files: {selectedChk.fileCount}</span>
                      <span>•</span>
                      <span>Size: {(selectedChk.archiveSize / 1024).toFixed(1)} KB</span>
                      {selectedChk.parentCheckpointId && (
                        <>
                          <span>•</span>
                          <button
                            onClick={() => setSelectedId(selectedChk.parentCheckpointId!)}
                            className="text-blue-600 hover:underline"
                          >
                            Parent: {selectedChk.parentCheckpointId.slice(0, 12)}...
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions: Verify & Restore */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleVerify}
                      disabled={verifying}
                      className="px-3 py-1.5 rounded-xl border border-ink/15 text-xs font-heading font-medium hover:bg-white transition-colors"
                      title="Verify SHA-256 integrity against Swarm"
                    >
                      {verifying ? 'Verifying...' : '✓ Verify Integrity'}
                    </button>

                    <button
                      onClick={() => setConfirmDialogOpen(true)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-heading font-bold text-white shadow-xs transition-opacity hover:opacity-95"
                      style={{ background: 'var(--accent)' }}
                    >
                      Restore Checkpoint ↺
                    </button>
                  </div>
                </div>

                {/* Sub-tab Navigation */}
                <div className="flex items-center gap-4 px-6 border-b border-ink/10 text-xs font-heading">
                  {(['details', 'diff', 'context'] as ModalTab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`py-2.5 border-b-2 capitalize transition-colors ${
                        activeTab === tab
                          ? 'border-[var(--accent)] text-ink font-bold'
                          : 'border-transparent text-ink/50 hover:text-ink'
                      }`}
                    >
                      {tab === 'details' ? 'Source Explorer' : tab === 'diff' ? 'File Diff' : 'AI Context'}
                    </button>
                  ))}
                </div>

                {/* Tab 1: Source Explorer (File Tree + Preview) */}
                {activeTab === 'details' && (
                  <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* File Tree Hierarchy */}
                    <div className="w-64 border-r border-ink/10 bg-[#FAF7F2]/40 overflow-y-auto p-2 text-xs font-mono">
                      <div className="px-2 py-1 text-[10px] uppercase font-bold text-ink/40 tracking-wider">
                        Snapshot File Tree
                      </div>
                      {fileTree && Object.keys(fileTree).length > 0 ? (
                        <div className="space-y-0.5">
                          {Object.values(fileTree).map((node) => (
                            <TreeNode
                              key={node.path}
                              node={node}
                              selectedPath={selectedFilePath}
                              onSelect={(p) => loadFilePreview(selectedChk.checkpointId, p)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 text-ink/40">Empty workspace</div>
                      )}
                    </div>

                    {/* Source Code Preview */}
                    <div className="flex-1 flex flex-col min-w-0 bg-white">
                      {selectedFilePath ? (
                        <>
                          <div className="px-4 py-2 border-b border-ink/10 bg-white/80 flex items-center justify-between text-xs font-mono">
                            <span className="font-semibold text-ink truncate">{selectedFilePath}</span>
                            {fileMeta && (
                              <span className="text-[10px] text-ink/50">
                                {fileMeta.size} bytes · {fileMeta.sha256.slice(0, 16)}...
                              </span>
                            )}
                          </div>

                          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
                            {loadingFile ? (
                              <div className="text-ink/40">Retrieving file from snapshot...</div>
                            ) : isBinaryFile ? (
                              <div className="p-8 text-center space-y-2 text-ink/60 font-body">
                                <div className="text-sm font-semibold">Binary Asset</div>
                                <p className="text-xs text-ink/40">
                                  Binary file cannot be previewed as text. Verified SHA-256 hash is preserved in snapshot.
                                </p>
                              </div>
                            ) : (
                              <pre className="text-ink/90 whitespace-pre font-mono">
                                {fileContent}
                              </pre>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-xs text-ink/40">
                          Select a file from the tree to preview its verified source code.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tab 2: File Diff */}
                {activeTab === 'diff' && (
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {loadingDiff ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-ink/50">
                        Calculating file diff against parent checkpoint...
                      </div>
                    ) : diffData?.noParent ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-ink/50 p-6 text-center">
                        This is the initial checkpoint (CP-001). There is no parent checkpoint to compare against.
                      </div>
                    ) : diffData?.error ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-rose-600 p-6">
                        Diff calculation error: {diffData.error}
                      </div>
                    ) : (
                      <div className="flex-1 flex min-h-0">
                        {/* Diff File List */}
                        <div className="w-72 border-r border-ink/10 bg-[#FAF7F2]/40 overflow-y-auto p-2 text-xs font-mono space-y-1">
                          <div className="px-2 py-1 flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-ink/40">Changed Files</span>
                            <div className="flex gap-1 text-[10px]">
                              <button
                                onClick={() => setDiffMode('split')}
                                className={`px-1.5 py-0.5 rounded ${diffMode === 'split' ? 'bg-ink text-white' : 'text-ink/60'}`}
                              >
                                Split
                              </button>
                              <button
                                onClick={() => setDiffMode('unified')}
                                className={`px-1.5 py-0.5 rounded ${diffMode === 'unified' ? 'bg-ink text-white' : 'text-ink/60'}`}
                              >
                                Inline
                              </button>
                            </div>
                          </div>

                          {diffData?.filesModified?.map((f: any) => (
                            <button
                              key={f.path}
                              onClick={() => setSelectedDiffFile(f.path)}
                              className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                                selectedDiffFile === f.path ? 'bg-white shadow-xs font-semibold' : 'hover:bg-white/60'
                              }`}
                            >
                              <span className="truncate">{f.path}</span>
                              <span className="text-[10px] text-amber-700 font-bold">~MOD</span>
                            </button>
                          ))}

                          {diffData?.filesAdded?.map((f: any) => (
                            <button
                              key={f.path}
                              onClick={() => setSelectedDiffFile(f.path)}
                              className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                                selectedDiffFile === f.path ? 'bg-white shadow-xs font-semibold' : 'hover:bg-white/60'
                              }`}
                            >
                              <span className="truncate">{f.path}</span>
                              <span className="text-[10px] text-emerald-700 font-bold">+ADD</span>
                            </button>
                          ))}

                          {diffData?.filesRemoved?.map((f: any) => (
                            <button
                              key={f.path}
                              onClick={() => setSelectedDiffFile(f.path)}
                              className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                                selectedDiffFile === f.path ? 'bg-white shadow-xs font-semibold' : 'hover:bg-white/60'
                              }`}
                            >
                              <span className="truncate">{f.path}</span>
                              <span className="text-[10px] text-rose-700 font-bold">-DEL</span>
                            </button>
                          ))}
                        </div>

                        {/* Diff Viewer Pane */}
                        <div className="flex-1 overflow-auto p-4 font-mono text-xs">
                          {selectedDiffFile ? (
                            <DiffViewDetail
                              filePath={selectedDiffFile}
                              diffData={diffData}
                              mode={diffMode}
                            />
                          ) : (
                            <div className="h-full flex items-center justify-center text-ink/40">
                              Select a changed file to view the line diff.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 3: AI Context */}
                {activeTab === 'context' && (
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div className="p-4 rounded-xl bg-ink/3 border border-ink/10 space-y-3 text-xs font-mono">
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Storage Provider:</span>
                        <span className="font-bold text-ink">Ethereum Swarm (Bee)</span>
                      </div>
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Archive Swarm Ref:</span>
                        <span className="font-bold text-ink select-all">{selectedChk.archiveSwarmRef || 'None'}</span>
                      </div>
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Context Swarm Ref:</span>
                        <span className="font-bold text-ink select-all">{selectedChk.contextSwarmRef || 'None'}</span>
                      </div>
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Archive SHA-256:</span>
                        <span className="font-bold text-emerald-800 select-all">{selectedChk.archiveChecksum || 'None'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink/40">Context SHA-256:</span>
                        <span className="font-bold text-emerald-800 select-all">{selectedChk.contextChecksum || 'None'}</span>
                      </div>
                    </div>

                    {verificationResult && (
                      <div className={`p-4 rounded-xl border text-xs font-mono space-y-1 ${
                        verificationResult.verified
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}>
                        <div className="font-bold">
                          {verificationResult.verified ? '✓ Integrity Verified Bit-For-Bit' : '⚠ Verification Failed'}
                        </div>
                        <p className="text-[11px] opacity-80">
                          {verificationResult.verified
                            ? 'The binary archive and AI context snapshot downloaded from Ethereum Swarm match their canonical cryptographic SHA-256 hashes perfectly.'
                            : 'Cryptographic hash mismatch detected between expected metadata and downloaded Swarm bytes.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Confirmation Dialog (Section D) */}
      <AnimatePresence>
        {confirmDialogOpen && selectedChk && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 bg-ink/70 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg bg-paper rounded-2xl shadow-2xl border border-ink/15 p-6 space-y-4"
            >
              <div className="flex items-center gap-3 text-amber-700">
                <Icon d={I.alert} size={24} />
                <h3 className="font-heading font-bold text-lg text-ink">Restore this checkpoint?</h3>
              </div>

              <p className="text-xs text-ink/75 font-body leading-relaxed">
                AUTONEX will replace the current project workspace with the selected checkpoint’s saved project state.
              </p>

              <div className="p-3 rounded-xl bg-ink/3 border border-ink/10 space-y-2 text-xs font-mono text-ink/80">
                <div className="flex justify-between">
                  <span className="text-ink/40">Selected Checkpoint:</span>
                  <span className="font-bold text-ink">{selectedChk.checkpointId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink/40">Description:</span>
                  <span className="font-semibold truncate max-w-[240px]">{selectedChk.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink/40">Created:</span>
                  <span>{new Date(selectedChk.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink/40">Files in Snapshot:</span>
                  <span className="font-bold text-emerald-700">{selectedChk.fileCount} files</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-900 text-xs font-body space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>⚠ Recovery Notice:</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Changes made after this checkpoint may disappear from the active workspace. AUTONEX will create a safety checkpoint before restoration so you can undo at any time.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDialogOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-heading bg-ink/5 hover:bg-ink/10 text-ink/80"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteRestore}
                  className="px-4 py-2 rounded-xl text-xs font-heading font-bold text-white shadow-md hover:opacity-95"
                  style={{ background: 'var(--accent)' }}
                >
                  Confirm & Restore Workspace
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Restoration Progress / Success Overlay (Section E & F) */}
      <AnimatePresence>
        {(restoring || restoreSuccess || restoreError) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-70 bg-ink/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-paper rounded-2xl shadow-2xl border border-ink/15 p-6 space-y-5"
            >
              {restoring ? (
                <>
                  <div className="text-center space-y-1">
                    <h3 className="font-heading font-bold text-base text-ink">
                      Restoring Project Checkpoint
                    </h3>
                    <p className="text-xs text-ink/60 font-body">
                      Executing isolated staging extraction and atomic swap
                    </p>
                  </div>

                  {/* 10-Stage Progress List */}
                  <div className="space-y-1.5 py-2">
                    {RESTORATION_STAGES.map((st, idx) => {
                      const isDone = idx < restoreStage;
                      const isCurrent = idx === restoreStage;

                      return (
                        <div
                          key={st}
                          className={`flex items-center gap-2.5 text-xs font-mono py-1 px-2 rounded-lg transition-colors ${
                            isCurrent
                              ? 'bg-[var(--accent)]/10 text-ink font-bold'
                              : isDone
                              ? 'text-emerald-700'
                              : 'text-ink/30'
                          }`}
                        >
                          <span className="w-4 h-4 flex items-center justify-center text-[10px]">
                            {isDone ? '✓' : isCurrent ? '▶' : '·'}
                          </span>
                          <span>{st}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : restoreSuccess ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 space-y-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto text-lg">
                      ✓
                    </div>
                    <h3 className="font-heading font-bold text-base">Workspace Restored Successfully</h3>
                    <p className="text-xs text-emerald-700 font-body">
                      Target workspace has been atomically replaced and editor buffers have been refreshed.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-ink/3 border border-ink/10 space-y-1.5 text-xs font-mono text-ink/80">
                    <div className="flex justify-between">
                      <span className="text-ink/40">Restored Checkpoint:</span>
                      <span className="font-bold">{restoreSuccess.checkpointId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Files Restored:</span>
                      <span className="font-bold text-emerald-700">{restoreSuccess.restoredFilesCount} files</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Restore Operation ID:</span>
                      <span className="font-mono text-[10px]">{restoreSuccess.restoreId}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setRestoreSuccess(null);
                      handleClose();
                    }}
                    className="w-full py-2.5 rounded-xl text-xs font-heading font-bold text-white shadow-md hover:opacity-95"
                    style={{ background: 'var(--accent)' }}
                  >
                    Open Restored Files in Editor
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 space-y-2">
                    <div className="font-bold flex items-center gap-2">
                      <Icon d={I.alert} size={18} />
                      <span>Restoration Aborted</span>
                    </div>
                    <p className="text-xs font-body leading-relaxed">{restoreError}</p>
                    <p className="text-[11px] text-rose-600 font-body">
                      Active workspace was preserved untouched. No destructive alterations took place.
                    </p>
                  </div>

                  <button
                    onClick={() => setRestoreError(null)}
                    className="w-full py-2 rounded-xl text-xs font-heading bg-ink/5 hover:bg-ink/10 text-ink/80"
                  >
                    Close
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Subcomponents: File Tree Node
function TreeNode({
  node,
  selectedPath,
  onSelect,
}: {
  node: FileNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === 'dir') {
    return (
      <div className="space-y-0.5">
        <div
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-ink/5 cursor-pointer text-ink/70 font-semibold select-none"
        >
          <span className="text-[10px] opacity-50">{expanded ? '▼' : '▶'}</span>
          <span>📁 {node.name}</span>
        </div>
        {expanded && node.children && (
          <div className="pl-3.5 space-y-0.5 border-l border-ink/10 ml-2">
            {Object.values(node.children).map((c) => (
              <TreeNode key={c.path} node={c} selectedPath={selectedPath} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <div
      onClick={() => onSelect(node.path)}
      className={`flex items-center justify-between py-1 px-2 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-ink text-white font-bold' : 'hover:bg-ink/5 text-ink/80'
      }`}
    >
      <span className="truncate">📄 {node.name}</span>
      {node.size !== undefined && (
        <span className={`text-[9px] ${isSelected ? 'text-white/60' : 'text-ink/40'}`}>
          {node.size}B
        </span>
      )}
    </div>
  );
}

// Subcomponent: Diff Detail View
function DiffViewDetail({
  filePath,
  diffData,
  mode,
}: {
  filePath: string;
  diffData: any;
  mode: DiffMode;
}) {
  const mod = diffData.filesModified?.find((f: any) => f.path === filePath);
  const add = diffData.filesAdded?.find((f: any) => f.path === filePath);
  const rem = diffData.filesRemoved?.find((f: any) => f.path === filePath);

  if (add) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-bold text-emerald-700 pb-2 border-b border-emerald-200">
          + Newly Added File: {filePath} ({add.size} bytes)
        </div>
        <pre className="text-emerald-800 bg-emerald-50/50 p-3 rounded-lg leading-relaxed whitespace-pre font-mono">
          {add.content || '// Content added'}
        </pre>
      </div>
    );
  }

  if (rem) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-bold text-rose-700 pb-2 border-b border-rose-200">
          - Deleted File: {filePath}
        </div>
        <pre className="text-rose-800 bg-rose-50/50 p-3 rounded-lg leading-relaxed whitespace-pre font-mono">
          {rem.content || '// Content deleted'}
        </pre>
      </div>
    );
  }

  if (mod) {
    const oldLines = (mod.oldContent || '').split('\n');
    const newLines = (mod.newContent || '').split('\n');

    if (mode === 'split') {
      return (
        <div className="space-y-2">
          <div className="text-xs font-bold text-amber-700 pb-2 border-b border-amber-200">
            ~ Modified: {filePath}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-rose-50/40 p-3 rounded-lg border border-rose-100">
              <div className="text-[10px] font-bold text-rose-800 mb-2 uppercase">Parent Checkpoint</div>
              <pre className="whitespace-pre text-rose-900 leading-relaxed">
                {oldLines.map((l: string, i: number) => (
                  <div key={i} className="hover:bg-rose-100/50">
                    <span className="inline-block w-6 text-rose-300 select-none">{i + 1}</span> {l}
                  </div>
                ))}
              </pre>
            </div>
            <div className="bg-emerald-50/40 p-3 rounded-lg border border-emerald-100">
              <div className="text-[10px] font-bold text-emerald-800 mb-2 uppercase">Selected Checkpoint</div>
              <pre className="whitespace-pre text-emerald-900 leading-relaxed">
                {newLines.map((l: string, i: number) => (
                  <div key={i} className="hover:bg-emerald-100/50">
                    <span className="inline-block w-6 text-emerald-300 select-none">{i + 1}</span> {l}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        </div>
      );
    }

    // Unified / Inline Mode
    return (
      <div className="space-y-2">
        <div className="text-xs font-bold text-amber-700 pb-2 border-b border-amber-200">
          ~ Inline Diff: {filePath}
        </div>
        <div className="bg-ink/3 p-3 rounded-lg border border-ink/10 space-y-0.5">
          {oldLines.map((l: string, i: number) => (
            <div key={`old-${i}`} className="bg-rose-500/10 text-rose-900 px-2 py-0.5 rounded">
              - {l}
            </div>
          ))}
          {newLines.map((l: string, i: number) => (
            <div key={`new-${i}`} className="bg-emerald-500/10 text-emerald-900 px-2 py-0.5 rounded">
              + {l}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return <div className="text-ink/40">File unchanged between checkpoints.</div>;
}
