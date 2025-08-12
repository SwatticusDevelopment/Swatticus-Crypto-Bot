// src/js/rpc.js
import pLimit from 'p-limit';
import { getProvider, rotateProvider } from './provider.js';

const CONC = Number(process.env.RPC_CONCURRENCY || 6);
const MAX_RETRIES = Number(process.env.RPC_RETRIES || 5);
const limit = pLimit(CONC);

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function isTransient(err) {
  const msg = String(err?.message || err);
  return (
    msg.includes('429') ||
    msg.includes('failed to detect network') ||
    msg.includes('exceeded its compute units') ||
    msg.includes('missing revert data') ||
    msg.includes('could not coalesce error') ||
    msg.includes('network and cannot start up') ||
    msg.includes('CALL_EXCEPTION')
  );
}

export async function rpc(fn, { retries = MAX_RETRIES, name = 'rpc' } = {}) {
  return limit(async () => {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        // Ensure we always fetch a fresh provider reference
        const res = await fn(getProvider());
        return res;
      } catch (e) {
        lastErr = e;
        if (!isTransient(e) || i === retries) {
          throw e;
        }
        // exponential backoff with jitter
        const base = 250 * Math.pow(2, i);
        const jitter = Math.floor(Math.random() * 150);
        const delay = base + jitter;
        if (i >= 1) {
          // rotate provider after the first failure
          rotateProvider();
        }
        if (process?.env?.DEBUG_RPC === '1') {
          console.warn(`[rpc] transient error in ${name} (attempt ${i+1}/${retries+1}): ${e?.message || e}`);
          console.warn(`[rpc] backing off ${delay}ms and rotating provider`);
        }
        await sleep(delay);
      }
    }
    // Should never reach here
    throw lastErr || new Error('rpc: unknown error');
  });
}

export async function withRetries(fn, opts) {
  return rpc(fn, opts);
}
