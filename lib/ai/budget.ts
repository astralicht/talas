import { getRedis } from '@/lib/db/redis';
import { getEnv } from '@/lib/env';

export const AI_DAILY_BUDGET_USD = 2;
export const INPUT_COST_PER_MILLION = 2.5;
export const OUTPUT_COST_PER_MILLION = 10;

const memorySpend = new Map<string, number>();

function todayKey(userId: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `talas-ai-budget:${date}:${userId}`;
}

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION
  );
}

export async function spentToday(userId: string): Promise<number> {
  const key = todayKey(userId);
  if (process.env.NODE_ENV === 'test') return memorySpend.get(key) ?? 0;
  try {
    const value = await getRedis().get(key);
    return value ? Number.parseFloat(value) : 0;
  } catch {
    return memorySpend.get(key) ?? 0;
  }
}

export async function assertWithinDailyBudget(userId: string): Promise<void> {
  const budget = getEnv().AI_DAILY_BUDGET_USD || AI_DAILY_BUDGET_USD;
  const spent = await spentToday(userId);
  if (spent >= budget) {
    throw new BudgetExceededError(spent, budget);
  }
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super('The daily AI budget has been reached');
    this.name = 'BudgetExceededError';
  }
}

export async function recordSpend(
  userId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number> {
  const cost = estimateCostUsd(inputTokens, outputTokens);
  const key = todayKey(userId);
  memorySpend.set(key, (memorySpend.get(key) ?? 0) + cost);
  if (process.env.NODE_ENV !== 'test') {
    try {
      const redis = getRedis();
      await redis.incrbyfloat(key, cost);
      await redis.expire(key, 60 * 60 * 48);
    } catch {
      // The memory accumulator remains the fallback when Redis is unavailable.
    }
  }
  return cost;
}

export function resetAiBudgetForTests(): void {
  memorySpend.clear();
}
