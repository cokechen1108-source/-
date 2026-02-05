import type { NextApiRequest, NextApiResponse } from 'next';
import { getLeaderboard } from '../../lib/score/creatorScore';
import { LeaderboardResponse } from '../../types/leaderboard';

export default function handler(
  _req: NextApiRequest,
  res: NextApiResponse<LeaderboardResponse>
) {
  try {
    const data = getLeaderboard();
    res.status(200).json(data);
  } catch (error) {
    // In a real app you would log this
    res.status(500).json({
      updatedAt: new Date().toISOString(),
      entries: []
    });
  }
}
