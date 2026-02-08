// Extremely lightweight mixed Chinese / English sentiment-ish scoring
// This is only for demo purposes and not a real NLP model.

const positiveKeywords = [
  '🚀',
  'moon',
  'win',
  '赚',
  '爽',
  '机会',
  '稳',
  'happy',
  'nice',
  'cool',
  'lol'
];

const negativeKeywords = ['跌', '亏', 'risk', '怕', '崩', '爆仓', 'loss', 'rip'];

export function estimateTextSentimentScore(content: string): number {
  const lower = content.toLowerCase();

  let score = 0;

  for (const word of positiveKeywords) {
    if (lower.includes(word.toLowerCase())) {
      score += 1;
    }
  }

  for (const word of negativeKeywords) {
    if (lower.includes(word.toLowerCase())) {
      score -= 1;
    }
  }

  // Clamp to a small range to keep things readable
  if (score > 3) score = 3;
  if (score < -3) score = -3;

  return score;
}

// ==============================
// Spam Detection Utilities
// ==============================

/**
 * 将文本拆分为 token 集合（简单分词：按空格 + 标点拆分，去除纯 emoji 和单字符）
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ') // 保留中英文字符和空格
    .split(/\s+/)
    .filter((t) => t.length > 1); // 去掉单字符 token
}

/**
 * Jaccard 相似度：两组 token 的交集 / 并集
 * 用于检测模板化内容（换几个词就发的推文）
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 检测推文的 spam 信号，返回 0~1 的 spam 概率值
 * 越接近 1 越可能是垃圾内容
 */
export interface SpamSignals {
  spamScore: number;        // 综合 spam 概率 [0, 1]
  isUltraShort: boolean;    // 极短内容 (< 15 字符)
  isEmojiHeavy: boolean;    // emoji / 特殊字符占比 > 50%
  isAllCaps: boolean;       // 英文部分全大写
  isLowEffort: boolean;     // 命中低质量模板（gm, lol, soon 等）
  hasExcessiveRepetition: boolean; // 大量重复字符 (如 🚀🚀🚀🚀🚀)
}

const lowEffortPatterns = [
  /^gm\b/i,
  /^gn\b/i,
  /^(let'?s?\s*)?go+!*$/i,
  /^soon\b/i,
  /^wen\b/i,
  /^wagmi\b/i,
  /^ngmi\b/i,
  /^(to the )?moon!*$/i,
  /^retweet\s*(pls|please)?/i,
  /^like\s*(pls|please)?/i,
  /^follow\s*(pls|please|me)?/i,
  /^(再)?冲[!！一波]*$/,
  /^冲就完了/,
  /^买买买/,
  /^[🚀🔥💎🌙✨💰]+$/,  // 纯 emoji
];

export function detectSpamSignals(text: string): SpamSignals {
  const trimmed = text.trim();

  // 1. 极短内容
  const isUltraShort = trimmed.length < 15;

  // 2. Emoji / 特殊字符占比
  const alphaNumChinese = trimmed.replace(/[^\w\u4e00-\u9fff]/g, '');
  const emojiRatio =
    trimmed.length === 0
      ? 0
      : 1 - alphaNumChinese.length / trimmed.length;
  const isEmojiHeavy = emojiRatio > 0.5;

  // 3. 全大写（仅看英文字母部分）
  const englishLetters = trimmed.replace(/[^a-zA-Z]/g, '');
  const isAllCaps =
    englishLetters.length > 5 &&
    englishLetters === englishLetters.toUpperCase();

  // 4. 低质量模板
  const isLowEffort = lowEffortPatterns.some((p) => p.test(trimmed));

  // 5. 过度重复字符（同一字符连续出现 5 次以上）
  const hasExcessiveRepetition = /(.)\1{4,}/u.test(trimmed);

  // 综合 spam score
  let spamScore = 0;
  if (isUltraShort) spamScore += 0.3;
  if (isEmojiHeavy) spamScore += 0.2;
  if (isAllCaps) spamScore += 0.15;
  if (isLowEffort) spamScore += 0.25;
  if (hasExcessiveRepetition) spamScore += 0.1;

  // Clamp
  spamScore = Math.min(1, spamScore);

  return {
    spamScore,
    isUltraShort,
    isEmojiHeavy,
    isAllCaps,
    isLowEffort,
    hasExcessiveRepetition
  };
}

/**
 * 检测发帖频率异常：在 tweets 列表中，如果短时间内（windowMinutes）发帖数量
 * 超过 maxInWindow，返回 burst 惩罚系数 (0, 1]，1 表示正常，越小惩罚越重。
 */
export function computeBurstPenalty(
  timestamps: string[],
  windowMinutes: number = 30,
  maxInWindow: number = 5
): number {
  if (timestamps.length <= maxInWindow) return 1;

  const sorted = timestamps
    .map((t) => new Date(t).getTime())
    .sort((a, b) => a - b);

  const windowMs = windowMinutes * 60 * 1000;
  let maxBurst = 0;

  for (let i = 0; i < sorted.length; i++) {
    let count = 0;
    for (let j = i; j < sorted.length; j++) {
      if (sorted[j] - sorted[i] <= windowMs) {
        count++;
      } else {
        break;
      }
    }
    if (count > maxBurst) maxBurst = count;
  }

  if (maxBurst <= maxInWindow) return 1;

  // 超出部分线性衰减，最低 0.3
  const overRatio = maxInWindow / maxBurst;
  return Math.max(0.3, overRatio);
}

/**
 * 安全的全词匹配：用于 Minara Affinity 中避免 "ip" 误中 "tip"、"drip" 等
 * 对中文关键词使用 includes，对英文关键词使用 word boundary
 */
export function matchKeywordSafe(
  text: string,
  keyword: string
): boolean {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();

  // 中文关键词直接 includes
  if (/[\u4e00-\u9fff]/.test(kw)) {
    return lower.includes(kw);
  }

  // 英文关键词使用 word boundary
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}
