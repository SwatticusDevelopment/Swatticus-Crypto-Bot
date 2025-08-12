export const ZERO = '0x0000000000000000000000000000000000000000';

export function safeAddress(a) {
  if (!a || typeof a !== 'string' || !a.startsWith('0x') || a.length !== 42) {
    throw new Error(`Invalid address: ${a}`);
  }
  return a;
}

export function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}