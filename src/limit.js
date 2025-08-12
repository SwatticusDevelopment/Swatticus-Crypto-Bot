import Bottleneck from 'bottleneck';

export const limiter = new Bottleneck({
  maxConcurrent: Number(process.env.MAX_CONCURRENCY ?? 4),
  minTime: Number(process.env.MIN_TIME_MS ?? 120),
});

export const withLimiter = fn => (...args) => limiter.schedule(() => fn(...args));