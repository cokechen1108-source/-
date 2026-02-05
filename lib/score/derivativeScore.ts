import { Trade } from '../../types/leaderboard';

export function computeDerivativeScoreForCreator(trades: Trade[]): number {
  if (trades.length === 0) return 0;

  const totalPnl = trades.reduce((sum, t) => sum + t.pnlUSD, 0);

  // Reward consistency: average pnl plus a small bonus for trade count
  const avgPnl = totalPnl / trades.length;
  const activityBonus = Math.log(trades.length + 1); // smooth growth

  return avgPnl + activityBonus * 5;
}

export function sumPnl(trades: Trade[]): number {
  return trades.reduce((sum, t) => sum + t.pnlUSD, 0);
}
