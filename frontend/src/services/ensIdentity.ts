import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  keccak256,
  namehash,
  parseEventLogs,
  stringToHex,
  toHex,
  type Address,
  type Hash,
} from 'viem';
import { normalize, packetToBytes } from 'viem/ens';
import { ENS_CHAIN, ENS_CHAIN_ID, ENS_PARENT_NAME, ENS_RPC_URL, ENSV2_DEPLOYMENTS } from '@/ens/config';
import { factoryInitAbi, registryAbi, resolverAbi, verifiableFactoryAbi } from '@/ens/abis';
import type { EnsAgentIdentity, EnsIdentityDraft, EnsParentNamespace } from '@/ens/types';
import { identityMatches, normalizeAgentLabel, resolutionStatus, textResource, ZERO_ADDRESS } from '@/ens/validation';

const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n;
const ROLE_SET_TEXT = 1n << 4n;
const ETH_COIN_TYPE = 60n;
const client = createPublicClient({ chain: ENS_CHAIN, transport: http(ENS_RPC_URL) });

function requireEthereum() {
  if (!window.ethereum) throw new Error('No browser wallet detected. Install or enable a Sepolia wallet.');
  return window.ethereum;
}

function requireSepolia(chainId: number) {
  if (chainId !== ENS_CHAIN_ID) throw new Error(`Switch your wallet to Ethereum Sepolia (chain ${ENS_CHAIN_ID}).`);
}

function labelHash(label: string): Hash {
  return keccak256(stringToHex(label));
}

function dnsName(name: string): `0x${string}` {
  return toHex(packetToBytes(normalize(name)));
}

function proxySalt(domain: string, value: string): bigint {
  return BigInt(keccak256(stringToHex(`${domain}:${value}`)));
}

async function connectedWallet() {
  const ethereum = requireEthereum();
  const wallet = createWalletClient({ chain: ENS_CHAIN, transport: custom(ethereum) });
  const [account] = await wallet.requestAddresses();
  const chainId = await wallet.getChainId();
  requireSepolia(chainId);
  return { wallet, account, chainId };
}

async function deployProxy(implementation: Address, salt: bigint, data: `0x${string}`): Promise<{ address: Address; hash: Hash }> {
  const { wallet, account } = await connectedWallet();
  const hash = await wallet.writeContract({
    address: ENSV2_DEPLOYMENTS.verifiableFactory,
    abi: verifiableFactoryAbi,
    functionName: 'deployProxy',
    args: [implementation, salt, data],
    account,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const [event] = parseEventLogs({ abi: verifiableFactoryAbi, eventName: 'ProxyDeployed', logs: receipt.logs });
  if (!event?.args.proxyAddress) throw new Error('ENSv2 proxy deployment completed without a ProxyDeployed event.');
  return { address: event.args.proxyAddress, hash };
}

export async function connectEnsWallet(): Promise<Address> {
  const { wallet, account } = await connectedWallet();
  await wallet.requestAddresses();
  return account;
}

export async function verifyParentNamespace(parentName = ENS_PARENT_NAME): Promise<EnsParentNamespace> {
  const normalized = normalize(parentName);
  const labels = normalized.split('.');
  if (labels.length < 2 || labels[labels.length - 1] !== 'eth') throw new Error('Parent namespace must be an ENS .eth name.');
  const { account } = await connectedWallet();
  let registryAddress: Address = ENSV2_DEPLOYMENTS.ethRegistry;
  let owner: Address = '0x0000000000000000000000000000000000000000';
  let subregistryAddress: Address = '0x0000000000000000000000000000000000000000';

  for (const label of labels.slice(0, -1).reverse()) {
    const id = BigInt(labelHash(label));
    owner = await client.readContract({ address: registryAddress, abi: registryAbi, functionName: 'ownerOf', args: [id] });
    if (owner === ZERO_ADDRESS) throw new Error(`Parent segment ${label} is not registered or has expired.`);
    subregistryAddress = await client.readContract({ address: registryAddress, abi: registryAbi, functionName: 'getSubregistry', args: [id] });
    if (label !== labels[0]) {
      if (subregistryAddress === ZERO_ADDRESS) throw new Error(`No ENSv2 subregistry is configured for ${label}.`);
      registryAddress = subregistryAddress;
    }
  }

  if (owner.toLowerCase() !== account.toLowerCase()) {
    throw new Error(`Connected wallet does not own ${normalized}. Expected ${owner}.`);
  }
  return {
    name: normalized,
    registryAddress,
    labelHash: labelHash(labels[0]),
    owner,
    subregistryAddress,
    verified: true,
  };
}

async function ensureParentSubregistry(parent: EnsParentNamespace): Promise<{ registryAddress: Address; transactionHash: Hash }> {
  if (parent.subregistryAddress !== '0x0000000000000000000000000000000000000000') {
    return { registryAddress: parent.subregistryAddress, transactionHash: '0x' as Hash };
  }
  const { wallet, account } = await connectedWallet();
  const initData = encodeFunctionData({
    abi: factoryInitAbi,
    functionName: 'initialize',
    args: [[{ account, roleBitmap: ALL_ROLES }]],
  });
  const deployed = await deployProxy(
    ENSV2_DEPLOYMENTS.userRegistryImpl,
    proxySalt('registry', namehash(parent.name)),
    initData,
  );
  const hash = await wallet.writeContract({
    address: parent.registryAddress,
    abi: registryAbi,
    functionName: 'setSubregistry',
    args: [BigInt(parent.labelHash), deployed.address],
    account,
  });
  await client.waitForTransactionReceipt({ hash });
  return { registryAddress: deployed.address, transactionHash: hash };
}

export async function createAgentIdentity(parent: EnsParentNamespace, draft: EnsIdentityDraft): Promise<EnsAgentIdentity> {
  const label = normalizeAgentLabel(draft.agentName);
  const { account, wallet } = await connectedWallet();
  const owner = draft.walletAddress ?? account;
  const namespace = await ensureParentSubregistry(parent);
  const labelId = BigInt(labelHash(label));
  const existingOwner = await client.readContract({ address: namespace.registryAddress, abi: registryAbi, functionName: 'ownerOf', args: [labelId] });
  if (existingOwner !== ZERO_ADDRESS) throw new Error(`Agent subname ${label}.${parent.name} already exists.`);

  const resolverInit = encodeFunctionData({
    abi: factoryInitAbi,
    functionName: 'initialize',
    args: [[{ account, roleBitmap: ALL_ROLES }], []],
  });
  const resolver = await deployProxy(
    ENSV2_DEPLOYMENTS.permissionedResolverImpl,
    proxySalt('resolver', `${account}:${draft.agentId}`),
    resolverInit,
  );
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  const registerHash = await wallet.writeContract({
    address: namespace.registryAddress,
    abi: registryAbi,
    functionName: 'register',
    args: [label, owner, '0x0000000000000000000000000000000000000000', resolver.address, ALL_ROLES, expiry],
    account,
  });
  await client.waitForTransactionReceipt({ hash: registerHash });

  const fullName = `${label}.${parent.name}`;
  const name = dnsName(fullName);
  const recordValues: [string, string][] = [
    ['description', draft.description],
    ['agent.role', draft.role],
    ['agent.capabilities', draft.capabilities],
    ['agent.endpoint', draft.endpoint],
    ['agent.owner', owner],
    ['agent.workspace', parent.name],
    ['agent.version', draft.version],
  ];
  let lastHash = registerHash;
  for (const [key, value] of recordValues) {
    lastHash = await wallet.writeContract({
      address: resolver.address,
      abi: resolverAbi,
      functionName: 'setText',
      args: [name, key, value],
      account,
    });
    await client.waitForTransactionReceipt({ hash: lastHash });
  }
  lastHash = await wallet.writeContract({
    address: resolver.address,
    abi: resolverAbi,
    functionName: 'setAddress',
    args: [name, ETH_COIN_TYPE, toHex(owner)],
    account,
  });
  await client.waitForTransactionReceipt({ hash: lastHash });

  const resolved = await client.getEnsAddress({ name: fullName });
  if (!resolved || resolved.toLowerCase() !== owner.toLowerCase()) throw new Error(`ENS verification failed for ${fullName}.`);
  return {
    agentId: draft.agentId,
    ensName: fullName,
    parentName: parent.name,
    walletAddress: owner,
    resolverAddress: resolver.address,
    registryAddress: namespace.registryAddress,
    transactionHash: lastHash,
    chainId: ENS_CHAIN_ID,
    createdAt: new Date().toISOString(),
    identityStatus: 'active',
    description: draft.description,
    role: draft.role,
    capabilities: draft.capabilities,
    endpoint: draft.endpoint,
    version: draft.version,
  };
}

export async function resolveAgentIdentity(name: string): Promise<Partial<EnsAgentIdentity> & { ensName: string; resolvedAddress: Address | null }> {
  const normalized = normalize(name);
  const resolvedAddress = await client.getEnsAddress({ name: normalized }).catch(() => null);
  const keys = ['description', 'agent.role', 'agent.capabilities', 'agent.endpoint', 'agent.owner', 'agent.workspace', 'agent.version'];
  const records = await Promise.all(keys.map(async (key) => [key, await client.getEnsText({ name: normalized, key }).catch(() => null)] as const));
  const recordMap = Object.fromEntries(records);
  return {
    ensName: normalized,
    resolvedAddress,
    description: recordMap.description || undefined,
    role: recordMap['agent.role'] || undefined,
    capabilities: recordMap['agent.capabilities'] || undefined,
    endpoint: recordMap['agent.endpoint'] || undefined,
    walletAddress: (recordMap['agent.owner'] as Address | null) || resolvedAddress || undefined,
    parentName: recordMap['agent.workspace'] || undefined,
    version: recordMap['agent.version'] || undefined,
    identityStatus: resolutionStatus(resolvedAddress),
  };
}

export async function verifyAgentInteraction(name: string, expectedAddress: Address) {
  const identity = await resolveAgentIdentity(name);
  if (!identity.resolvedAddress || !identityMatches({ walletAddress: expectedAddress }, identity.resolvedAddress)) {
    throw new Error(`Resolved ENS identity ${identity.ensName} does not match the expected agent address.`);
  }
  return identity;
}

export async function grantAgentTextManager(resolverAddress: Address, manager: Address): Promise<Hash> {
  const { wallet, account } = await connectedWallet();
  const setter = encodeFunctionData({
    abi: resolverAbi,
    functionName: 'setText',
    args: [dnsName('agent.invalid'), 'description', ''],
  });
  const hash = await wallet.writeContract({
    address: resolverAddress,
    abi: resolverAbi,
    functionName: 'grantSetterRoles',
    args: [setter, manager],
    account,
  });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}

export async function revokeAgentTextManager(resolverAddress: Address, manager: Address): Promise<Hash> {
  const { wallet, account } = await connectedWallet();
  const resource = textResource('description');
  const hash = await wallet.writeContract({
    address: resolverAddress,
    abi: resolverAbi,
    functionName: 'revokeRoles',
    args: [resource, ROLE_SET_TEXT, manager],
    account,
  });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}
