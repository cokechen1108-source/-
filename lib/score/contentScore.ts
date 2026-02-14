import { ContentScoreBreakdown, Tweet } from '../../types/leaderboard';
import {
  estimateTextSentimentScore,
  detectSpamSignals,
  tokenize,
  jaccardSimilarity,
  matchKeywordSafe,
  computeBurstPenalty
} from '../utils/textAnalysis';

// Helper: clamp a number into [min, max]
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Helper: normalize a positive value into [0, 1] with a soft cap
function softNormalize(value: number, pivot: number): number {
  if (value <= 0) return 0;
  return clamp(Math.log1p(value) / Math.log1p(pivot), 0, 1);
}

// =====================================================
// Content Score v2 — 增强反垃圾 / 反刷分能力
// =====================================================

/**
 * 近似去重：使用 Jaccard 相似度检测模板化内容
 * 当新推文与已有任一推文的 Jaccard >= threshold 时视为近似重复
 */
const JACCARD_DUP_THRESHOLD = 0.7;

function isNearDuplicate(
  tokens: string[],
  seen: string[][],
  threshold: number = JACCARD_DUP_THRESHOLD
): boolean {
  for (const prev of seen) {
    if (jaccardSimilarity(tokens, prev) >= threshold) {
      return true;
    }
  }
  return false;
}

export function computeContentScoreForCreator(
  tweets: Tweet[]
): ContentScoreBreakdown {
  if (tweets.length === 0) {
    return {
      originalityScore: 0,
      insightScore: 0,
      engagementQualityScore: 0,
      minaraAffinityScore: 0,
      totalContentScore: 0,
      spamPenalty: 1,
      credibility: 1,
      finalMultiplier: 1,
      nonRetweetCoverage: 0,
      sampleFactor: 0,
      timeDecayAvg: 1,
      engagementCredibilityAvg: 1,
      pnlEvidenceScore: 0,
      pnlEvidenceCoverage: 0,
      effectiveTweetCount: 0
    };
  }

  // ========== Phase 0: 逐条推文 Spam 检测 ==========
  // 对每条推文标记 spam 概率，高于阈值的推文降权或排除
  const SPAM_THRESHOLD = 0.5; // spam score >= 0.5 视为垃圾推文

  const tweetMeta = tweets.map((t) => {
    const signals = detectSpamSignals(t.content);
    return {
      tweet: t,
      spamSignals: signals,
      isSpam: signals.spamScore >= SPAM_THRESHOLD,
      tokens: tokenize(t.content)
    };
  });

  // 有效推文 = 非垃圾推文
  const effectiveTweets = tweetMeta.filter((m) => !m.isSpam);
  const effectiveTweetCount = effectiveTweets.length;

  // 如果全部是垃圾推文，直接返回极低分
  if (effectiveTweetCount === 0) {
    return {
      originalityScore: 0,
      insightScore: 0,
      engagementQualityScore: 0,
      minaraAffinityScore: 0,
      totalContentScore: 0,
      spamPenalty: 0,
      credibility: 1,
      finalMultiplier: 0,
      nonRetweetCoverage: 0,
      sampleFactor: 0,
      timeDecayAvg: 1,
      engagementCredibilityAvg: 1,
      pnlEvidenceScore: 0,
      pnlEvidenceCoverage: 0,
      effectiveTweetCount: 0
    };
  }

  // 垃圾推文比例 → spam 惩罚系数
  const spamRatio = 1 - effectiveTweetCount / tweets.length;
  // 当垃圾推文占比较高时，整体得分打折
  // 0% spam → penalty=1, 50% spam → penalty≈0.65, 100% → penalty=0
  const spamPenalty = Math.max(0, 1 - spamRatio * 0.7);

  // ========== Phase 1: Originality（近似去重） ==========
  const seenTokenSets: string[][] = [];
  let originalCount = 0;

  for (const meta of effectiveTweets) {
    const normalized = meta.tweet.content.trim();
    const isRetweet =
      normalized.startsWith('RT ') ||
      normalized.startsWith('rt ') ||
      normalized.startsWith('转发');

    if (isRetweet) continue;

    // 近似去重：Jaccard 相似度
    if (isNearDuplicate(meta.tokens, seenTokenSets)) {
      continue;
    }

    originalCount += 1;
    seenTokenSets.push(meta.tokens);
  }

  const originalityRatio = originalCount / effectiveTweetCount;
  const originalityScore = clamp(originalityRatio * 100, 0, 100);

  // ========== Phase 2: Insight（信息密度） ==========
  const opinionKeywords = [
    '觉得',
    '认为',
    '感觉',
    '我看',
    '看好',
    '看空',
    '观点',
    '判断',
    '逻辑',
    'i think',
    'imo',
    'in my opinion',
    'my view',
    'thesis',
    'setup',
    'plan',
    'risk'
  ];

  let insightAccum = 0;

  for (const meta of effectiveTweets) {
    const text = meta.tweet.content.trim();
    const lower = text.toLowerCase();

    // 文本长度得分：140 字为满分参考
    const lenScore = clamp(text.length / 140, 0, 1);

    // 观点关键词
    const hasOpinion = opinionKeywords.some((kw) => lower.includes(kw));
    const opinionScore = hasOpinion ? 1 : 0;

    // 情绪得分
    const sentiment = estimateTextSentimentScore(text);
    const sentimentScore = (sentiment + 3) / 6;

    // [新增] 内容丰富度加成：token 多样性
    const uniqueTokens = new Set(meta.tokens);
    const diversityRatio =
      meta.tokens.length === 0 ? 0 : uniqueTokens.size / meta.tokens.length;
    const diversityScore = clamp(diversityRatio, 0, 1);

    const perTweetInsight =
      lenScore * 0.4 +
      opinionScore * 0.25 +
      sentimentScore * 0.15 +
      diversityScore * 0.2;

    insightAccum += clamp(perTweetInsight, 0, 1);
  }

  const avgInsight = insightAccum / effectiveTweetCount;
  const insightScore = clamp(avgInsight * 100, 0, 100);

  // ========== Phase 3: Engagement Quality ==========
  // [优化] 互动为零的推文不再贡献正分
  let engagementAccum = 0;

  for (const meta of effectiveTweets) {
    const t = meta.tweet;
    const rawEngagement =
      0.5 * t.likes + 1.5 * t.retweets + 2 * t.replies;

    // 互动为零 → 直接跳过（不贡献分数，但参与平均分母）
    if (rawEngagement === 0) continue;

    const perTweetEngagement = softNormalize(rawEngagement, 200);
    engagementAccum += perTweetEngagement;
  }

  const avgEngagement = engagementAccum / effectiveTweetCount;
  const engagementQualityScore = clamp(avgEngagement * 100, 0, 100);

  // ========== Phase 4: Minara Affinity ==========
  // [修复] 使用安全全词匹配，避免 "ip" 误中 "tip"、"drip" 等
  const minaraKeywords = [
    'minara',
    '米娜拉',
    'fan art',
    '二创',
    '衍生创作',
    '同人'
  ];
  // 注意：移除了单独的 "ip"，因为太容易误匹配

  let affinityHits = 0;

  for (const meta of effectiveTweets) {
    const text = meta.tweet.content;
    if (minaraKeywords.some((kw) => matchKeywordSafe(text, kw))) {
      affinityHits += 1;
    }
  }

  const affinityRatio = affinityHits / effectiveTweetCount;
  const minaraAffinityScore = clamp(affinityRatio * 100, 0, 100);

  // ========== Phase 5: Burst Penalty（发帖频率惩罚） ==========
  const timestamps = tweets.map((t) => t.createdAt).filter(Boolean);
  const burstPenalty = computeBurstPenalty(timestamps, 30, 5);

  // ========== Final: 加权汇总 × 惩罚系数 ==========
  const rawTotal =
    originalityScore * 0.25 +
    insightScore * 0.25 +
    engagementQualityScore * 0.3 +
    minaraAffinityScore * 0.2;

  // 总分 = 原始加权分 × spam惩罚 × 频率惩罚
  const totalContentScore = rawTotal * spamPenalty * burstPenalty;

  return {
    originalityScore: Number(originalityScore.toFixed(2)),
    insightScore: Number(insightScore.toFixed(2)),
    engagementQualityScore: Number(engagementQualityScore.toFixed(2)),
    minaraAffinityScore: Number(minaraAffinityScore.toFixed(2)),
    totalContentScore: Number(totalContentScore.toFixed(2)),
    spamPenalty: Number(spamPenalty.toFixed(4)),
    credibility: Number(burstPenalty.toFixed(4)),
    finalMultiplier: Number((spamPenalty * burstPenalty).toFixed(4)),
    nonRetweetCoverage: Number((effectiveTweetCount / tweets.length).toFixed(4)),
    sampleFactor: Number(Math.min(1, effectiveTweetCount / 5).toFixed(4)),
    timeDecayAvg: 1,
    engagementCredibilityAvg: 1,
    pnlEvidenceScore: 0,
    pnlEvidenceCoverage: 0,
    effectiveTweetCount
  };
}
