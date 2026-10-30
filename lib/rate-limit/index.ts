import "server-only";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalRequests: number;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 15 * 60 * 1000, maxRequests: 10, keyPrefix: "rl:auth" },
  device_provisioning: { windowMs: 60 * 60 * 1000, maxRequests: 20, keyPrefix: "rl:device_prov" },
  api_key_rotation: { windowMs: 60 * 60 * 1000, maxRequests: 5, keyPrefix: "rl:key_rot" },
  account_creation: { windowMs: 60 * 60 * 1000, maxRequests: 50, keyPrefix: "rl:acc_create" },
  secret_replacement: { windowMs: 60 * 60 * 1000, maxRequests: 10, keyPrefix: "rl:secret_repl" },
  device_sync: { windowMs: 60 * 1000, maxRequests: 30, keyPrefix: "rl:device_sync" },
};

const memoryStore = new Map<string, { count: number; resetTime: number }>();

function getMemoryStoreKey(prefix: string, identifier: string): string {
  return `${prefix}:${identifier}`;
}

function cleanupMemoryStore(): void {
  const now = Date.now();
  for (const [key, value] of memoryStore.entries()) {
    if (value.resetTime < now) {
      memoryStore.delete(key);
    }
  }
}

setInterval(cleanupMemoryStore, 60 * 1000);

export async function rateLimit(
  identifier: string,
  configName: keyof typeof DEFAULT_CONFIGS = "auth"
): Promise<RateLimitResult> {
  const config = DEFAULT_CONFIGS[configName];
  const key = getMemoryStoreKey(config.keyPrefix, identifier);
  const now = Date.now();
  const windowStart = now - config.windowMs;
  
  let entry = memoryStore.get(key);
  
  if (!entry || entry.resetTime < now) {
    entry = { count: 0, resetTime: now + config.windowMs };
    memoryStore.set(key, entry);
  }
  
  entry.count++;
  
  const allowed = entry.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  
  return {
    allowed,
    remaining,
    resetTime: entry.resetTime,
    totalRequests: entry.count,
  };
}

export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.totalRequests + result.remaining),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetTime / 1000)),
  };
}

export class RateLimitError extends Error {
  constructor(
    public readonly resetTime: number,
    public readonly limit: number
  ) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
  }
}

export async function enforceRateLimit(
  identifier: string,
  configName: keyof typeof DEFAULT_CONFIGS = "auth"
): Promise<void> {
  const result = await rateLimit(identifier, configName);
  
  if (!result.allowed) {
    throw new RateLimitError(result.resetTime, result.totalRequests);
  }
}