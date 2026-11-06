import { useEffect, useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { rabdiChain } from '@/config/chain';
import type { Address } from 'viem';
import type { AgentUI } from '@/state/store';
import type { EnsAgentIdentity, EnsParentNamespace } from '@/ens/types';
import {
  connectEnsWallet,
  createAgentIdentity,
  grantAgentTextManager,
  resolveAgentIdentity,
  revokeAgentTextManager,
  verifyParentNamespace,
} from '@/services/ensIdentity';
import { persistEnsReference, persistEnsReferenceToArkiv } from '@/services/arkivEns';

export function EnsIdentityPanel({ agent, onIdentity }: { agent: AgentUI; onIdentity: (identity: EnsAgentIdentity) => void }) {
  const { chainId } = useAccount();
  const { data: walletClient } = useWalletClient({ chainId: rabdiChain.id });
  const [parentName, setParentName] = useState('');
  const [manager, setManager] = useState('');
  const [identity, setIdentity] = useState<EnsAgentIdentity | null>(agent.ensIdentity as EnsAgentIdentity | null);
  const [parent, setParent] = useState<EnsParentNamespace | null>(null);
  const [status, setStatus] = useState('Connect a Sepolia wallet and verify a parent ENS namespace.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    resolveAgentIdentity(identity.ensName).then((resolved) => {
      if (cancelled) return;
      if (!resolved.resolvedAddress || resolved.resolvedAddress.toLowerCase() !== identity.walletAddress.toLowerCase()) {
        setStatus('Onchain resolution does not match the stored agent wallet. Identity is not trusted.');
        setIdentity({ ...identity, identityStatus: 'unresolved' });
        return;
      }
      setStatus(`Resolved and verified on Sepolia. ${resolved.role ?? identity.role}`);
    }).catch(() => {
      if (!cancelled) setStatus('ENS name could not be resolved. Identity is not trusted.');
    });
    return () => { cancelled = true; };
  }, [identity?.ensName]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); } catch (error) { setStatus(error instanceof Error ? error.message : 'ENS operation failed.'); }
    finally { setBusy(false); }
  };

  const create = () => run(async () => {
    const connected = await connectEnsWallet();
    const verifiedParent = parent ?? await verifyParentNamespace(parentName);
    setParent(verifiedParent);
    const created = await createAgentIdentity(verifiedParent, {
      agentId: agent.id,
      agentName: agent.name,
      role: agent.role,
      description: `${agent.name} is an AUTONEX ${agent.role}.`,
      capabilities: agent.department ?? 'general',
      endpoint: '',
      version: '1.0.0',
      walletAddress: connected,
    });
    if (walletClient && chainId === rabdiChain.id) {
      await persistEnsReferenceToArkiv(walletClient, created);
    } else {
      await persistEnsReference(created);
    }
    setIdentity(created);
    onIdentity(created);
    setStatus(`Active and verified on Sepolia. ${created.transactionHash.slice(0, 10)}…`);
  });

  return (
    <div className="rounded-xl border border-ink/10 bg-white/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase text-ink/45">ENSv2 identity</div>
        {identity && <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${identity.identityStatus === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{identity.identityStatus}</span>}
      </div>
      {identity ? (
        <>
          <a className="font-heading text-sm text-ink underline decoration-dotted" href={`https://sepolia.app.ens.domains/${identity.ensName}`} target="_blank" rel="noreferrer">{identity.ensName}</a>
          <div className="text-[10px] font-mono text-ink/55 break-all">wallet {identity.walletAddress}</div>
          <div className="text-[10px] font-body text-ink/65">{identity.description}</div>
          <div className="flex gap-1.5">
            <button disabled={busy || !manager} onClick={() => run(async () => { const tx = await grantAgentTextManager(identity.resolverAddress as Address, manager as Address); setStatus(`Manager granted. ${tx.slice(0, 10)}…`); })} className="flex-1 rounded-lg border border-ink/15 px-2 py-1.5 text-[10px] disabled:opacity-40">Grant text manager</button>
            <button disabled={busy || !manager} onClick={() => run(async () => { const tx = await revokeAgentTextManager(identity.resolverAddress as Address, manager as Address); setStatus(`Manager revoked. ${tx.slice(0, 10)}…`); })} className="flex-1 rounded-lg border border-[#d64545]/40 text-[#d64545] px-2 py-1.5 text-[10px] disabled:opacity-40">Revoke</button>
          </div>
          <input value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Manager address (0x…)" className="w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[10px] font-mono" />
        </>
      ) : (
        <>
          <input value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Parent name you own, e.g. example.eth" className="w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-xs font-mono" />
          <div className="flex gap-1.5">
            <button disabled={busy || !parentName} onClick={() => run(async () => { const p = await verifyParentNamespace(parentName); setParent(p); setStatus(`Verified owner of ${p.name}.`); })} className="flex-1 rounded-lg border border-ink/15 px-2 py-1.5 text-[10px] disabled:opacity-40">Verify parent</button>
            <button disabled={busy || !parent} onClick={create} className="flex-1 rounded-lg px-2 py-1.5 text-[10px] text-white disabled:opacity-40" style={{ background: 'var(--accent)' }}>Create identity</button>
          </div>
        </>
      )}
      <div className="text-[9px] font-body text-ink/50">{busy ? 'Waiting for wallet approval / Sepolia confirmation…' : status}</div>
    </div>
  );
}
