import { defineChain } from 'viem';
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

