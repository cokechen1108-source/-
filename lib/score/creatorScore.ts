import { mockCreators, MockCreator } from '../mock/mockCreators';
import type { ContentScoreBreakdown, CreatorScoreBreakdown, LeaderboardResponse } from '../../types/leaderboard';
import {
  detectSpamSignals,
  tokenize,
  jaccardSimilarity,
} from '../utils/textAnalysis';
import { DEPTH_KEYWORDS } from './keywordConfig';

/* =========================
   常量配置
========================= */

const JACCARD_DUP_THRESHOLD = 0.7;    // 近似去重阈值
const FOLLOWER_CREDIBILITY_PIVOT = 5000; // 粉丝可信度 soft cap
const SAMPLE_SMOOTH_N0 = 5; // 小样本平滑阈值
const HALF_LIFE_DAYS = 30; // 时间衰减半衰期

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

  // ---------- Phase 0: 逐条软惩罚元信息 ----------
  const tweetMeta = tweets.map(t => {
    const signals = detectSpamSignals(t.text);
    const tokens = tokenize(t.text);
    const spamWeight = Math.max(0, 1 - signals.spamScore);
    const timeWeight = computeTimeDecayWeight(t.createdAt, HALF_LIFE_DAYS);
    const topicalHit = hasMinaraMentionInTweet(t);
    return { tweet: t, signals, tokens, spamWeight, timeWeight, topicalHit };
  });

  // 硬门槛：仅正文包含 Minara 字样的原创推文参与评分
  const nonRTEffective = tweetMeta.filter(m => !m.tweet.isRetweet && m.topicalHit);
  const effectiveTweetCount = nonRTEffective.length;

  if (effectiveTweetCount === 0) {
    const credibilityOnly = round(
      0.3 + 0.7 * Math.min(1, Math.log1p(creator.followers) / Math.log1p(FOLLOWER_CREDIBILITY_PIVOT)),
      4
    );
    return {
      originalityScore: 0,
      insightScore: 0,
      engagementQualityScore: 0,
      minaraAffinityScore: 0,
      totalContentScore: 0,
      spamPenalty: 0,
      credibility: credibilityOnly,
      finalMultiplier: 0,
      nonRetweetCoverage: 0,
      sampleFactor: 0,
      timeDecayAvg: round(avg(tweetMeta.map(m => m.timeWeight)), 4),
      engagementCredibilityAvg: 0,
      pnlEvidenceScore: 0,
      pnlEvidenceCoverage: 0,
      effectiveTweetCount: 0
    };
  }

  const weightSum = nonRTEffective.reduce((sum, m) => sum + getBaseWeight(m), 0);
  const spamPenalty = round(avg(tweetMeta.map(m => m.spamWeight)), 4);
  const timeDecayAvg = round(avg(nonRTEffective.map(m => m.timeWeight)), 4);
  const nonRetweetCoverage = round(effectiveTweetCount / total, 4);

  // ---------- Phase 1: Originality（近似去重） ----------
  const seenTokenSets: string[][] = [];
  let originalityWeight = 0;

  for (const meta of nonRTEffective) {
    let isDup = false;
    for (const prev of seenTokenSets) {
      if (jaccardSimilarity(meta.tokens, prev) >= JACCARD_DUP_THRESHOLD) {
        isDup = true;
        break;
      }
    }
    if (isDup) continue;

    originalityWeight += getBaseWeight(meta);
    seenTokenSets.push(meta.tokens);
  }

  const originalityScore = weightSum === 0 ? 0 : (originalityWeight / weightSum) * 100;

  // ---------- Phase 2: Insight（信息密度） ----------
  const insightWeighted = nonRTEffective.reduce((sum, meta) => {
      const perTweetDepth = computeDepthScoreContinuous(
        meta.tweet.text,
        meta.tokens,
        meta.tweet.mediaInsights
      );
      return sum + perTweetDepth * getBaseWeight(meta);
    }, 0);
  const insightScore = weightSum === 0 ? 0 : insightWeighted / weightSum;

  // ---------- Phase 3: Engagement Quality（连续化） ----------
  let engagementAccum = 0;
  let engagementCredibilityAccum = 0;

  for (const meta of nonRTEffective) {
    const t = meta.tweet;
    const quoteCount = t.quoteCount ?? 0;
    const viewCount = t.viewCount ?? 0;
    const raw = t.likes + t.replies * 2 + t.retweets * 3 + quoteCount * 2.5;

    const interactionOnly = Math.min(1, Math.log1p(raw) / Math.log1p(300));
    const viewSignal = computeViewSignal(viewCount, creator.followers);
    const normalized = viewCount > 0
      ? Math.min(1, interactionOnly * 0.92 + viewSignal * 0.08)
      : interactionOnly;
    const viewCredibility = computeViewCredibility(raw, viewCount);
    const interactionCredibility = computeInteractionCredibility(raw, creator.followers) * viewCredibility;
    engagementCredibilityAccum += interactionCredibility * getBaseWeight(meta);
    engagementAccum += normalized * interactionCredibility * getBaseWeight(meta);
  }

  const engagementQualityScore = weightSum === 0 ? 0 : Math.min(100, (engagementAccum / weightSum) * 100);
  const engagementCredibilityAvg = round(weightSum === 0 ? 0 : engagementCredibilityAccum / weightSum, 4);

  // ---------- Phase 4: Influence（真实传播影响力） ----------
  const affinityWeighted = nonRTEffective.reduce((sum, meta) => {
    const perTweetInfluence = computeInfluenceScoreContinuous(
      meta.tweet,
      creator.followers,
      meta.tweet.mediaInsights
    );
    return sum + perTweetInfluence * getBaseWeight(meta);
  }, 0);
  const influenceRaw = weightSum === 0 ? 0 : affinityWeighted / weightSum;
  const influenceConfidence = effectiveTweetCount / (effectiveTweetCount + 2);
  const minaraAffinityScore =
    (influenceRaw * influenceConfidence + 0.25 * (1 - influenceConfidence)) * 100;

  // ---------- Phase 4.5: PNL截图证据维度 ----------
  const pnlEvidenceWeighted = nonRTEffective.reduce((sum, meta) => {
    const pnlScore = meta.tweet.mediaInsights?.pnlEvidenceScore ?? 0;
    return sum + pnlScore * getBaseWeight(meta);
  }, 0);
  const pnlEvidenceCoverageWeighted = nonRTEffective.reduce((sum, meta) => {
    const hasEvidence = (meta.tweet.mediaInsights?.pnlBucket ?? 'none') !== 'none' ? 1 : 0;
    return sum + hasEvidence * getBaseWeight(meta);
  }, 0);
  const pnlEvidenceScore = weightSum === 0 ? 0 : pnlEvidenceWeighted / weightSum;
  const pnlEvidenceCoverage = weightSum === 0 ? 0 : pnlEvidenceCoverageWeighted / weightSum;

  // ---------- Phase 5: 可信度 + 小样本参考 + 频率 ----------
  const credibility = 0.3 + 0.7 * Math.min(1, Math.log1p(creator.followers) / Math.log1p(FOLLOWER_CREDIBILITY_PIVOT));
  const sampleFactor = Math.min(1, effectiveTweetCount / SAMPLE_SMOOTH_N0);
  const burstPenalty = computeBurstPenaltyFromCreator(creator);

  const rawTotal =
    originalityScore * 0.25 +
    insightScore * 0.35 +
    engagementQualityScore * 0.25 +
    minaraAffinityScore * 0.15;

  // 为保持单条推文理论上限可达100，sampleFactor仅作为展示参考，不再直接限幅总分
  const finalMultiplier = spamPenalty * credibility * burstPenalty;
  const totalContentScore = round(rawTotal * finalMultiplier);

  return {
    originalityScore: round(originalityScore),
    insightScore: round(insightScore),
    engagementQualityScore: round(engagementQualityScore),
    minaraAffinityScore: round(minaraAffinityScore),
    totalContentScore,
    spamPenalty,
    credibility: round(credibility, 4),
    finalMultiplier: round(finalMultiplier, 4),
    nonRetweetCoverage,
    sampleFactor: round(sampleFactor, 4),
    timeDecayAvg,
    engagementCredibilityAvg,
    pnlEvidenceScore: round(pnlEvidenceScore, 2),
    pnlEvidenceCoverage: round(pnlEvidenceCoverage, 4),
    effectiveTweetCount
  };
}

/* =========================
   Derivative Score 计算
========================= */

function calculateDerivativeScore(creator: MockCreator): number {
  // 与内容分保持一致：衍生分仅统计包含 Minara 字样的原创推文
  const originalTweets = creator.tweets.filter(t => !t.isRetweet && hasMinaraMentionInTweet(t));
  const totalRetweets = originalTweets.reduce((sum, t) => sum + t.retweets, 0);
  const totalReplies = originalTweets.reduce((sum, t) => sum + t.replies, 0);
  const totalQuotes = originalTweets.reduce((sum, t) => sum + (t.quoteCount ?? 0), 0);

  if (creator.followers === 0) return 0;
  if (originalTweets.length === 0) return 0;

  const retweetSignal = softNormalize((totalRetweets / creator.followers) * 1000, 120);
  const replySignal = softNormalize((totalReplies / creator.followers) * 1000, 60);
  const quoteSignal = softNormalize((totalQuotes / creator.followers) * 1000, 40);
  const score = (retweetSignal * 0.5 + replySignal * 0.3 + quoteSignal * 0.2) * 100;
  return round(score, 2);
}

/* =========================
   总分计算
========================= */

function calculateTotalScore(
  contentScore: number,
  derivativeScore: number,
  pnlEvidenceScore: number,
  pnlEvidenceCoverage: number,
  topicalRelevanceScore: number
): number {
  // 硬门槛：无 Minara 字样，直接 0 分
  if (topicalRelevanceScore <= 0) return 0;
  const baseScore = contentScore * 0.6 + derivativeScore * 0.4;
  const topicalMultiplier = computeTopicalRelevanceMultiplier(topicalRelevanceScore);

  // 仅在有PNL截图证据时注入第三维，避免无截图用户被硬性惩罚
  if (pnlEvidenceCoverage <= 0) {
    return round(baseScore * topicalMultiplier);
  }

  const pnlWeight = Math.min(0.12, 0.06 + 0.06 * pnlEvidenceCoverage);
  return round((baseScore * (1 - pnlWeight) + pnlEvidenceScore * pnlWeight) * topicalMultiplier);
}

function calculateActivityScore(tweetsCount: number, finalMultiplier: number): number {
  // 活跃度：发帖频率（最多按 5 条计满）× 质量乘数
  const volumeScore = Math.min(100, tweetsCount * 20);
  return round(volumeScore * finalMultiplier);
}

/* =========================
   Leaderboard 主入口
========================= */

export function getLeaderboard(): LeaderboardResponse {
  return buildLeaderboardFromCreators(mockCreators);
}

export function buildLeaderboardFromCreators(creators: MockCreator[]): LeaderboardResponse {
  const entries: CreatorScoreBreakdown[] = creators.map(creator => {
    const contentBreakdown = calculateContentScore(creator);
    const derivativeScore = calculateDerivativeScore(creator);
    const topicalRelevanceScore = computeTopicalRelevanceScore(creator);
    const totalScore = calculateTotalScore(
      contentBreakdown.totalContentScore,
      derivativeScore,
      contentBreakdown.pnlEvidenceScore,
      contentBreakdown.pnlEvidenceCoverage,
      topicalRelevanceScore
    );

    return {
      creatorId: creator.id,
      creatorName: creator.handle,
      handle: creator.handle,
      ...(creator.profileImageUrl ? { profileImageUrl: creator.profileImageUrl } : {}),
      followers: creator.followers,
      contentScore: contentBreakdown.totalContentScore,
      depthScore: contentBreakdown.insightScore,
      engagementScore: contentBreakdown.engagementQualityScore,
      influenceScore: contentBreakdown.minaraAffinityScore,
      activityScore: calculateActivityScore(creator.tweets.length, contentBreakdown.finalMultiplier),
      pnlEvidenceScore: contentBreakdown.pnlEvidenceScore,
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
    const topicalRelevanceScore = computeTopicalRelevanceScore(creator);
    const totalScore = calculateTotalScore(
      contentBreakdown.totalContentScore,
      derivativeScore,
      contentBreakdown.pnlEvidenceScore,
      contentBreakdown.pnlEvidenceCoverage,
      topicalRelevanceScore
    );

    return {
      creatorId: creator.id,
      creatorName: creator.handle,
      handle: creator.handle,
      ...(creator.profileImageUrl ? { profileImageUrl: creator.profileImageUrl } : {}),
      followers: creator.followers,
      contentScore: contentBreakdown.totalContentScore,
      depthScore: contentBreakdown.insightScore,
      engagementScore: contentBreakdown.engagementQualityScore,
      influenceScore: contentBreakdown.minaraAffinityScore,
      activityScore: calculateActivityScore(creator.tweets.length, contentBreakdown.finalMultiplier),
      pnlEvidenceScore: contentBreakdown.pnlEvidenceScore,
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

function softNormalize(value: number, pivot: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(pivot));
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.toLowerCase().includes(kw.toLowerCase()));
}

function computeDepthScoreContinuous(
  text: string,
  tokens: string[],
  mediaInsights?: {
    mediaDepthBoost: number;
    mediaTags: string[];
    ocrSummary?: string;
  }
): number {
  const normalizedLength = softNormalize(text.length, 220);
  const uniqueTokens = new Set(tokens);
  const diversity = tokens.length === 0 ? 0 : uniqueTokens.size / tokens.length;

  const thesisHit = hasAnyKeyword(text, DEPTH_KEYWORDS.thesis) ? 1 : 0;
  const narrativeHit = hasAnyKeyword(text, DEPTH_KEYWORDS.narrative) ? 1 : 0;
  const logicHit = hasAnyKeyword(text, DEPTH_KEYWORDS.logic) ? 1 : 0;
  const threadHit = hasAnyKeyword(text, DEPTH_KEYWORDS.thread) ? 1 : 0;

  const semanticDensity =
    (thesisHit + narrativeHit + logicHit + threadHit) /
    Math.max(1, Math.sqrt(Math.max(tokens.length, 1)));
  const densityNorm = Math.min(1, semanticDensity * 1.6);

  const mediaBoost = mediaInsights?.mediaDepthBoost ?? 0;
  const hasImageText = (mediaInsights?.ocrSummary?.length ?? 0) > 20 ? 1 : 0;
  const hasDataTag = mediaInsights?.mediaTags?.includes('data_snapshot') ? 1 : 0;

  const depthNorm =
    normalizedLength * 0.25 +
    thesisHit * 0.22 +
    narrativeHit * 0.2 +
    logicHit * 0.15 +
    threadHit * 0.08 +
    Math.min(1, diversity) * 0.18 +
    densityNorm * 0.12 +
    hasImageText * 0.06 +
    hasDataTag * 0.05 +
    mediaBoost * 0.1;

  return Math.min(100, Math.max(0, depthNorm * 100));
}

function computeInfluenceScoreContinuous(
  tweet: { likes: number; replies: number; retweets: number; quoteCount?: number; viewCount?: number },
  followers: number,
  mediaInsights?: {
    mediaInfluenceBoost: number;
    mediaTags: string[];
  }
): number {
  const quotes = tweet.quoteCount ?? 0;
  const viewCount = tweet.viewCount ?? 0;
  const rawEngagement = tweet.likes + tweet.replies * 2 + tweet.retweets * 3 + quotes * 2.5;

  // 传播覆盖：绝对互动规模（防止大V无限放大，采用log归一化）
  const reachSignal = softNormalize(rawEngagement, 800);
  // 对话带动：回复 + 引用，体现“引发讨论”能力
  const conversationSignal = softNormalize(tweet.replies + quotes * 1.5, 120);
  // 再传播：转推 + 引用，体现“扩散”能力
  const reshareSignal = softNormalize(tweet.retweets + quotes, 180);
  // 粉丝穿透：每粉丝互动效率，避免只看粉丝体量
  const perFollower = followers > 0 ? (rawEngagement / followers) * 1000 : 0;
  const penetrationSignal = softNormalize(perFollower, 30);
  // 阅读补充信号：低权重，防止仅靠高曝光刷分
  const viewSignal = computeViewSignal(viewCount, followers) * computeViewCredibility(rawEngagement, viewCount);

  const mediaBoost = mediaInsights?.mediaInfluenceBoost ?? 0;
  const fanartBoost = mediaInsights?.mediaTags?.includes('fanart') ? 0.06 : 0;

  const influenceNorm =
    reachSignal * 0.33 +
    conversationSignal * 0.24 +
    reshareSignal * 0.24 +
    penetrationSignal * 0.11 +
    viewSignal * 0.08 +
    mediaBoost * 0.08 +
    fanartBoost;
  return Math.max(0, Math.min(1, influenceNorm));
}

function computeTimeDecayWeight(createdAt?: string, halfLifeDays = HALF_LIFE_DAYS): number {
  if (!createdAt) return 1;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return 1;

  const now = Date.now();
  const ageDays = Math.max(0, (now - createdMs) / (1000 * 60 * 60 * 24));
  const lambda = Math.log(2) / Math.max(halfLifeDays, 1);
  return Math.exp(-lambda * ageDays);
}

function computeInteractionCredibility(rawEngagement: number, followers: number): number {
  if (rawEngagement <= 0) return 1;
  const baseline = Math.max(20, Math.sqrt(Math.max(1, followers)) * 6);
  const anomalyRatio = rawEngagement / baseline;
  if (anomalyRatio <= 1) return 1;
  return Math.max(0.25, 1 / Math.sqrt(anomalyRatio));
}

function computeViewSignal(viewCount: number, followers: number): number {
  if (viewCount <= 0) return 0;
  const reachSignal = softNormalize(viewCount, 12000);
  const perFollowerViews = followers > 0 ? (viewCount / followers) * 1000 : 0;
  const penetrationSignal = softNormalize(perFollowerViews, 300);
  return reachSignal * 0.55 + penetrationSignal * 0.45;
}

function computeViewCredibility(rawEngagement: number, viewCount: number): number {
  if (viewCount <= 0) return 1;
  const engagementRate = rawEngagement / Math.max(1, viewCount);
  if (engagementRate >= 0.012) return 1;
  if (engagementRate >= 0.004) {
    return 0.85 + ((engagementRate - 0.004) / 0.008) * 0.15;
  }
  if (engagementRate >= 0.001) {
    return 0.7 + ((engagementRate - 0.001) / 0.003) * 0.15;
  }
  return 0.6;
}

function getBaseWeight(meta: { spamWeight: number; timeWeight: number }): number {
  return Math.max(0.05, meta.spamWeight) * Math.max(0.2, meta.timeWeight);
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeBurstPenaltyFromCreator(creator: MockCreator): number {
  const timestamps = creator.tweets
    .map((tweet) => tweet.createdAt)
    .filter((value): value is string => Boolean(value));

  if (timestamps.length <= 5) return 1;

  const sorted = timestamps.map((value) => new Date(value).getTime()).sort((a, b) => a - b);
  const windowMs = 30 * 60 * 1000;
  let maxBurst = 0;

  for (let i = 0; i < sorted.length; i++) {
    let count = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j] - sorted[i] <= windowMs) count++;
      else break;
    }
    if (count > maxBurst) maxBurst = count;
  }

  if (maxBurst <= 5) return 1;
  return Math.max(0.35, 5 / maxBurst);
}

function computeTopicalRelevanceScore(creator: MockCreator): number {
  const nonRetweets = creator.tweets.filter((tweet) => !tweet.isRetweet);
  if (nonRetweets.length === 0) return 0;

  const hits = nonRetweets.reduce((sum, tweet) => {
    return sum + (hasMinaraMentionInTweet(tweet) ? 1 : 0);
  }, 0);

  return hits / nonRetweets.length;
}

function computeTopicalRelevanceMultiplier(topicalRelevanceScore: number): number {
  const score = Math.max(0, Math.min(1, topicalRelevanceScore));
  return score;
}

function hasMinaraMention(text: string): boolean {
  const lower = text.toLowerCase();
  // 按用户要求：只要包含 minara 字样即可（含 MinaraAI 等拼接形式），并支持中文“米娜拉”
  return lower.includes('minara') || text.includes('米娜拉');
}

function hasMinaraMentionInTweet(tweet: {
  text: string;
  mediaInsights?: { ocrSummary: string; altTextSummary: string };
}): boolean {
  if (hasMinaraMention(tweet.text)) return true;
  const ocrSummary = tweet.mediaInsights?.ocrSummary ?? '';
  const altTextSummary = tweet.mediaInsights?.altTextSummary ?? '';
  return hasMinaraMention(`${ocrSummary} ${altTextSummary}`);
}
