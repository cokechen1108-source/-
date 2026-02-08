import { mockCreators, MockCreator } from '../mock/mockCreators';
import type { ContentScoreBreakdown, CreatorScoreBreakdown, LeaderboardResponse } from '../../types/leaderboard';
import {
  detectSpamSignals,
  tokenize,
  jaccardSimilarity,
  matchKeywordSafe,
} from '../utils/textAnalysis';

/* =========================
   常量配置
========================= */

const SPAM_THRESHOLD = 0.5;           // 单条推文 spam score >= 此值视为垃圾
const JACCARD_DUP_THRESHOLD = 0.7;    // 近似去重阈值
const FOLLOWER_CREDIBILITY_PIVOT = 5000; // 粉丝可信度 soft cap

/* =========================
   Content Score 计算 (v2)
========================= */

function calculateContentScore(creator: MockCreator): ContentScoreBreakdown {
  const tweets = creator.tweets;
  const total = tweets.length;

  if (total === 0) {
    return {
      originalityScore: 0,
      insightScore: 0,
      engagementQualityScore: 0,
      minaraAffinityScore: 0,
      totalContentScore: 0,
      spamPenalty: 1,
      effectiveTweetCount: 0
    };
  }

  // ---------- Phase 0: 逐条 Spam 检测 ----------
  const tweetMeta = tweets.map(t => {
    const signals = detectSpamSignals(t.text);
    const tokens = tokenize(t.text);
    return { tweet: t, signals, isSpam: signals.spamScore >= SPAM_THRESHOLD, tokens };
  });

  const effectiveTweets = tweetMeta.filter(m => !m.isSpam);
  const effectiveTweetCount = effectiveTweets.length;

  if (effectiveTweetCount === 0) {
    return {
      originalityScore: 0,
      insightScore: 0,
      engagementQualityScore: 0,
      minaraAffinityScore: 0,
      totalContentScore: 0,
      spamPenalty: 0,
      effectiveTweetCount: 0
    };
  }

  // Spam 惩罚系数
  const spamRatio = 1 - effectiveTweetCount / total;
  const spamPenalty = Math.max(0, 1 - spamRatio * 0.7);

  // ---------- Phase 1: Originality（近似去重） ----------
  const seenTokenSets: string[][] = [];
  let originalCount = 0;

  for (const meta of effectiveTweets) {
    if (meta.tweet.isRetweet) continue;

    // 近似去重：Jaccard 相似度
    let isDup = false;
    for (const prev of seenTokenSets) {
      if (jaccardSimilarity(meta.tokens, prev) >= JACCARD_DUP_THRESHOLD) {
        isDup = true;
        break;
      }
    }
    if (isDup) continue;

    originalCount++;
    seenTokenSets.push(meta.tokens);
  }

  const originalityScore = effectiveTweetCount === 0
    ? 0
    : (originalCount / effectiveTweetCount) * 100;

  // ---------- Phase 2: Insight（信息密度） ----------
  const nonRTEffective = effectiveTweets.filter(m => !m.tweet.isRetweet);

  const insightScore =
    nonRTEffective.reduce((sum, meta) => {
      const t = meta.tweet;
      let score = 0;

      // 长度得分：长文更可能有深度
      if (t.text.length > 60) score += 20;
      if (t.text.length > 120) score += 10;

      // 观点 / 深度关键词
      if (t.text.includes('为什么') || t.text.includes('thesis')) score += 30;
      if (t.text.includes('narrative') || t.text.includes('世界观')) score += 30;
      if (t.text.includes('逻辑') || t.text.includes('analysis')) score += 15;
      if (t.text.includes('thread') || t.text.includes('🧵')) score += 15;

      // [新增] token 多样性加成
      const uniqueTokens = new Set(meta.tokens);
      const diversity = meta.tokens.length === 0 ? 0 : uniqueTokens.size / meta.tokens.length;
      if (diversity > 0.7) score += 10;

      return sum + Math.min(score, 100);
    }, 0) / Math.max(nonRTEffective.length, 1);

  // ---------- Phase 3: Engagement Quality（连续化） ----------
  // [修复] 从二元判断改为 soft normalize 连续评分
  let engagementAccum = 0;

  for (const meta of effectiveTweets) {
    if (meta.tweet.isRetweet) continue;
    const t = meta.tweet;
    const raw = t.likes + t.replies * 2 + t.retweets * 3;

    // 互动为零的推文不贡献正分
    if (raw === 0) continue;

    // soft normalize: log(1+x) / log(1+pivot)
    const normalized = Math.min(1, Math.log1p(raw) / Math.log1p(300));
    engagementAccum += normalized;
  }

  const engagementQualityScore =
    nonRTEffective.length === 0
      ? 0
      : Math.min(100, (engagementAccum / nonRTEffective.length) * 100);

  // ---------- Phase 4: Minara Affinity（安全匹配） ----------
  // [修复] 移除过于宽泛的 "ip"，使用全词匹配
  const minaraKeywords = ['minara', '米娜拉', 'fan art', '二创', '衍生创作', '同人'];

  const affinityHits = tweets.filter(t =>
    minaraKeywords.some(kw => matchKeywordSafe(t.text, kw))
  ).length;

  const minaraAffinityScore = affinityHits > 0
    ? Math.min(100, (affinityHits / total) * 100)
    : 0;

  // ---------- Phase 5: 可信度系数（基于粉丝数） ----------
  // 小号 / 新号打折，避免羊毛党批量注册
  // followers = 0 → 0.3, followers = 5000 → ~0.85, followers >> 5000 → ~1.0
  const credibility = 0.3 + 0.7 * Math.min(1, Math.log1p(creator.followers) / Math.log1p(FOLLOWER_CREDIBILITY_PIVOT));

  // ---------- Final: 加权汇总 × 惩罚 × 可信度 ----------
  const rawTotal =
    originalityScore * 0.25 +
    insightScore * 0.35 +
    engagementQualityScore * 0.25 +
    minaraAffinityScore * 0.15;

  const totalContentScore = round(rawTotal * spamPenalty * credibility);

  return {
    originalityScore: round(originalityScore),
    insightScore: round(insightScore),
    engagementQualityScore: round(engagementQualityScore),
    minaraAffinityScore: round(minaraAffinityScore),
    totalContentScore,
    spamPenalty: round(spamPenalty * credibility, 4),
    effectiveTweetCount
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
  const entries: CreatorScoreBreakdown[] = mockCreators.map(creator => {
    const contentBreakdown = calculateContentScore(creator);
    const derivativeScore = calculateDerivativeScore(creator);
    const totalScore = calculateTotalScore(contentBreakdown.totalContentScore, derivativeScore);

    return {
      creatorId: creator.id,
      creatorName: creator.handle,
      handle: creator.handle,
      contentScore: contentBreakdown.totalContentScore,
      contentBreakdown,
      derivativeScore,
      totalScore,
      tweetsCount: creator.tweets.length,
      tradesCount: 0,
      totalPnlUSD: 0
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

export function getDemoLeaderboard(): CreatorScoreBreakdown[] {
  const leaderboard: CreatorScoreBreakdown[] = mockCreators.map(creator => {
    const contentBreakdown = calculateContentScore(creator);
    const derivativeScore = calculateDerivativeScore(creator);
    const totalScore = calculateTotalScore(contentBreakdown.totalContentScore, derivativeScore);

    return {
      creatorId: creator.id,
      creatorName: creator.handle,
      handle: creator.handle,
      contentScore: contentBreakdown.totalContentScore,
      contentBreakdown,
      derivativeScore,
      totalScore,
      tweetsCount: creator.tweets.length,
      tradesCount: 0,
      totalPnlUSD: 0
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
