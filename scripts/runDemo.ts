import { getDemoLeaderboard } from "../lib/score/creatorScore";

console.log("🔥🔥🔥 RUN DEMO START 🔥🔥🔥");

// 调用 demo leaderboard 函数
const leaderboard = getDemoLeaderboard();

console.log("=== DEMO LEADERBOARD ===");
console.log(JSON.stringify(leaderboard, null, 2));
