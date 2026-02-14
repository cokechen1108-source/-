import type { NextApiRequest, NextApiResponse } from 'next';

import { buildLeaderboardFromCreators } from '../../lib/score/creatorScore';
import type { MockCreator } from '../../lib/mock/mockCreators';
import type { LeaderboardResponse } from '../../types/leaderboard';
import { detectSpamSignals, tokenize } from '../../lib/utils/textAnalysis';
import { DEPTH_KEYWORDS, KEYWORD_CONFIG_VERSION } from '../../lib/score/keywordConfig';

type AnalyzeLinksResponse =
  | (LeaderboardResponse & {
      analysisMeta: AnalyzeMeta;
      creatorTweetDetails: Record<string, CreatorTweetDetail[]>;
    })
  | { error: string; details?: string };

interface AnalyzeMeta {
  totalSubmittedLinks: number;
  uniqueTweetIds: number;
  fetchedTweets: number;
  unresolvedLinks: number;
  groupedCreators: number;
  keywordConfigVersion: string;
  creatorCoverage: Array<{
    creatorId: string;
    handle: string;
    submittedLinks: number;
    fetchedTweets: number;
    coverage: number;
  }>;
}

interface CreatorTweetDetail {
  tweetId: string;
  text: string;
  createdAt?: string;
  likes: number;
  views: number;
  replies: number;
  retweets: number;
  quotes: number;
  rawEngagement: number;
  normalizedEngagement: number;
  isRetweet: boolean;
  influenceSignals: {
    reach: number;
    conversation: number;
    reshare: number;
    penetration: number;
  };
  mediaInsights: TweetMediaInsights;
  spamScore: number;
  tokenDiversity: number;
  depthSignals: string[];
}

interface TweetMediaInsights {
  hasMedia: boolean;
  mediaCount: number;
  imageCount: number;
  videoCount: number;
  altTextSummary: string;
  ocrSummary: string;
  mediaDepthBoost: number;
  mediaInfluenceBoost: number;
  mediaTags: string[];
  pnlUSD?: number;
  pnlBucket: 'none' | 'lt100' | '100_500' | '500_1000' | 'gte1000';
  pnlEvidenceScore: number;
  items: MediaInsightItem[];
}

interface MediaInsightItem {
  mediaKey: string;
  type: string;
  url: string;
  altText?: string;
  ocrText?: string;
  ocrConfidence?: number;
  width?: number;
  height?: number;
  note?: string;
}

interface TwitterUser {
  id: string;
  username: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count?: number;
  };
}

interface TwitterTweet {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  attachments?: {
    media_keys?: string[];
  };
  public_metrics?: {
    like_count?: number;
    impression_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
  };
}

interface TwitterLookupResponse {
  data?: TwitterTweet[];
  includes?: {
    users?: TwitterUser[];
    media?: TwitterMedia[];
  };
}

interface TwitterMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
}

interface LinkMeta {
  tweetId: string;
  inputHandle?: string;
}

const OCR_CACHE = new Map<string, { text: string; confidence: number }>();
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS ?? 8000);
const MAX_OCR_IMAGES_TOTAL_PER_REQUEST = Number(process.env.MAX_OCR_IMAGES_TOTAL_PER_REQUEST ?? 3);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyzeLinksResponse>
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const bearerToken = process.env.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    res.status(400).json({ error: '缺少 TWITTER_BEARER_TOKEN，请先配置 .env.local' });
    return;
  }

  const links = normalizeLinks(req.body?.links);
  if (links.length === 0) {
    res.status(400).json({ error: '请至少提供一个有效推文链接' });
    return;
  }

  const linkMetas = links
    .map(extractLinkMeta)
    .filter((meta): meta is LinkMeta => Boolean(meta?.tweetId));
  const tweetIds = Array.from(new Set(linkMetas.map((meta) => meta.tweetId)));
  if (tweetIds.length === 0) {
    res.status(400).json({ error: '未识别到有效推文 ID（需要 /status/<id>）' });
    return;
  }

  try {
    const lookup = await fetchTwitterTweets(tweetIds, bearerToken);
    const mediaInsightsByTweet = await buildMediaInsightsByTweet(lookup);
    const creators = mapLookupToCreators(lookup, mediaInsightsByTweet);
    const leaderboard = buildLeaderboardFromCreators(creators);
    const analysisMeta = buildAnalyzeMeta(links, linkMetas, lookup, creators);
    const creatorTweetDetails = buildCreatorTweetDetails(creators);
    res.status(200).json({
      ...leaderboard,
      analysisMeta,
      creatorTweetDetails
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    res.status(500).json({ error: '拉取推文失败', details: message });
  }
}

function normalizeLinks(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

function extractLinkMeta(link: string): LinkMeta | null {
  const match = link.match(
    /^https?:\/\/(?:x\.com|twitter\.com)\/([^/\s]+)\/status\/(\d+)(?:\?.*)?$/i
  );
  if (!match) return null;
  return {
    inputHandle: match[1]?.toLowerCase(),
    tweetId: match[2]
  };
}

async function fetchTwitterTweets(
  tweetIds: string[],
  bearerToken: string
): Promise<TwitterLookupResponse> {
  const chunks = chunk(tweetIds, 100);
  const allTweets: TwitterTweet[] = [];
  const usersById = new Map<string, TwitterUser>();
  const mediaByKey = new Map<string, TwitterMedia>();

  for (const ids of chunks) {
    const params = new URLSearchParams({
      ids: ids.join(','),
      expansions: 'author_id,attachments.media_keys',
      'tweet.fields': 'id,text,author_id,created_at,attachments,public_metrics',
      'user.fields': 'id,username,public_metrics,profile_image_url',
      'media.fields': 'media_key,type,url,preview_image_url,alt_text,width,height'
    });

    const response = await fetch(`https://api.twitter.com/2/tweets?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Twitter API ${response.status}: ${body}`);
    }

    const json = (await response.json()) as TwitterLookupResponse;
    allTweets.push(...(json.data ?? []));

    for (const user of json.includes?.users ?? []) {
      usersById.set(user.id, user);
    }
    for (const media of json.includes?.media ?? []) {
      mediaByKey.set(media.media_key, media);
    }
  }

  return {
    data: allTweets,
    includes: { users: Array.from(usersById.values()), media: Array.from(mediaByKey.values()) }
  };
}

function mapLookupToCreators(
  lookup: TwitterLookupResponse,
  mediaInsightsByTweet: Map<string, TweetMediaInsights>
): MockCreator[] {
  const usersById = new Map((lookup.includes?.users ?? []).map((u) => [u.id, u]));
  const grouped = new Map<string, MockCreator>();

  for (const tweet of lookup.data ?? []) {
    const author = usersById.get(tweet.author_id);
    if (!author) continue;

    const creatorId = author.id;
    if (!grouped.has(creatorId)) {
      grouped.set(creatorId, {
        id: creatorId,
        handle: `@${author.username}`,
        profileImageUrl: author.profile_image_url,
        followers: author.public_metrics?.followers_count ?? 0,
        tweets: []
      });
    }

    const creator = grouped.get(creatorId)!;
    creator.tweets.push({
      id: tweet.id,
      text: tweet.text,
      isRetweet: /^RT\s@/i.test(tweet.text),
      likes: tweet.public_metrics?.like_count ?? 0,
      viewCount: tweet.public_metrics?.impression_count ?? 0,
      replies: tweet.public_metrics?.reply_count ?? 0,
      retweets: tweet.public_metrics?.retweet_count ?? 0,
      quoteCount: tweet.public_metrics?.quote_count ?? 0,
      createdAt: tweet.created_at,
      mediaInsights: mediaInsightsByTweet.get(tweet.id) ?? getEmptyMediaInsights()
    });
  }

  return Array.from(grouped.values());
}

function buildAnalyzeMeta(
  links: string[],
  linkMetas: LinkMeta[],
  lookup: TwitterLookupResponse,
  creators: MockCreator[]
): AnalyzeMeta {
  const submittedByHandle = new Map<string, number>();
  for (const meta of linkMetas) {
    if (!meta.inputHandle) continue;
    submittedByHandle.set(meta.inputHandle, (submittedByHandle.get(meta.inputHandle) ?? 0) + 1);
  }

  const fetchedTweetIds = new Set((lookup.data ?? []).map((tweet) => tweet.id));
  const unresolvedLinks = linkMetas.filter((meta) => !fetchedTweetIds.has(meta.tweetId)).length;

  const creatorCoverage = creators
    .map((creator) => {
      const handle = creator.handle.replace(/^@/, '').toLowerCase();
      const submittedLinks = submittedByHandle.get(handle) ?? creator.tweets.length;
      const fetchedTweets = creator.tweets.length;
      const coverage =
        submittedLinks === 0 ? 1 : Math.min(1, fetchedTweets / Math.max(submittedLinks, 1));
      return {
        creatorId: creator.id,
        handle: creator.handle,
        submittedLinks,
        fetchedTweets,
        coverage: round(coverage, 4)
      };
    })
    .sort((a, b) => b.submittedLinks - a.submittedLinks);

  return {
    totalSubmittedLinks: links.length,
    uniqueTweetIds: new Set(linkMetas.map((meta) => meta.tweetId)).size,
    fetchedTweets: lookup.data?.length ?? 0,
    unresolvedLinks,
    groupedCreators: creators.length,
    keywordConfigVersion: KEYWORD_CONFIG_VERSION,
    creatorCoverage
  };
}

function buildCreatorTweetDetails(creators: MockCreator[]): Record<string, CreatorTweetDetail[]> {
  const detailsByCreator: Record<string, CreatorTweetDetail[]> = {};

  for (const creator of creators) {
    for (const tweet of creator.tweets) {
      const text = tweet.text;
      const tokens = tokenize(text);
      const uniqueTokens = new Set(tokens);
      const tokenDiversity = tokens.length === 0 ? 0 : uniqueTokens.size / tokens.length;
      const spam = detectSpamSignals(text);
      const quotes = tweet.quoteCount ?? 0;
      const views = tweet.viewCount ?? 0;
      const rawEngagement = tweet.likes + tweet.replies * 2 + tweet.retweets * 3 + quotes * 2.5;
      const interactionOnly = Math.min(1, Math.log1p(rawEngagement) / Math.log1p(300));
      const viewSignal = softNormalize(views, 12000);
      const normalizedEngagement = Math.min(
        1,
        views > 0 ? interactionOnly * 0.92 + viewSignal * 0.08 : interactionOnly
      );
      const depthSignals = detectDepthSignals(text, tokenDiversity);
      const mediaInsights = tweet.mediaInsights ?? getEmptyMediaInsights();
      const influenceSignals = computeInfluenceSignals(
        rawEngagement,
        tweet.replies,
        tweet.retweets,
        quotes,
        creator.followers
      );

    if (!detailsByCreator[creator.id]) {
      detailsByCreator[creator.id] = [];
    }

    detailsByCreator[creator.id].push({
      tweetId: tweet.id,
      text,
      createdAt: tweet.createdAt,
      likes: tweet.likes,
      views,
      replies: tweet.replies,
      retweets: tweet.retweets,
      quotes,
      rawEngagement: round(rawEngagement),
      normalizedEngagement: round(normalizedEngagement, 4),
      isRetweet: /^RT\s@/i.test(text),
      influenceSignals,
      mediaInsights,
      spamScore: round(spam.spamScore, 4),
      tokenDiversity: round(tokenDiversity, 4),
      depthSignals
    });
    }
  }

  for (const creatorId of Object.keys(detailsByCreator)) {
    detailsByCreator[creatorId].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  return detailsByCreator;
}

function detectDepthSignals(text: string, tokenDiversity: number): string[] {
  const signals: string[] = [];
  if (text.length > 60) signals.push('长度>60');
  if (text.length > 120) signals.push('长度>120');
  if (hasAnyKeyword(text, DEPTH_KEYWORDS.thesis)) signals.push('thesis/为什么');
  if (hasAnyKeyword(text, DEPTH_KEYWORDS.narrative)) signals.push('narrative/世界观');
  if (hasAnyKeyword(text, DEPTH_KEYWORDS.logic)) signals.push('逻辑/analysis');
  if (hasAnyKeyword(text, DEPTH_KEYWORDS.thread)) signals.push('thread');
  if (tokenDiversity > 0.7) signals.push('高词汇多样性');
  return signals;
}

async function buildMediaInsightsByTweet(
  lookup: TwitterLookupResponse
): Promise<Map<string, TweetMediaInsights>> {
  const mediaByKey = new Map((lookup.includes?.media ?? []).map((media) => [media.media_key, media]));
  const insightsByTweet = new Map<string, TweetMediaInsights>();
  const ocrBudget = { remaining: MAX_OCR_IMAGES_TOTAL_PER_REQUEST };

  for (const tweet of lookup.data ?? []) {
    const insights = await buildTweetMediaInsights(tweet, mediaByKey, ocrBudget);
    insightsByTweet.set(tweet.id, insights);
  }

  return insightsByTweet;
}

async function buildTweetMediaInsights(
  tweet: TwitterTweet,
  mediaByKey: Map<string, TwitterMedia>,
  ocrBudget: { remaining: number }
): Promise<TweetMediaInsights> {
  const mediaKeys = tweet.attachments?.media_keys ?? [];
  const mediaItems = mediaKeys
    .map((key) => mediaByKey.get(key))
    .filter((item): item is TwitterMedia => Boolean(item));

  if (mediaItems.length === 0) {
    return getEmptyMediaInsights();
  }

  const imageItems = mediaItems.filter((item) => item.type === 'photo');
  const videoItems = mediaItems.filter((item) => item.type !== 'photo');
  const ocrEnabled = process.env.ENABLE_IMAGE_OCR !== 'false';
  const maxImages = Number(process.env.MAX_OCR_IMAGES_PER_TWEET ?? 2);

  const items: MediaInsightItem[] = [];

  for (const media of mediaItems) {
    const url = media.url ?? media.preview_image_url ?? '';
    const base: MediaInsightItem = {
      mediaKey: media.media_key,
      type: media.type,
      url,
      altText: media.alt_text,
      width: media.width,
      height: media.height
    };

    if (media.type !== 'photo') {
      items.push({ ...base, note: '非图片媒体，当前仅做元信息采集' });
      continue;
    }

    if (!ocrEnabled) {
      items.push({ ...base, note: 'OCR 已关闭（ENABLE_IMAGE_OCR=false）' });
      continue;
    }

    if (items.filter((item) => item.type === 'photo').length >= maxImages) {
      items.push({ ...base, note: '超出单条推文OCR图片数量限制' });
      continue;
    }

    if (!url) {
      items.push({ ...base, note: '图片URL缺失，无法OCR' });
      continue;
    }

    if (ocrBudget.remaining <= 0) {
      items.push({ ...base, note: '本次请求OCR预算已用尽，已跳过' });
      continue;
    }

    if (OCR_CACHE.has(url)) {
      const cached = OCR_CACHE.get(url)!;
      items.push({
        ...base,
        ocrText: cached.text,
        ocrConfidence: cached.confidence,
        note: '命中OCR缓存'
      });
      continue;
    }

    try {
      ocrBudget.remaining -= 1;
      const ocr = await withTimeout(runOcrForImage(url), OCR_TIMEOUT_MS, 'OCR超时');
      OCR_CACHE.set(url, ocr);
      items.push({
        ...base,
        ocrText: ocr.text,
        ocrConfidence: ocr.confidence
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ocr failed';
      items.push({ ...base, note: `OCR失败: ${message}` });
    }
  }

  const altTextSummary = items
    .map((item) => item.altText?.trim())
    .filter((v): v is string => Boolean(v))
    .join(' | ');
  const ocrSummary = items
    .map((item) => item.ocrText?.trim())
    .filter((v): v is string => Boolean(v))
    .join(' | ');
  const semanticText = `${altTextSummary} ${ocrSummary}`.toLowerCase();
  const mediaTags = detectMediaTags(semanticText);
  const pnlExtraction = extractPnlFromMediaText(semanticText);
  const mediaDepthBoost = computeMediaDepthBoost(mediaTags, ocrSummary);
  const mediaInfluenceBoost = computeMediaInfluenceBoost(mediaTags, imageItems.length, videoItems.length);

  return {
    hasMedia: true,
    mediaCount: mediaItems.length,
    imageCount: imageItems.length,
    videoCount: videoItems.length,
    altTextSummary,
    ocrSummary,
    mediaDepthBoost: round(mediaDepthBoost, 4),
    mediaInfluenceBoost: round(mediaInfluenceBoost, 4),
    mediaTags,
    pnlUSD: pnlExtraction.pnlUSD,
    pnlBucket: pnlExtraction.bucket,
    pnlEvidenceScore: pnlExtraction.score,
    items
  };
}

async function runOcrForImage(
  imageUrl: string
): Promise<{ text: string; confidence: number }> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`download ${response.status}`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const { recognize } = await import('tesseract.js');
  const language = process.env.OCR_LANG ?? 'eng';
  const result = await recognize(imageBuffer, language);

  const rawText = result.data?.text ?? '';
  const normalizedText = rawText.replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    text: normalizedText,
    confidence: round(result.data?.confidence ?? 0, 2)
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function round(value: number, digits = 2): number {
  return Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits);
}

function softNormalize(value: number, pivot: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(pivot));
}

function computeInfluenceSignals(
  rawEngagement: number,
  replies: number,
  retweets: number,
  quotes: number,
  followers: number
): { reach: number; conversation: number; reshare: number; penetration: number } {
  const perFollower = followers > 0 ? (rawEngagement / followers) * 1000 : 0;
  return {
    reach: round(softNormalize(rawEngagement, 800), 4),
    conversation: round(softNormalize(replies + quotes * 1.5, 120), 4),
    reshare: round(softNormalize(retweets + quotes, 180), 4),
    penetration: round(softNormalize(perFollower, 30), 4)
  };
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function detectMediaTags(semanticText: string): string[] {
  const tags: string[] = [];
  if (
    /(profit|pnl|roi|return|收益|盈利|净值|回报|赚|win rate|胜率|strategy|entry|exit|\+\d+%|\+\$)/i.test(
      semanticText
    )
  ) {
    tags.push('data_snapshot');
  }
  if (/(fan ?art|fanart|二创|同人|插画|illustration|artwork)/i.test(semanticText)) {
    tags.push('fanart');
  }
  if (/(chart|k线|candlestick|走势|交易记录|backtest)/i.test(semanticText)) {
    tags.push('chart');
  }
  return tags;
}

function computeMediaDepthBoost(tags: string[], ocrSummary: string): number {
  const hasData = tags.includes('data_snapshot') ? 0.25 : 0;
  const hasChart = tags.includes('chart') ? 0.2 : 0;
  const ocrDensity = Math.min(0.25, (ocrSummary.length / 240) * 0.25);
  return Math.min(0.6, hasData + hasChart + ocrDensity);
}

function computeMediaInfluenceBoost(tags: string[], imageCount: number, videoCount: number): number {
  const hasFanart = tags.includes('fanart') ? 0.3 : 0;
  const hasData = tags.includes('data_snapshot') ? 0.18 : 0;
  const mediaRichness = Math.min(0.2, imageCount * 0.08 + videoCount * 0.05);
  return Math.min(0.65, hasFanart + hasData + mediaRichness);
}

function getEmptyMediaInsights(): TweetMediaInsights {
  return {
    hasMedia: false,
    mediaCount: 0,
    imageCount: 0,
    videoCount: 0,
    altTextSummary: '',
    ocrSummary: '',
    mediaDepthBoost: 0,
    mediaInfluenceBoost: 0,
    mediaTags: [],
    pnlBucket: 'none',
    pnlEvidenceScore: 0,
    items: []
  };
}

function extractPnlFromMediaText(semanticText: string): {
  pnlUSD?: number;
  bucket: 'none' | 'lt100' | '100_500' | '500_1000' | 'gte1000';
  score: number;
} {
  const normalized = semanticText.replace(/[,，\s]+/g, ' ');
  const matches = Array.from(
    normalized.matchAll(
      /(?:pnl|profit|收益|盈利|净值|回报|赚)[^0-9\-+]{0,12}([+\-]?\$?\d+(?:\.\d+)?)(k|m)?/gi
    )
  );

  const candidates = matches
    .map((match) => parseMoney(match[1], match[2]))
    .filter((value): value is number => value !== null);

  const positiveCandidates = candidates.filter((value) => value > 0);
  if (positiveCandidates.length === 0) {
    return { bucket: 'none', score: 0 };
  }

  const pnlUSD = Math.max(...positiveCandidates);
  if (pnlUSD < 100) return { pnlUSD: round(pnlUSD, 2), bucket: 'lt100', score: 25 };
  if (pnlUSD < 500) return { pnlUSD: round(pnlUSD, 2), bucket: '100_500', score: 50 };
  if (pnlUSD < 1000) return { pnlUSD: round(pnlUSD, 2), bucket: '500_1000', score: 75 };
  return { pnlUSD: round(pnlUSD, 2), bucket: 'gte1000', score: 100 };
}

function parseMoney(valueRaw: string, unitRaw?: string): number | null {
  const normalized = valueRaw.replace(/\$/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  const unit = (unitRaw ?? '').toLowerCase();
  if (unit === 'k') return parsed * 1000;
  if (unit === 'm') return parsed * 1000000;
  return parsed;
}
