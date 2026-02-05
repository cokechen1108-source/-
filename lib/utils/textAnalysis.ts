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
