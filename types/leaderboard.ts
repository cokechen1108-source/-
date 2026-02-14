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
  /** 账号可信度系数 (0, 1]，基于粉丝数计算 */
  credibility: number;
  /** 最终乘数 = spamPenalty × credibility */
  finalMultiplier: number;
  /** 非转推覆盖率 = nonRetweetCount / totalTweets */
  nonRetweetCoverage: number;
  /** 小样本平滑因子，n < n0 时会降权 */
  sampleFactor: number;
  /** 时间衰减平均权重（越高说明内容越新） */
  timeDecayAvg: number;
  /** 互动可信度平均权重（反刷保护） */
  engagementCredibilityAvg: number;
  /** 收益截图证据分（基于OCR识别到的PNL分档） */
  pnlEvidenceScore: number;
  /** 收益截图覆盖率（含PNL证据推文占比） */
  pnlEvidenceCoverage: number;
  /** 有效推文数（去除垃圾推文后） */
  effectiveTweetCount: number;
}

export interface CreatorScoreBreakdown {
  creatorId: string;
  creatorName: string;
  handle: string;
  profileImageUrl?: string;
  followers: number;
  contentScore: number;
  depthScore: number;
  engagementScore: number;
  influenceScore: number;
  activityScore: number;
  pnlEvidenceScore: number;
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
