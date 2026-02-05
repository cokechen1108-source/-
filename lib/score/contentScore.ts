import { ContentScoreBreakdown, Tweet } from '../../types/leaderboard';
import { estimateTextSentimentScore } from '../utils/textAnalysis';

// Helper: clamp a number into [min, max]
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Helper: normalize a positive value into [0, 1] with a soft cap
function softNormalize(value: number, pivot: number): number {
  if (value <= 0) return 0;
  // Use log to reduce the impact of outliers
  return clamp(Math.log1p(value) / Math.log1p(pivot), 0, 1);
}

// Very lightweight rule-based approximation of Minara-like content signals.

export function computeContentScoreForCreator(
  tweets: Tweet[]
): ContentScoreBreakdown {
  if (tweets.length === 0) {
    return {
      originalityScore: 0,
      insightScore: 0,
      engagementQualityScore: 0,
      minaraAffinityScore: 0,
      totalContentScore: 0
    };
  }

  // ----- Originality: 非转推、非重复 -----
  const seenTexts = new Set<string>();
  let originalCount = 0;

  for (const t of tweets) {
    const normalized = t.content.trim();
    const isRetweet =
      normalized.startsWith('RT ') ||
      normalized.startsWith('rt ') ||
      normalized.startsWith('转发');

    const key = normalized.toLowerCase();
    const isDuplicate = seenTexts.has(key);

    if (!isRetweet && !isDuplicate) {
      originalCount += 1;
    }

    seenTexts.add(key);
  }

  const originalityRatio = originalCount / tweets.length;
  const originalityScore = clamp(originalityRatio * 100, 0, 100);

  // ----- Insight: 信息密度（长度 + 观点词 + 情绪） -----
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

  for (const t of tweets) {
    const text = t.content.trim();
    const lower = text.toLowerCase();

    const lenScore = clamp(text.length / 140, 0, 1); // 140 字左右视为信息较密
    const hasOpinion = opinionKeywords.some((kw) => lower.includes(kw));
    const opinionScore = hasOpinion ? 1 : 0;

    const sentiment = estimateTextSentimentScore(text); // [-3,3]
    const sentimentScore = (sentiment + 3) / 6; // 映射到 [0,1]

    const perTweetInsight =
      lenScore * 0.5 + opinionScore * 0.3 + sentimentScore * 0.2;

    insightAccum += clamp(perTweetInsight, 0, 1);
  }

  const avgInsight = insightAccum / tweets.length;
  const insightScore = clamp(avgInsight * 100, 0, 100);

  // ----- Engagement Quality: 互动质量（reply / like / retweet 加权） -----
  let engagementAccum = 0;

  for (const t of tweets) {
    const rawEngagement =
      0.5 * t.likes + 1.5 * t.retweets + 2 * t.replies; // 回复权重最高

    const perTweetEngagement = softNormalize(rawEngagement, 200); // 200 视为上限附近
    engagementAccum += perTweetEngagement;
  }

  const avgEngagement = engagementAccum / tweets.length;
  const engagementQualityScore = clamp(avgEngagement * 100, 0, 100);

  // ----- Minara Affinity: 是否提到 Minara / IP / fan art 等 -----
  const minaraKeywords = [
    'minara',
    '米娜拉',
    'ip',
    'fan art',
    '二创',
    '衍生创作',
    '同人'
  ];

  let affinityHits = 0;

  for (const t of tweets) {
    const lower = t.content.toLowerCase();
    if (minaraKeywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      affinityHits += 1;
    }
  }

  const affinityRatio = affinityHits / tweets.length;
  const minaraAffinityScore = clamp(affinityRatio * 100, 0, 100);

  // ----- Total: 四个维度加权求和 -----
  const totalContentScore =
    originalityScore * 0.25 +
    insightScore * 0.25 +
    engagementQualityScore * 0.3 +
    minaraAffinityScore * 0.2;

  return {
    originalityScore: Number(originalityScore.toFixed(2)),
    insightScore: Number(insightScore.toFixed(2)),
    engagementQualityScore: Number(engagementQualityScore.toFixed(2)),
    minaraAffinityScore: Number(minaraAffinityScore.toFixed(2)),
    totalContentScore: Number(totalContentScore.toFixed(2))
  };
}
