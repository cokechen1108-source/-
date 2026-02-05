export interface MockTweet {
  text: string;
  likes: number;
  replies: number;
  retweets: number;
  isRetweet: boolean;
}

export interface MockCreator {
  id: string;
  handle: string;
  followers: number;
  tweets: MockTweet[];
}

export const mockCreators: MockCreator[] = [
  {
    id: 'creator_high_quality',
    handle: '@alpha_minara',
    followers: 12800,
    tweets: [
      {
        text: 'Thread: 为什么 Minara 这种 IP 适合做长期二创资产？Here is my full thesis 👇',
        likes: 420,
        replies: 68,
        retweets: 97,
        isRetweet: false
      },
      {
        text: '今天画了一张新的 Minara fan art，把之前的世界观继续扩展了一点点 😊',
        likes: 310,
        replies: 34,
        retweets: 56,
        isRetweet: false
      },
      {
        text: '很多人只看价格，不看 narrative。For Minara, community > short-term price action.',
        likes: 260,
        replies: 29,
        retweets: 44,
        isRetweet: false
      }
    ]
  },
  {
    id: 'creator_low_quality',
    handle: '@spam_minara',
    followers: 230,
    tweets: [
      {
        text: 'RT @alpha_minara: Thread: 为什么 Minara 这种 IP 适合做长期二创资产？',
        likes: 2,
        replies: 0,
        retweets: 1,
        isRetweet: true
      },
      {
        text: 'Minara to the moon 🚀🚀🚀',
        likes: 3,
        replies: 0,
        retweets: 0,
        isRetweet: false
      },
      {
        text: '再冲一波 Minara！！',
        likes: 1,
        replies: 0,
        retweets: 0,
        isRetweet: false
      }
    ]
  }
];
