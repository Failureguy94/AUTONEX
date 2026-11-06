# AUTONEX ENSv2 integration

AUTONEX uses ENSv2 as a verifiable identity and permission layer for agents. Arkiv remains the application-state layer: only references to ENS transactions and names belong in Arkiv; authoritative ownership, resolver records, and permissions remain on Ethereum Sepolia.

## Verified Sepolia deployment

The integration uses the official ENSv2 Sepolia deployments listed at [ENS deployments](https://docs.ens.domains/learn/deployments/#sepolia-ensv2):

| Contract | Address |
|---|---|
| ETHRegistry | `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` |
| PermissionedResolverImpl | `0x115eb53f0c60696633855f90b138178fb40b2b2c` |
| UserRegistryImpl | `0x9bd8a88719068d09ecee662f36c0e3856708366a` |
| UniversalResolverV2 | `0x24e1d8e068620b647ca097f961a61055f4f42d72` |
| VerifiableFactory | `0xda70306c98e97ece36f997a21368e53298572991` |

No parent name is hardcoded or assumed to be available. The connected wallet must be on chain `11155111` and must own the configured parent name.

## Flow

1. The user enters a parent `.eth` name and connects a browser wallet.
2. AUTONEX walks the ENSv2 registry hierarchy and checks `ownerOf` for every parent segment.
3. If the parent has no subregistry, AUTONEX deploys a UserRegistry proxy through the Verifiable Factory and points the parent at it with `setSubregistry`.
4. AUTONEX derives a sanitized agent label, checks `ownerOf(labelhash)`, deploys a Permissioned Resolver proxy, and registers the subname with the resolver.
5. Resolver records are written as ENSIP-5 text records (`description`, `agent.role`, `agent.capabilities`, `agent.endpoint`, `agent.owner`, `agent.workspace`, and `agent.version`) plus the ETH address record.
6. Resolution is performed through viem's ENS resolver. The UI only trusts the profile when the resolved address matches the expected agent wallet.
7. Workspace owners can delegate and revoke the `description` text setter role through ENSv2 Enhanced Access Control. The owner remains the signer; AUTONEX never handles private keys.

The resolver proxy is isolated per AUTONEX agent by a deterministic application salt. This intentionally avoids giving a manager access to unrelated agents through a shared resolver instance.

## Configuration

Copy the variables from `frontend/.env.example`:

```bash
VITE_ENS_SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
VITE_ENS_PARENT_NAME=your-parent.eth
# Optional reference writer, not an ENS data mirror:
VITE_ARKIV_ENS_ENDPOINT=
```

`VITE_ARKIV_ENS_ENDPOINT` is only used when an existing Arkiv service is supplied. This repository currently contains no Arkiv SDK or HTTP route, so the frontend stores a clearly scoped local reference cache when the variable is absent. It never treats that cache as proof of identity.

## Required wallet transactions

Creating the first identity under a parent may require:

- UserRegistry proxy deployment.
- Parent `setSubregistry`.
- Permissioned Resolver proxy deployment.
- Subname `register`.
- Resolver text-record writes.
- Resolver ETH-address write.

Each transaction is sent by the connected wallet and waited on before the next dependent operation. Failed or rejected transactions surface in the identity panel; no successful state is persisted before the final address resolution check.

## Judge demo on Sepolia

1. Fund a test wallet with Sepolia ETH.
2. Own or use a parent `.eth` namespace visible in the Sepolia ENS app.
3. Start AUTONEX and select an agent in Office mode.
4. In **ENSv2 identity**, enter the parent name and choose **Verify parent**.
5. Choose **Create identity** and approve each wallet transaction.
6. Show the resulting `researcher.<parent>.eth`, resolver address, wallet, and Sepolia explorer/ENS app link.
7. Enter a second wallet as manager, grant the text-manager role, then revoke it.
8. Resolve the name from a second browser/account and demonstrate that the address and metadata are read from ENS, while AUTONEX retains only the reference tuple in Arkiv/application state.

No transaction hashes or user-specific contract addresses are committed to the repository; they are produced by the connected wallet during the live Sepolia demonstration.
