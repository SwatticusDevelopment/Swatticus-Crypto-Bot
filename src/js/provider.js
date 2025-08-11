// src/js/provider.js
import { ethers } from 'ethers';

const RPCS = [
  process.env.ALCHEMY_BASE_RPC,         // e.g. https://base-mainnet.g.alchemy.com/v2/KEY
  'https://mainnet.base.org',           // public fallback
  process.env.QUICKNODE_BASE_RPC        // optional
].filter(Boolean);

const NETWORK = { chainId: 8453, name: 'base' };

let current = 0;
let provider = new ethers.JsonRpcProvider(RPCS[current], NETWORK);

export function getProvider() {
  return provider;
}

export function rotateProvider() {
  current = (current + 1) % RPCS.length;
  provider = new ethers.JsonRpcProvider(RPCS[current], NETWORK);
  return provider;
}
