export interface MockTweet {
  id: string;
  text: string;
  isRetweet: boolean;
  likes: number;
  viewCount?: number;
  replies: number;
  retweets: number;
  quoteCount?: number;
  createdAt?: string;
  mediaInsights?: {
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
    items: Array<{
      mediaKey: string;
      type: string;
      url: string;
      altText?: string;
      ocrText?: string;
      ocrConfidence?: number;
      width?: number;
      height?: number;
      note?: string;
    }>;
  };
}

export interface MockCreator {
  id: string;
  handle: string;
  profileImageUrl?: string;
  followers: number;
  tweets: MockTweet[];
}

export const mockCreators: MockCreator[] = [
  // ===== 高质量创作者 =====
  {
    id: "creator_high_quality",
    handle: "@alpha_minara",
    followers: 12800,
    tweets: [
      { id: "t1", text: "Why Minara is building a real execution layer for AI agents — a deep dive into the architecture and its thesis", isRetweet: false, likes: 320, replies: 48, retweets: 96 },
      { id: "t2", text: "Thread: the narrative gap between Copilot-style AI and real autonomous agents. This is why Minara matters.", isRetweet: false, likes: 210, replies: 31, retweets: 74 },
      { id: "t3", text: "Minara isn't another bot — it's an execution primitive. Here's the 世界观 behind this.", isRetweet: false, likes: 180, replies: 20, retweets: 52 }
    ]
  },

  // ===== 低质量但非恶意 =====
  {
    id: "creator_low_quality",
    handle: "@casual_fan",
    followers: 1200,
    tweets: [
      { id: "t4", text: "Just discovered Minara, looks interesting. Need to dig deeper.", isRetweet: false, likes: 12, replies: 1, retweets: 0 },
      { id: "t5", text: "Minara team seems solid. Will keep watching.", isRetweet: false, likes: 5, replies: 0, retweets: 1 },
      { id: "t6", text: "Anyone else following the Minara roadmap? Curious about the next milestone.", isRetweet: false, likes: 8, replies: 2, retweets: 0 }
    ]
  },

  // ===== 羊毛党 A: 短文刷量型 =====
  // 特征：极短内容、全大写、纯 emoji、无互动
  {
    id: "spammer_short_flood",
    handle: "@spam_moon_boy",
    followers: 45,
    tweets: [
      { id: "s1", text: "MINARA TO THE MOON 🚀🚀🚀🚀🚀", isRetweet: false, likes: 1, replies: 0, retweets: 0 },
      { id: "s2", text: "MINARA SOON 🔥🔥🔥", isRetweet: false, likes: 0, replies: 0, retweets: 0 },
      { id: "s3", text: "LFG MINARA!!!", isRetweet: false, likes: 0, replies: 0, retweets: 0 },
      { id: "s4", text: "🚀🚀🚀🚀🚀🚀🚀🚀", isRetweet: false, likes: 0, replies: 0, retweets: 0 },
      { id: "s5", text: "WAGMI MINARA", isRetweet: false, likes: 0, replies: 0, retweets: 0 },
      { id: "s6", text: "MOON MOON MOON", isRetweet: false, likes: 1, replies: 0, retweets: 0 },
      { id: "s7", text: "冲冲冲！！！", isRetweet: false, likes: 0, replies: 0, retweets: 0 },
      { id: "s8", text: "买买买", isRetweet: false, likes: 0, replies: 0, retweets: 0 }
    ]
  },

  // ===== 羊毛党 B: 模板化刷量型 =====
  // 特征：内容高度相似，只替换少量词汇
  {
    id: "spammer_template",
    handle: "@template_farmer",
    followers: 120,
    tweets: [
      { id: "tp1", text: "I think Minara is going to be huge this year, definitely bullish on this project!", isRetweet: false, likes: 3, replies: 0, retweets: 0 },
      { id: "tp2", text: "I think Minara is going to be massive this year, definitely bullish on this one!", isRetweet: false, likes: 2, replies: 0, retweets: 0 },
      { id: "tp3", text: "I think Minara is going to be great this year, definitely bullish on this gem!", isRetweet: false, likes: 1, replies: 0, retweets: 0 },
      { id: "tp4", text: "I think Minara is going to be amazing this year, definitely bullish on this token!", isRetweet: false, likes: 1, replies: 0, retweets: 0 },
      { id: "tp5", text: "I think Minara is going to be incredible this year, definitely bullish on this asset!", isRetweet: false, likes: 0, replies: 0, retweets: 0 }
    ]
  },

  // ===== 羊毛党 C: 转推刷量型 =====
  // 特征：大部分是转推，少量原创也是低质量
  {
    id: "spammer_retweet",
    handle: "@rt_farmer",
    followers: 80,
    tweets: [
      { id: "rt1", text: "RT @alpha_minara: Why Minara is building a real execution layer for AI agents", isRetweet: true, likes: 0, replies: 0, retweets: 0 },
      { id: "rt2", text: "RT @alpha_minara: Thread: the narrative gap between Copilot-style AI", isRetweet: true, likes: 0, replies: 0, retweets: 0 },
      { id: "rt3", text: "RT @someone: Minara looks good", isRetweet: true, likes: 0, replies: 0, retweets: 0 },
      { id: "rt4", text: "Minara 🚀", isRetweet: false, likes: 1, replies: 0, retweets: 0 },
      { id: "rt5", text: "follow me pls", isRetweet: false, likes: 0, replies: 0, retweets: 0 }
    ]
  }
];
