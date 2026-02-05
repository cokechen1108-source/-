export interface MockTweet {
    id: string;
    text: string;
    isRetweet: boolean;
    likes: number;
    replies: number;
    retweets: number;
  }
  
  export interface MockCreator {
    id: string;
    handle: string;
    followers: number;
    tweets: MockTweet[];
  }
  
  export const mockCreators: MockCreator[] = [
    {
      id: "creator_high_quality",
      handle: "@alpha_minara",
      followers: 12800,
      tweets: [
        { id: "t1", text: "Why Minara is building a real execution layer for AI agents", isRetweet: false, likes: 320, replies: 48, retweets: 96 },
        { id: "t2", text: "Thread: the narrative gap between Copilot-style AI and real autonomous agents", isRetweet: false, likes: 210, replies: 31, retweets: 74 },
        { id: "t3", text: "Minara isn’t another bot — it’s an execution primitive.", isRetweet: false, likes: 180, replies: 20, retweets: 52 }
      ]
    },
    {
      id: "creator_low_quality",
      handle: "@spam_minara",
      followers: 230,
      tweets: [
        { id: "t4", text: "MINARA to the moon 🚀", isRetweet: false, likes: 12, replies: 1, retweets: 0 },
        { id: "t5", text: "Minara soon", isRetweet: false, likes: 5, replies: 0, retweets: 1 },
        { id: "t6", text: "retweet pls", isRetweet: false, likes: 2, replies: 0, retweets: 0 }
      ]
    }
  ];
  