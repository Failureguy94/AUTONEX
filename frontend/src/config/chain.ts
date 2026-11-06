import { defineChain, createWalletClient, custom, type WalletClient } from 'viem';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

// Rabdi DB-Chain Testnet Specification (Chain ID 7794095)
export const rabdiChain = defineChain({
  id: 7794095,
  name: 'Rabdi DB-Chain',
  nativeCurrency: {
    name: 'Testnet GLM',
    symbol: 'tGLM',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'],
      webSocket: ['wss://rpc.rabdi.db-chain.testnet.arkiv.network'],
    },
    public: {
      http: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'],
      webSocket: ['wss://rpc.rabdi.db-chain.testnet.arkiv.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Rabdi Explorer',
      url: 'https://rabdi.explorer.arkiv.network',
    },
  },
  testnet: true,
});

// Wagmi configuration using standard RPC without exposing access keys to the wallet connector
export const wagmiConfig = createConfig({
  chains: [rabdiChain],
  connectors: [injected()],
  transports: {
    [rabdiChain.id]: http(),
  },
});

/**
 * Prompts user's wallet to switch to or add the Rabdi DB-Chain Testnet.
 */
export async function switchOrAddRabdiNetwork(): Promise<void> {
  const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
  if (!eth) {
    throw new Error('No EVM wallet detected in browser. Please install MetaMask or another browser wallet.');
  }

  const chainIdHex = '0x76ee8f'; // 7794095 in hex

  // Check current chain ID first! If already on Rabdi, return immediately without throwing switch prompt
  try {
    const currentChain = await eth.request({ method: 'eth_chainId' });
    if (
      currentChain &&
      (String(currentChain).toLowerCase() === chainIdHex.toLowerCase() ||
        parseInt(String(currentChain), 16) === 7794095 ||
        Number(currentChain) === 7794095)
    ) {
      return;
    }
  } catch (err) {
    console.warn('[Rabdi] eth_chainId check error:', err);
  }

  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError: any) {
    const msg = switchError?.message || '';
    if (msg.includes('already') || msg.includes('current')) {
      return;
    }
    if (
      switchError?.code === 4902 ||
      msg.includes('unrecognized') ||
      msg.includes('Unknown chain') ||
      switchError?.data?.originalError?.code === 4902
    ) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: 'Rabdi DB-Chain',
            nativeCurrency: { name: 'Testnet GLM', symbol: 'tGLM', decimals: 18 },
            rpcUrls: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'],
            blockExplorerUrls: ['https://rabdi.explorer.arkiv.network'],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

/**
 * Ensures an active, Rabdi-configured WalletClient is available.
 * If wagmi's walletClient is ready and on Rabdi, returns it.
 * Otherwise, requests network switch to Rabdi and builds a direct viem WalletClient.
 */
export async function ensureRabdiWalletClient(
  existingClient?: WalletClient | null
): Promise<WalletClient> {
  const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;

  if (existingClient?.account && existingClient.chain?.id === rabdiChain.id) {
    return existingClient;
  }

  if (eth) {
    // 1. Switch or register Rabdi DB-Chain in wallet if not already on it
    await switchOrAddRabdiNetwork();

    // 2. Request / check connected account
    const accounts: string[] = await eth.request({
      method: 'eth_requestAccounts',
    });
    if (!accounts || !accounts[0]) {
      throw new Error('No account found in connected wallet.');
    }

    return createWalletClient({
      account: accounts[0] as `0x${string}`,
      chain: rabdiChain,
      transport: custom(eth),
    });
  }

  throw new Error('Please connect your Web3 wallet first.');
}


