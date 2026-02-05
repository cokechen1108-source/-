import { mockCreators, MockCreator } from '../mock/mockCreators';

/* =========================
   类型定义
========================= */

export interface ContentBreakdown {
  originalityScore: number;
  insightScore: number;
  engagementQualityScore: number;
  minaraAffinityScore: number;
  totalContentScore: number;
}

export interface LeaderboardEntry {
  id: string;
  handle: string;
  followers: number;
  tweetsCount: number;
  contentScore: number;
  contentBreakdown: ContentBreakdown;
  derivativeScore: number;
  totalScore: number;
}

export interface LeaderboardResponse {
  updatedAt: string;
  entries: LeaderboardEntry[];
}

/* =========================
   Content Score 计算
========================= */

function calculateContentScore(creator: MockCreator): ContentBreakdown {
  const tweets = creator.tweets;
  const total = tweets.length;

  const originalTweets = tweets.filter(t => !t.isRetweet);
  const originalityScore = total === 0 ? 0 : (originalTweets.length / total) * 100;

  const insightScore =
    originalTweets.reduce((sum, t) => {
      let score = 0;
      if (t.text.length > 60) score += 20;
      if (t.text.includes('为什么') || t.text.includes('thesis')) score += 30;
      if (t.text.includes('narrative') || t.text.includes('世界观')) score += 30;
      return sum + Math.min(score, 100);
    }, 0) / Math.max(originalTweets.length, 1);

  const engagementQualityScore =
    originalTweets.reduce((sum, t) => sum + (t.likes + t.replies * 2 + t.retweets * 3), 0) > 200
      ? 100
      : 20;

  const minaraAffinityScore =
    tweets.filter(t => t.text.toLowerCase().includes('minara')).length > 0
      ? 100
      : 0;

  const totalContentScore =
    originalityScore * 0.25 +
    insightScore * 0.35 +
    engagementQualityScore * 0.25 +
    minaraAffinityScore * 0.15;

  return {
    originalityScore: round(originalityScore),
    insightScore: round(insightScore),
    engagementQualityScore,
    minaraAffinityScore,
    totalContentScore: round(totalContentScore)
  };
}

/* =========================
   Derivative Score 计算
========================= */

function calculateDerivativeScore(creator: MockCreator): number {
  const originalTweets = creator.tweets.filter(t => !t.isRetweet);
  const totalRetweets = originalTweets.reduce((sum, t) => sum + t.retweets, 0);

  if (creator.followers === 0) return 0;

  const score = (totalRetweets / creator.followers) * 1000;
  return round(score);
}

/* =========================
   总分计算
========================= */

function calculateTotalScore(contentScore: number, derivativeScore: number): number {
  return round(contentScore * 0.6 + derivativeScore * 0.4);
}

/* =========================
   Leaderboard 主入口
========================= */

export function getLeaderboard(): LeaderboardResponse {
  const entries: LeaderboardEntry[] = mockCreators.map(creator => {
    const contentBreakdown = calculateContentScore(creator);
    const derivativeScore = calculateDerivativeScore(creator);
    const totalScore = calculateTotalScore(contentBreakdown.totalContentScore, derivativeScore);

    return {
      id: creator.id,
      handle: creator.handle,
      followers: creator.followers,
      tweetsCount: creator.tweets.length,
      contentScore: contentBreakdown.totalContentScore,
      contentBreakdown,
      derivativeScore,
      totalScore
    };
  });

  // 按总分降序排序
  entries.sort((a, b) => b.totalScore - a.totalScore);

  return {
    updatedAt: new Date().toISOString(),
    entries
  };
}

/* =========================
   Demo Helper
========================= */

export function getDemoLeaderboard(): LeaderboardEntry[] {
  const leaderboard = mockCreators.map(creator => {
    const contentBreakdown = calculateContentScore(creator);
    const derivativeScore = calculateDerivativeScore(creator);
    const totalScore = calculateTotalScore(contentBreakdown.totalContentScore, derivativeScore);

    return {
      id: creator.id,
      handle: creator.handle,
      followers: creator.followers,
      tweetsCount: creator.tweets.length,
      contentScore: contentBreakdown.totalContentScore,
      contentBreakdown,
      derivativeScore,
      totalScore
    };
  });

  leaderboard.sort((a, b) => b.totalScore - a.totalScore);
  return leaderboard;
}

/* =========================
   Utils
========================= */

function round(n: number, digits = 2): number {
  return Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits);
}
