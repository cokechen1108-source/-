export interface Tweet {
  id: string;
  creatorId: string;
  creatorName: string;
  handle: string;
  content: string;
  language: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
}

export interface Trade {
  id: string;
  creatorId: string;
  traderId: string;
  symbol: string;
  side: 'long' | 'short';
  sizeUSD: number;
  entryPrice: number;
  exitPrice: number;
  pnlUSD: number;
  openedAt: string;
  closedAt: string;
}

export interface ContentScoreBreakdown {
  originalityScore: number;
  insightScore: number;
  engagementQualityScore: number;
  minaraAffinityScore: number;
  totalContentScore: number;
  /** 反垃圾惩罚系数 (0, 1]，1 = 无惩罚 */
  spamPenalty: number;
  /** 有效推文数（去除垃圾推文后） */
  effectiveTweetCount: number;
}

export interface CreatorScoreBreakdown {
  creatorId: string;
  creatorName: string;
  handle: string;
  contentScore: number;
  contentBreakdown: ContentScoreBreakdown;
  derivativeScore: number;
  totalScore: number;
  tweetsCount: number;
  tradesCount: number;
  totalPnlUSD: number;
}

export interface LeaderboardResponse {
  updatedAt: string;
  entries: CreatorScoreBreakdown[];
}
