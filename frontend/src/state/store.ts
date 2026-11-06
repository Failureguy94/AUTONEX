import { create } from 'zustand';
import { Agent, BlackboardNote, DepartmentDef, Envelope, FinalResult, Metrics, ModelInfo, PermissionRequest, Task, TriageResult, SwarmIdea, SwarmCluster, SwarmCritique } from '@/api/types';
import { DEFAULT_ACCENT } from '@/config/office';

export interface AgentUI extends Agent {
  pending: number; done: number; failed: number;
  outputs: { task_id: string; ts: string; kind: string; preview: string }[];
}
export interface LogEntry { id: number; ts_sim: string; type: string; text: string; agentId?: string; taskId?: string }
export interface GateState { in_flight: number; limit: number; queue_depth: number; backoff_active: boolean }
export interface Settings {
  shadows: 'low' | 'med' | 'high'; post: boolean; lodDist: number; sound: boolean;
  reducedMotion: boolean; concurrency: number; pricePerM: number; showPaidCost: boolean;
}

export type ZGStatus = 'not_configured' | 'validating' | 'connected' | 'invalid_key' | 'unavailable' | 'error';
export type ExecutionState = 'idle' | 'validating' | 'waiting_0g' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ZGConnectionState {
  status: ZGStatus;
  isVerified: boolean;
  maskedKey: string | null;
  error: string | null;
  lastVerifiedAt: string | null;
  requestId: string | null;
}

interface Store {
  phase: 'landing' | 'workspace';
  goal: string; modelId: string; models: ModelInfo[]; mode: 'live' | 'replay';
  view: '3d' | 'blueprint'; night: boolean; flows: boolean; dev: boolean;
  speed: number; paused: boolean; accent: string;
  simClock: string; realElapsed: number; effortLogical: number;
  agents: Record<string, AgentUI>; order: string[];
  tasks: Record<string, Task>; edges: { from: string; to: string }[];
  notes: BlackboardNote[]; log: LogEntry[]; runEvents: Envelope[];
  metrics: Metrics; gate: GateState; llmByRole: Record<string, number>; llmByModel: Record<string, number>;
  terminal: Record<string, string[]>;
  report: FinalResult | null; replanCount: number; planOutline: string[];
  selected: string | null; inspectorOpen: boolean; drawerOpen: boolean; settingsOpen: boolean; reportOpen: boolean;
  followId: string | null; toast: string | null; offline: boolean; demoMode: boolean;
  replayIdx: number; replayPlaying: boolean; notePulse: number;
  appMode: 'office' | 'swarm';
  swarmSize: 10 | 20 | 30 | 40 | 50;
  swarmPhaseTick: number;
  swarm: {
    phase: string; round: number; topic: string; moderatorId: string;
    agents: Record<string, any>;
    ideas: Record<string, SwarmIdea>; ideaOrder: string[];
    clusters: Record<string, SwarmCluster>; clusterOrder: string[];
    critiques: SwarmCritique[];
    votes: { agent_id: string; idea_id: string; score: number }[];
    tally: { scores: { idea_id: string; score: number; votes: number }[]; agreement: number } | null;
    speakingId: string | null;
    synthesis: { text: string; source_idea_ids: string[] } | null;
  };
  triage: TriageResult | null;
  departments: Record<string, DepartmentDef>;
  pendingPermissions: PermissionRequest[];
  profile: 'strict' | 'assist' | 'turbo';
  sandboxMode: 'native' | 'docker';
  contextStages: Record<string, { stage: number; frac: number }>;
  fileEdits: Record<string, { path: string; line_ranges: [number, number][]; branch?: string; ts: string }[]>;
  checkpoint: { branch: string; start_commit: string } | null;
  settings: Settings;
  zgConnection: ZGConnectionState;
  zgModalOpen: boolean;
  executionState: ExecutionState;
  executionError: string | null;
  setExecutionState: (state: ExecutionState, error?: string | null) => void;
  setZGModalOpen: (open: boolean) => void;
  checkZGStatus: () => Promise<void>;
  verifyZGKey: (apiKey: string) => Promise<{ valid: boolean; message: string }>;
  disconnectZG: () => Promise<void>;
  set: (p: Partial<Store>) => void;
  resetRun: (goal: string) => void;
}

let logId = 0;
export const useStore = create<Store>((set) => ({
  phase: 'landing',
  goal: '', modelId: 'openrouter/google/gemma-4-31b-it:free', models: [], mode: 'live',
  view: '3d', night: false, flows: false, dev: false,
  speed: 1, paused: false, accent: DEFAULT_ACCENT,
  simClock: '09:00', realElapsed: 0, effortLogical: 0,
  agents: {}, order: [], tasks: {}, edges: [], notes: [], log: [], runEvents: [],
  metrics: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 }, gate: { in_flight: 0, limit: 4, queue_depth: 0, backoff_active: false },
  llmByRole: {}, llmByModel: {}, terminal: {},
  report: null, replanCount: 0, planOutline: [],
  selected: null, inspectorOpen: false, drawerOpen: false, settingsOpen: false, reportOpen: false,
  followId: null, toast: null, offline: false, demoMode: true,
  replayIdx: 0, replayPlaying: true, notePulse: 0,
  appMode: 'office',
  swarmSize: 20,
  swarmPhaseTick: 0,
  swarm: {
    phase: '', round: 0, topic: '', moderatorId: '',
    agents: {}, ideas: {}, ideaOrder: [], clusters: {}, clusterOrder: [],
    critiques: [], votes: [], tally: null, speakingId: null, synthesis: null,
  },
  triage: null,
  departments: {},
  pendingPermissions: [],
  profile: 'assist',
  sandboxMode: 'native',
  contextStages: {},
  fileEdits: {},
  checkpoint: null,
  settings: { shadows: 'med', post: true, lodDist: 26, sound: true, reducedMotion: false, concurrency: 4, pricePerM: 0.6, showPaidCost: false },
  executionState: 'idle',
  executionError: null,
  setExecutionState: (executionState, executionError = null) => set({ executionState, executionError }),
  zgModalOpen: false,
  zgConnection: {
    status: 'not_configured',
    isVerified: false,
    maskedKey: null,
    error: null,
    lastVerifiedAt: null,
    requestId: null
  },
  setZGModalOpen: (open) => set({ zgModalOpen: open }),
  checkZGStatus: async () => {
    // 1. Check local session storage first
    try {
      const savedKey = typeof window !== 'undefined' ? sessionStorage.getItem('zg_api_key') : null;
      if (savedKey) {
        const trimmed = savedKey.trim();
        const masked = trimmed.length <= 8 ? '••••' + trimmed.slice(-2) : trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);
        set((s) => ({
          zgConnection: {
            ...s.zgConnection,
            status: 'connected',
            isVerified: true,
            maskedKey: masked,
            error: null
          }
        }));
      }
    } catch {}

    // 2. Check local bridge server (non-blocking with short timeout)
    try {
      const res = await fetch('http://localhost:8000/api/config/0g/status', {
        signal: AbortSignal.timeout(1500)
      }).then((r) => r.json());

      if (res && res.isVerified) {
        set((s) => ({
          zgConnection: {
            status: 'connected',
            isVerified: true,
            maskedKey: res.maskedKey || s.zgConnection.maskedKey,
            error: null,
            lastVerifiedAt: res.lastVerifiedAt || new Date().toISOString(),
            requestId: res.lastRequestId || s.zgConnection.requestId
          }
        }));
      }
    } catch {
      // Bridge is not running; retain existing status (default 'not_configured' or sessionStorage validated state)
    }
  },
  verifyZGKey: async (apiKey: string) => {
    const trimmed = (apiKey || '').trim();
    if (!trimmed) {
      set((s) => ({
        zgConnection: {
          ...s.zgConnection,
          status: 'not_configured',
          error: 'Please enter your 0G API Key'
        }
      }));
      return { valid: false, message: 'Please enter your 0G API Key' };
    }

    set((s) => ({
      zgConnection: {
        ...s.zgConnection,
        status: 'validating',
        error: null
      }
    }));

    const masked = trimmed.length <= 8 ? '••••' + trimmed.slice(-2) : trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);

    try {
      // Direct live verification against 0G Private Computer Router API (supports CORS)
      const zgRes = await fetch('https://router-api.0g.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${trimmed}`,
          'X-0G-Provider-Trust-Mode': 'standard'
        },
        body: JSON.stringify({
          model: 'qwen-flash',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        }),
        signal: AbortSignal.timeout(15000)
      });

      const capturedRequestId = zgRes.headers.get('x-request-id') || zgRes.headers.get('request-id');

      // HTTP 200 or 429 confirms valid token
      if (zgRes.ok || zgRes.status === 429) {
        const effectiveId = capturedRequestId || `req_0g_${Date.now()}`;
        try {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('zg_api_key', trimmed);
          }
        } catch {}

        set({
          zgConnection: {
            status: 'connected',
            isVerified: true,
            maskedKey: masked,
            error: null,
            lastVerifiedAt: new Date().toISOString(),
            requestId: effectiveId
          }
        });

        // Background sync to bridge server if online
        fetch('http://localhost:8000/api/config/0g/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: trimmed })
        }).catch(() => {});

        return { valid: true, message: '0G Private Computer credentials successfully verified' };
      }

      // HTTP 401 or 403: Invalid Key
      if (zgRes.status === 401 || zgRes.status === 403) {
        set({
          zgConnection: {
            status: 'invalid_key',
            isVerified: false,
            maskedKey: null,
            error: 'Invalid 0G API Key: authentication failed (401)',
            lastVerifiedAt: null,
            requestId: capturedRequestId || null
          }
        });
        return { valid: false, message: 'Invalid 0G API Key: authentication failed (401)' };
      }

      // HTTP 5xx: Service unavailable
      const errText = await zgRes.text();
      set({
        zgConnection: {
          status: 'unavailable',
          isVerified: false,
          maskedKey: null,
          error: `0G service unavailable (HTTP ${zgRes.status})`,
          lastVerifiedAt: null,
          requestId: capturedRequestId || null
        }
      });
      return { valid: false, message: `0G service unavailable (HTTP ${zgRes.status}): ${errText.slice(0, 100)}` };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError' || err.name === 'TimeoutError';
      const errMsg = isAbort
        ? '0G service unavailable: request timed out'
        : `0G connection error: ${err.message || 'network unreachable'}`;

      set({
        zgConnection: {
          status: 'unavailable',
          isVerified: false,
          maskedKey: null,
          error: errMsg,
          lastVerifiedAt: null,
          requestId: null
        }
      });
      return { valid: false, message: errMsg };
    }
  },
  disconnectZG: async () => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('zg_api_key');
      }
    } catch {}
    try {
      await fetch('http://localhost:8000/api/config/0g', { method: 'DELETE' });
    } catch {}
    set({
      zgConnection: {
        status: 'not_configured',
        isVerified: false,
        maskedKey: null,
        error: null,
        lastVerifiedAt: null,
        requestId: null
      }
    });
  },
  set: (p) => set(p),
  resetRun: (goal) => set({
    goal, executionState: 'idle', executionError: null, agents: {}, order: [], tasks: {}, edges: [], notes: [], log: [], runEvents: [],
    metrics: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 },
    gate: { in_flight: 0, limit: 4, queue_depth: 0, backoff_active: false },
    llmByRole: {}, llmByModel: {}, terminal: {}, report: null, replanCount: 0,
    planOutline: [], selected: null, inspectorOpen: false, followId: null,
    triage: null, departments: {}, pendingPermissions: [], contextStages: {}, fileEdits: {}, checkpoint: null,
    simClock: '09:00', realElapsed: 0, effortLogical: 0, replayIdx: 0, replayPlaying: true, mode: 'live',
    swarm: {
      phase: '', round: 0, topic: '', moderatorId: '',
      agents: {}, ideas: {}, ideaOrder: [], clusters: {}, clusterOrder: [],
      critiques: [], votes: [], tally: null, speakingId: null, synthesis: null,
    },
  }),
}));

export const pushLog = (e: Envelope, text: string) => {
  const s = useStore.getState();
  const log = [...s.log, { id: ++logId, ts_sim: e.ts_sim, type: e.type, text, agentId: e.agent_id, taskId: e.task_id }];
  useStore.setState({ log: log.length > 600 ? log.slice(log.length - 600) : log });
};
