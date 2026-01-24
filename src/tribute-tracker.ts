/**
 * Tribute Tracker
 *
 * Wrapper around database functions for tribute tracking.
 * All data is stored in Neon DB - no in-memory fallback.
 */

import {
  ISEE_EMOJI,
  getRandomPhrase,
  isTikiRelated,
  TRIBUTE_RECEIVED_PHRASES,
  TIKI_TRIBUTE_PHRASES,
  NO_TRIBUTES_PHRASES,
  TRIBUTES_RECEIVED_STATUS,
} from './personality';

import {
  recordTribute,
  getUserStats,
  getAllTimeStats,
  getDailyStats,
  getFridayStats,
  getPrivateStats,
  getAllTimeLeaderboard,
  getDailyLeaderboard,
  getFridayLeaderboard,
  getFridayStatus,
  hasUserOfferedTribute,
  getCurrentFridayKey,
  isFriday,
  getAIContext,
  formatLeaderboardForAI,
  type TributeRecord,
  type UserStats,
  type DetailedUserStats,
  type LeaderboardEntry,
  type FridayStatus,
} from './db';

// Re-export types and functions from db
export {
  getCurrentFridayKey,
  isFriday,
  getAllTimeStats,
  getDailyStats,
  getFridayStats,
  getPrivateStats,
  getAllTimeLeaderboard,
  getDailyLeaderboard,
  getFridayLeaderboard,
  getFridayStatus,
  hasUserOfferedTribute,
  getUserStats,
  getAIContext,
  formatLeaderboardForAI,
};
export type { UserStats, DetailedUserStats, LeaderboardEntry, FridayStatus };

// ============ TRIBUTE RECORDING ============

export interface TributePost {
  userId: string;
  username: string;
  guildId: string;
  channelId?: string;
  imageUrl?: string;
  timestamp: string;
}

/**
 * Record a tribute to the database
 */
export async function recordTributePost(
  post: TributePost,
  score: number = 1,
  category: 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER' = 'OTHER',
  drinkName?: string,
  description?: string,
  aiResponse?: string
): Promise<void> {
  const fridayKey = getCurrentFridayKey();
  const isDm = post.guildId === 'dm';
  const isSpecialDay = isFriday();

  await recordTribute({
    userId: post.userId,
    username: post.username,
    guildId: post.guildId,
    channelId: post.channelId,
    isDm,
    imageUrl: post.imageUrl,
    category,
    drinkName,
    description,
    aiResponse,
    score,
    fridayKey,
    isFriday: isSpecialDay,
  });
}

// ============ STATS GETTERS (SIMPLE WRAPPERS) ============

export interface TributeStatsResult {
  count: number;
  score: number;
}

/**
 * Get full user stats
 */
export async function getFullUserStats(userId: string): Promise<{
  allTime: TributeStatsResult;
  daily: TributeStatsResult;
  friday: TributeStatsResult;
  private: TributeStatsResult;
}> {
  const [allTime, daily, friday, privateStats] = await Promise.all([
    getAllTimeStats(userId),
    getDailyStats(userId),
    getFridayStats(userId),
    getPrivateStats(userId),
  ]);

  return {
    allTime,
    daily,
    friday,
    private: privateStats,
  };
}

/**
 * Format leaderboard for AI context
 */
export async function getLeaderboardContext(): Promise<string> {
  const [allTime, daily, friday] = await Promise.all([
    getAllTimeLeaderboard(10),
    getDailyLeaderboard(5),
    getFridayLeaderboard(5),
  ]);

  return formatLeaderboardForAI(allTime, daily, friday);
}

// ============ RANDOM PRAISE/CONDEMNATION ============

const PRAISE_PHRASES = [
  `${ISEE_EMOJI} The spirits SMILE upon **TOP_USER** who leads with **COUNT**!`,
  `${ISEE_EMOJI} **TOP_USER** has proven their devotion with **COUNT**. The ancients are PLEASED.`,
  `${ISEE_EMOJI} BEHOLD! **TOP_USER** stands as the most devoted with **COUNT**!`,
  `${ISEE_EMOJI} The tiki gods FAVOR **TOP_USER**... **COUNT** speaks of TRUE dedication.`,
];

const CONDEMNATION_PHRASES = [
  `${ISEE_EMOJI} The spirits grow RESTLESS... **LAZY_USER** has offered only **COUNT**. SHAMEFUL.`,
  `${ISEE_EMOJI} **LAZY_USER**... the ancients have NOTICED your **COUNT** measly offerings. Do better.`,
  `${ISEE_EMOJI} I SEE you, **LAZY_USER**. Only **COUNT**? The spirits are... DISAPPOINTED.`,
  `${ISEE_EMOJI} **LAZY_USER** lurks in the shadows with only **COUNT**. The gods REMEMBER.`,
];

/**
 * Maybe generate random praise or condemnation (30% chance)
 */
async function maybeGetRandomComment(): Promise<string | null> {
  if (Math.random() > 0.3) return null;

  const leaderboard = await getAllTimeLeaderboard(10);
  if (leaderboard.length < 2) return null;

  if (Math.random() < 0.6) {
    const top = leaderboard[0];
    const phrase = getRandomPhrase(PRAISE_PHRASES);
    return phrase
      .replace('TOP_USER', `<@${top.userId}>`)
      .replace('COUNT', `${top.score}pts from ${top.count} tributes`);
  } else {
    const activeTributors = leaderboard.filter(u => u.count > 0);
    if (activeTributors.length < 2) return null;

    const lowest = activeTributors[activeTributors.length - 1];
    if (lowest.score === leaderboard[0].score) return null;

    const phrase = getRandomPhrase(CONDEMNATION_PHRASES);
    return phrase
      .replace('LAZY_USER', `<@${lowest.userId}>`)
      .replace('COUNT', `${lowest.score}pts from ${lowest.count} tributes`);
  }
}

// ============ MILESTONE MESSAGES ============

function getScoreMilestoneMessage(totalScore: number): string {
  const milestones = [
    { score: 50, msg: `**50 POINTS!** You have proven your devotion, mortal.` },
    { score: 100, msg: `**100 POINTS!** The spirits recognize you as a TRUE DEVOTEE.` },
    { score: 250, msg: `**250 POINTS!** You have ascended to TIKI ELDER status!` },
    { score: 500, msg: `**500 POINTS!** The ancient ones BOW before your dedication!` },
    { score: 1000, msg: `**1000 POINTS!** You have achieved TIKI IMMORTALITY! Legends speak of your name!` },
  ];

  for (const milestone of milestones) {
    if (totalScore >= milestone.score && totalScore < milestone.score + 10) {
      return `\n\n${ISEE_EMOJI} ${milestone.msg}`;
    }
  }
  return '';
}

// ============ COMMAND HANDLERS ============

/**
 * Handle /tribute command
 */
export async function handleTributeCommand(
  subcommand: string,
  userId: string,
  username: string,
  guildId: string,
  imageUrl?: string,
  messageContent?: string
): Promise<{ content: string }> {
  switch (subcommand) {
    case 'offer': {
      const isTiki = messageContent ? isTikiRelated(messageContent) : false;
      const category = isTiki ? 'TIKI' : 'OTHER';
      const score = isTiki ? 10 : 1;

      await recordTributePost(
        { userId, username, guildId, imageUrl, timestamp: new Date().toISOString() },
        score,
        category
      );

      const stats = await getFullUserStats(userId);
      const isSpecialDay = isFriday();

      let response: string;

      if (isTiki && imageUrl) {
        response = getRandomPhrase(TIKI_TRIBUTE_PHRASES);
      } else if (imageUrl) {
        response = getRandomPhrase(TRIBUTE_RECEIVED_PHRASES);
      } else {
        return {
          content: `${ISEE_EMOJI} I acknowledge your intent, **${username}**... but the ritual demands VISUAL PROOF. Attach an image of your libation!`,
        };
      }

      if (isSpecialDay) {
        response += `\n\n**${username}** honors the SACRED FRIDAY RITUAL!`;
        response += `\n*Today: ${stats.daily.count} | Fridays: ${stats.friday.count} | All-time: ${stats.allTime.count}*`;
      } else {
        response += `\n\n**${username}**'s tribute has been recorded.`;
        response += `\n*Today: ${stats.daily.count} | All-time: ${stats.allTime.count}*`;
      }

      const randomComment = await maybeGetRandomComment();
      if (randomComment) {
        response += `\n\n${randomComment}`;
      }

      response += getScoreMilestoneMessage(stats.allTime.score);

      return { content: response };
    }

    case 'status': {
      const status = await getFridayStatus(guildId);
      const fridayLabel = isFriday() ? 'this sacred Friday' : `Friday (${status.date})`;

      if (!status.hasTributePost) {
        return {
          content: `${getRandomPhrase(NO_TRIBUTES_PHRASES)}\n\n**${fridayLabel}**: The offering hall stands EMPTY.${isFriday() ? '\n\nUse `/tribute offer` to make your offering!' : ''}`,
        };
      }

      const devoteePromises = status.posts.map(async p => {
        const stats = await getAllTimeStats(p.userId);
        const fridayS = await getFridayStats(p.userId);
        return `  - ${p.username} (${stats.score}pts from ${stats.count} tributes | Fridays: ${fridayS.score}pts)`;
      });
      const devotees = (await Promise.all(devoteePromises)).join('\n');

      let response = `${getRandomPhrase(TRIBUTES_RECEIVED_STATUS)}\n\n**${fridayLabel}**: ${status.posts.length} offering${status.posts.length !== 1 ? 's' : ''} recorded.\n\n**Devoted mortals:**\n${devotees}`;

      const leaderboard = await getAllTimeLeaderboard(5);
      if (leaderboard.length > 0) {
        const top = leaderboard[0];
        response += `\n\n${ISEE_EMOJI} **Most devoted:** <@${top.userId}> with ${top.score}pts from ${top.count} tributes`;
      }

      return { content: response };
    }

    case 'demand': {
      if (!isFriday()) {
        return {
          content: 'The ritual day has not yet arrived. The spirits will make their demands when Friday awakens.',
        };
      }

      const status = await getFridayStatus(guildId);
      if (status.hasTributePost) {
        return {
          content: `${ISEE_EMOJI} Tribute has already been offered this Friday. The spirits are... SATISFIED. For now.`,
        };
      }

      return {
        content: `${ISEE_EMOJI} **THE ANCIENT RITUAL DEMANDS TRIBUTE!**\n\nFriday has arrived and the spirits grow RESTLESS. Show me your vessels of the sacred elixir, mortals!\n\nUse \`/tribute offer\` with an image to appease the TIKI GODS.`,
      };
    }

    default:
      return {
        content: `${ISEE_EMOJI} Unknown ritual command. The spirits recognize: \`/tribute offer\`, \`/tribute status\`, or \`/tribute demand\`.`,
      };
  }
}

/**
 * Handle a tribute via @mention with image attachment
 */
export async function handleMentionTribute(
  userId: string,
  username: string,
  guildId: string,
  channelId: string,
  imageUrl: string,
  messageContent?: string,
  imageAnalysis?: {
    description: string;
    category: string;
    score: number;
    drinkName?: string;
    response?: string;
  }
): Promise<{ content: string }> {
  const score = imageAnalysis?.score || 1;
  const category = (imageAnalysis?.category as 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER') || 'OTHER';

  await recordTributePost(
    { userId, username, guildId, channelId, imageUrl, timestamp: new Date().toISOString() },
    score,
    category,
    imageAnalysis?.drinkName,
    imageAnalysis?.description,
    imageAnalysis?.response
  );

  const allTimeStats = await getAllTimeStats(userId);

  let response: string;
  if (imageAnalysis?.response) {
    response = `${ISEE_EMOJI} ${imageAnalysis.response}`;
  } else {
    response = `${ISEE_EMOJI} I SEE your offering, **${username}**... The spirits acknowledge your tribute.`;
  }

  const randomComment = await maybeGetRandomComment();
  if (randomComment) {
    response += `\n\n${randomComment}`;
  }

  response += getScoreMilestoneMessage(allTimeStats.score);

  return { content: response };
}
