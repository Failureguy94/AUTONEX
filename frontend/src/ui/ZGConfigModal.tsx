import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, ZGStatus } from '@/state/store';
import { Icon, I } from './Icons';

export function ZGConfigModal() {
  const open = useStore((s) => s.zgModalOpen);
  const conn = useStore((s) => s.zgConnection);
  const setOpen = useStore((s) => s.setZGModalOpen);
  const verifyKey = useStore((s) => s.verifyZGKey);
  const disconnectZG = useStore((s) => s.disconnectZG);
  const checkStatus = useStore((s) => s.checkZGStatus);

  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      checkStatus();
      setLocalError(null);
    }
  }, [open, checkStatus]);

  if (!open) return null;

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputKey.trim()) {
      setLocalError('Please enter your 0G API Key');
      return;
    }
    setLocalError(null);
    const result = await verifyKey(inputKey.trim());
    if (result.valid) {
      setInputKey('');
    } else {
      setLocalError(result.message);
    }
  };

  const handleDisconnect = async () => {
    await disconnectZG();
    setInputKey('');
    setLocalError(null);
  };

  const getStatusBadge = (status: ZGStatus) => {
    switch (status) {
      case 'connected':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 text-xs font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold">Connected & Verified</span>
            <span className="text-emerald-600/50">·</span>
            <span className="text-[10px] text-emerald-700 font-bold uppercase">0G Router Active</span>
          </div>
        );
      case 'validating':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-800 text-xs font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
            <span className="font-semibold">Validating with 0G Router...</span>
          </div>
        );
      case 'invalid_key':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-800 text-xs font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="font-semibold">Invalid 0G API Key</span>
            <span className="text-rose-600/50">·</span>
            <span className="text-[10px] text-rose-700">Auth Failed (401)</span>
          </div>
        );
      case 'unavailable':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/25 text-orange-800 text-xs font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
            <span className="font-semibold">0G Service Unavailable</span>
            <span className="text-orange-600/50">·</span>
            <span className="text-[10px] text-orange-700">Timeout / Unreachable</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-800 text-xs font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="font-semibold">Configuration Error</span>
          </div>
        );
      case 'not_configured':
      default:
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ink/5 border border-ink/15 text-ink/70 text-xs font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-ink/30" />
            <span className="font-semibold">Not Configured</span>
            <span className="text-ink/40">·</span>
            <span className="text-[10px] text-ink/50 uppercase">Key Required</span>
          </div>
        );
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-lg rounded-2xl bg-[#FAF7F2] border border-ink/15 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-ink/10 flex items-center justify-between bg-white/60">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shadow-xs"
                style={{ background: 'var(--accent)' }}
              >
                <span className="font-heading font-black text-white text-xs">0G</span>
              </div>
              <div>
                <h2 className="font-heading font-bold text-base text-ink">0G Private Computer Configuration</h2>
                <p className="text-[11px] font-mono text-ink/50">Unified Decentralized AI Inference Layer</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            >
              <Icon d={I.x} size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            {/* Connection Status Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-white/80 border border-ink/10 shadow-xs">
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink/50">Authoritative Status</span>
                <div>{getStatusBadge(conn.status)}</div>
              </div>

              {conn.isVerified && conn.maskedKey && (
                <div className="text-right font-mono text-xs text-ink/70">
                  <span className="text-[10px] text-ink/40 uppercase block">Active Key</span>
                  <span className="font-bold text-emerald-700 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {conn.maskedKey}
                  </span>
                </div>
              )}
            </div>

            {/* Error Display */}
            {(localError || conn.error) && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 text-xs font-body flex items-start gap-2"
              >
                <span className="font-bold shrink-0 mt-0.5">⚠️</span>
                <span>{localError || conn.error}</span>
              </motion.div>
            )}

            {/* If Already Connected: Key Management View */}
            {conn.isVerified ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-2.5 text-xs font-body">
                  <div className="flex justify-between items-center text-ink/70">
                    <span className="text-ink/50">Router Base URL:</span>
                    <span className="font-mono font-medium text-ink">https://router-api.0g.ai/v1</span>
                  </div>
                  {conn.requestId && (
                    <div className="flex justify-between items-center text-ink/70">
                      <span className="text-ink/50">Last Verified Request ID:</span>
                      <span className="font-mono text-[11px] text-ink/80 bg-ink/5 px-2 py-0.5 rounded">
                        {conn.requestId}
                      </span>
                    </div>
                  )}
                  {conn.lastVerifiedAt && (
                    <div className="flex justify-between items-center text-ink/70">
                      <span className="text-ink/50">Verified At:</span>
                      <span className="font-mono text-ink/80">
                        {new Date(conn.lastVerifiedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-ink/70">
                    <span className="text-ink/50">Autonomous Execution:</span>
                    <span className="font-bold text-emerald-700 uppercase text-[10px] bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      ENABLED (Live 0G Inference)
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="px-4 py-2 rounded-xl border border-rose-500/30 text-rose-700 font-heading text-xs font-semibold hover:bg-rose-500/10 transition-colors"
                  >
                    Disconnect & Replace Key
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-5 py-2 rounded-xl text-white font-heading text-xs font-semibold shadow-xs transition-transform hover:scale-105"
                    style={{ background: 'var(--accent)' }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              /* Configuration / Input Form */
              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-heading text-xs font-semibold text-ink">
                      0G Private Computer API Key
                    </label>
                    <a
                      href="https://pc.0g.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-ink/50 hover:text-ink underline font-body"
                    >
                      Get an API key at pc.0g.ai ↗
                    </a>
                  </div>

                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      placeholder="Paste your 0G Private Computer API key…"
                      disabled={conn.status === 'validating'}
                      className="w-full rounded-xl border border-ink/20 bg-white px-3.5 py-2.5 pr-10 font-mono text-xs text-ink outline-none focus:border-ink/50 focus:ring-1 focus:ring-ink/20 shadow-xs transition-all disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink/40 hover:text-ink transition-colors"
                      title={showKey ? 'Hide key' : 'Show key'}
                    >
                      <Icon d={showKey ? I.sun : I.moon} size={14} />
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-ink/50 font-body">
                    Your key is securely transmitted to the local bridge server and verified directly against 0G's
                    official router endpoint. Keys are never logged, exposed in client bundles, or committed.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 rounded-xl text-ink/60 font-heading text-xs hover:text-ink transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={conn.status === 'validating' || !inputKey.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-heading text-xs font-semibold shadow-md transition-all hover:scale-[1.02] disabled:opacity-50 disabled:pointer-events-none"
                    style={{ background: 'var(--accent)' }}
                  >
                    {conn.status === 'validating' ? (
                      <>
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span>Verifying with 0G...</span>
                      </>
                    ) : (
                      <>
                        <Icon d={I.play} size={12} />
                        <span>Connect & Verify 0G</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

