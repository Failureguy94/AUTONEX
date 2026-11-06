import { parseAbi } from 'viem';

export const verifiableFactoryAbi = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data)',
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
]);

export const registryAbi = parseAbi([
  'function ownerOf(uint256 anyId) view returns (address)',
  'function getSubregistry(uint256 anyId) view returns (address)',
  'function setSubregistry(uint256 anyId, address subregistry)',
  'function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256 tokenId)',
  'function grantRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)',
  'function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)',
  'function roles(uint256 resource, address account) view returns (uint256)',
]);

export const resolverAbi = parseAbi([
  'function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)',
  'function setAddress(bytes name, uint256 coinType, bytes value)',
  'function setText(bytes name, string key, string value)',
  'function text(bytes32 node, string key) view returns (string)',
  'function grantSetterRoles(bytes setter, address account) returns (bool)',
  'function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)',
  'function roles(uint256 resource, address account) view returns (uint256)',
]);

export const factoryInitAbi = parseAbi([
  'function initialize((address account, uint256 roleBitmap)[] grants)',
  'function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)',
]);
