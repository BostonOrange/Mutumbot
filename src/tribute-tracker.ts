/**
 * Tribute Tracker
 *
 * The ancient tiki god tracks ALL offerings across multiple categories:
 * - All-time tributes (running tally)
 * - Daily tributes
 * - Friday sacred tributes
 *
 * The god randomly praises devoted followers and condemns the lazy!
 */

import { TributePost, FridayStatus } from './types';
import {
  ISEE_EMOJI,
  getRandomPhrase,
  isTikiRelated,
  TRIBUTE_RECEIVED_PHRASES,
  TIKI_TRIBUTE_PHRASES,
  NO_TRIBUTES_PHRASES,
  TRIBUTES_RECEIVED_STATUS,
} from './personality';

// ============ STORAGE ============
// In-memory storage (for production, use a database like Upstash Redis)

// Weekly Friday posts (keyed by Friday date)
const fridayPosts: Map<string, TributePost[]> = new Map();

// User stats structure
interface UserTributeStats {
  count: number;
  score: number;
}

// All-time tribute stats per user (public channel tributes only)
const allTimeStats: Map<string, UserTributeStats> = new Map();

// Today's tribute stats per user (keyed by date)
const dailyStats: Map<string, Map<string, UserTributeStats>> = new Map();

// Friday-specific tribute stats per user (only counts Friday tributes)
const fridayStats: Map<string, UserTributeStats> = new Map();

// Private devotion stats (DM tributes - separate from competitive leaderboard)
const privateDevotionStats: Map<string, UserTributeStats> = new Map();

// Helper to get or create stats
function getOrCreateStats(map: Map<string, UserTributeStats>, key: string): UserTributeStats {
  let stats = map.get(key);
  if (!stats) {
    stats = { count: 0, score: 0 };
    map.set(key, stats);
  }
  return stats;
}

// ============ DATE HELPERS ============

/**
 * Get today's date key (YYYY-MM-DD)
 */
function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get the current/most recent Friday's date key
 */
export function getCurrentFridayKey(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToSubtract = dayOfWeek >= 5 ? dayOfWeek - 5 : dayOfWeek + 2;
  const friday = new Date(now);
  friday.setDate(friday.getDate() - daysToSubtract);
  return friday.toISOString().split('T')[0];
}

/**
 * Check if today is Friday
 */
export function isFriday(): boolean {
  return new Date().getDay() === 5;
}

// ============ TRIBUTE RECORDING ============

// Default score if none provided
const DEFAULT_SCORE = 1;

/**
 * Record a tribute and update all stats (count + score)
 * DM tributes (guildId === 'dm') go to private devotion (not competitive)
 */
export function recordTributePost(post: TributePost, score: number = DEFAULT_SCORE): void {
  // DM tributes go to private devotion stats only
  if (post.guildId === 'dm') {
    const stats = getOrCreateStats(privateDevotionStats, post.userId);
    stats.count += 1;
    stats.score += score;
    return;
  }

  const todayKey = getTodayKey();
  const fridayKey = getCurrentFridayKey();

  // Record in Friday posts (for weekly tracking)
  const posts = fridayPosts.get(fridayKey) || [];
  posts.push(post);
  fridayPosts.set(fridayKey, posts);

  // Update all-time stats
  const allTimeUserStats = getOrCreateStats(allTimeStats, post.userId);
  allTimeUserStats.count += 1;
  allTimeUserStats.score += score;

  // Update daily stats
  if (!dailyStats.has(todayKey)) {
    dailyStats.set(todayKey, new Map());
  }
  const todayMap = dailyStats.get(todayKey)!;
  const dailyUserStats = getOrCreateStats(todayMap, post.userId);
  dailyUserStats.count += 1;
  dailyUserStats.score += score;

  // Update Friday stats (only if it's Friday)
  if (isFriday()) {
    const fridayUserStats = getOrCreateStats(fridayStats, post.userId);
    fridayUserStats.count += 1;
    fridayUserStats.score += score;
  }
}

// ============ STATS GETTERS ============

export interface TributeStatsResult {
  count: number;
  score: number;
}

export function getAllTimeStats(userId: string): TributeStatsResult {
  return allTimeStats.get(userId) || { count: 0, score: 0 };
}

export function getDailyStats(userId: string): TributeStatsResult {
  const todayKey = getTodayKey();
  const todayMap = dailyStats.get(todayKey);
  return todayMap?.get(userId) || { count: 0, score: 0 };
}

export function getFridayStats(userId: string): TributeStatsResult {
  return fridayStats.get(userId) || { count: 0, score: 0 };
}

export function getPrivateDevotionStats(userId: string): TributeStatsResult {
  return privateDevotionStats.get(userId) || { count: 0, score: 0 };
}

// Legacy count-only getters (for backwards compatibility)
export function getAllTimeTribute(userId: string): number {
  return getAllTimeStats(userId).count;
}

export function getDailyTribute(userId: string): number {
  return getDailyStats(userId).count;
}

export function getFridayTribute(userId: string): number {
  return getFridayStats(userId).count;
}

export function getPrivateDevotion(userId: string): number {
  return getPrivateDevotionStats(userId).count;
}

/**
 * Get full user stats for AI context
 */
export function getFullUserStats(userId: string): {
  allTime: TributeStatsResult;
  daily: TributeStatsResult;
  friday: TributeStatsResult;
  private: TributeStatsResult;
} {
  return {
    allTime: getAllTimeStats(userId),
    daily: getDailyStats(userId),
    friday: getFridayStats(userId),
    private: getPrivateDevotionStats(userId),
  };
}

// ============ LEADERBOARDS ============

export interface LeaderboardEntry {
  userId: string;
  count: number;
  score: number;
}

export function getAllTimeLeaderboard(): LeaderboardEntry[] {
  return Array.from(allTimeStats.entries())
    .sort((a, b) => b[1].score - a[1].score) // Sort by score (highest first)
    .map(([userId, stats]) => ({ userId, count: stats.count, score: stats.score }));
}

export function getDailyLeaderboard(): LeaderboardEntry[] {
  const todayKey = getTodayKey();
  const todayMap = dailyStats.get(todayKey);
  if (!todayMap) return [];

  return Array.from(todayMap.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .map(([userId, stats]) => ({ userId, count: stats.count, score: stats.score }));
}

export function getFridayLeaderboard(): LeaderboardEntry[] {
  return Array.from(fridayStats.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .map(([userId, stats]) => ({ userId, count: stats.count, score: stats.score }));
}

/**
 * Format leaderboard for AI context
 */
export function getLeaderboardContext(): string {
  const allTime = getAllTimeLeaderboard().slice(0, 5);
  const daily = getDailyLeaderboard().slice(0, 5);
  const friday = getFridayLeaderboard().slice(0, 5);

  let context = '[LEADERBOARD DATA - Ranked by score (Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt)]\\n';

  if (allTime.length > 0) {
    context += 'All-time top 5: ' + allTime.map((e, i) => `#${i + 1} <@${e.userId}> (${e.score}pts, ${e.count} tributes)`).join(', ') + '\\n';
  }

  if (daily.length > 0) {
    context += 'Today top 5: ' + daily.map((e, i) => `#${i + 1} <@${e.userId}> (${e.score}pts)`).join(', ') + '\\n';
  }

  if (friday.length > 0) {
    context += 'Friday top 5: ' + friday.map((e, i) => `#${i + 1} <@${e.userId}> (${e.score}pts)`).join(', ');
  }

  return context;
}

// ============ RANDOM PRAISE/CONDEMNATION ============

const PRAISE_PHRASES = [
  `${ISEE_EMOJI} The spirits SMILE upon **TOP_USER** who leads with **COUNT** tributes!`,
  `${ISEE_EMOJI} **TOP_USER** has proven their devotion with **COUNT** offerings. The ancients are PLEASED.`,
  `${ISEE_EMOJI} BEHOLD! **TOP_USER** stands as the most devoted with **COUNT** tributes!`,
  `${ISEE_EMOJI} The tiki gods FAVOR **TOP_USER**... **COUNT** tributes speak of TRUE dedication.`,
];

const CONDEMNATION_PHRASES = [
  `${ISEE_EMOJI} The spirits grow RESTLESS... **LAZY_USER** has offered only **COUNT** tribute. SHAMEFUL.`,
  `${ISEE_EMOJI} **LAZY_USER**... the ancients have NOTICED your **COUNT** measly offering. Do better.`,
  `${ISEE_EMOJI} I SEE you, **LAZY_USER**. Only **COUNT** tribute? The spirits are... DISAPPOINTED.`,
  `${ISEE_EMOJI} **LAZY_USER** lurks in the shadows with only **COUNT** offering. The gods REMEMBER.`,
];

/**
 * Maybe generate random praise or condemnation (30% chance)
 */
function maybeGetRandomComment(): string | null {
  if (Math.random() > 0.3) return null; // 70% of the time, no comment

  const leaderboard = getAllTimeLeaderboard();
  if (leaderboard.length < 2) return null;

  // 60% praise, 40% condemn
  if (Math.random() < 0.6) {
    // Praise the top tributor (by score)
    const top = leaderboard[0];
    const phrase = getRandomPhrase(PRAISE_PHRASES);
    return phrase.replace('TOP_USER', `<@${top.userId}>`).replace('COUNT', `${top.score}pts from ${top.count}`);
  } else {
    // Condemn the lowest scorer (only if they have at least 1 tribute)
    const activeTributors = leaderboard.filter(u => u.count > 0);
    if (activeTributors.length < 2) return null;

    const lowest = activeTributors[activeTributors.length - 1];
    // Don't condemn if they're tied with the top
    if (lowest.score === leaderboard[0].score) return null;

    const phrase = getRandomPhrase(CONDEMNATION_PHRASES);
    return phrase.replace('LAZY_USER', `<@${lowest.userId}>`).replace('COUNT', `${lowest.score}pts from ${lowest.count}`);
  }
}

// ============ FRIDAY STATUS ============

export function getFridayStatus(guildId: string): FridayStatus {
  const key = getCurrentFridayKey();
  const allPosts = fridayPosts.get(key) || [];
  const guildPosts = allPosts.filter(p => p.guildId === guildId);

  return {
    date: key,
    hasTributePost: guildPosts.length > 0,
    posts: guildPosts,
  };
}

export function hasUserOfferedTribute(userId: string, guildId: string): boolean {
  const key = getCurrentFridayKey();
  const allPosts = fridayPosts.get(key) || [];
  return allPosts.some(p => p.userId === userId && p.guildId === guildId);
}

// ============ RESPONSE PHRASES ============

const NON_FRIDAY_TRIBUTE_PHRASES = [
  `${ISEE_EMOJI} An offering outside the sacred Friday? Your devotion is... NOTED.`,
  `${ISEE_EMOJI} The spirits did not DEMAND this tribute... but they accept it nonetheless.`,
  `${ISEE_EMOJI} UNEXPECTED... but welcome. Your offering pleases the ancient ones.`,
  `${ISEE_EMOJI} A tribute on a common day? You seek FAVOR with the spirits...`,
];

// ============ COMMAND HANDLERS ============

export function handleTributeCommand(
  subcommand: string,
  userId: string,
  username: string,
  guildId: string,
  imageUrl?: string,
  messageContent?: string
): { content: string } {
  switch (subcommand) {
    case 'offer': {
      recordTributePost({
        userId,
        username,
        timestamp: new Date().toISOString(),
        imageUrl,
        guildId,
      });

      const allTime = getAllTimeTribute(userId);
      const daily = getDailyTribute(userId);
      const fridayCount = getFridayTribute(userId);
      const isTiki = messageContent ? isTikiRelated(messageContent) : false;
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

      // Add context based on day
      if (isSpecialDay) {
        response += `\n\n**${username}** honors the SACRED FRIDAY RITUAL!`;
        response += `\n*Today: ${daily} | Fridays: ${fridayCount} | All-time: ${allTime}*`;
      } else {
        response += `\n\n**${username}**'s tribute has been recorded.`;
        response += `\n*Today: ${daily} | All-time: ${allTime}*`;
      }

      // Maybe add random praise/condemnation
      const randomComment = maybeGetRandomComment();
      if (randomComment) {
        response += `\n\n${randomComment}`;
      }

      // Milestone messages (based on score)
      const allTimeStats = getAllTimeStats(userId);
      response += getScoreMilestoneMessage(allTimeStats.score);

      return { content: response };
    }

    case 'status': {
      const status = getFridayStatus(guildId);
      const fridayLabel = isFriday() ? 'this sacred Friday' : `Friday (${status.date})`;

      if (!status.hasTributePost) {
        return {
          content: `${getRandomPhrase(NO_TRIBUTES_PHRASES)}\n\n**${fridayLabel}**: The offering hall stands EMPTY.${isFriday() ? '\n\nUse `/tribute offer` to make your offering!' : ''}`,
        };
      }

      const devotees = status.posts.map(p => {
        const stats = getAllTimeStats(p.userId);
        const fridayS = getFridayStats(p.userId);
        return `  - ${p.username} (${stats.score}pts from ${stats.count} tributes | Fridays: ${fridayS.score}pts)`;
      }).join('\n');

      let response = `${getRandomPhrase(TRIBUTES_RECEIVED_STATUS)}\n\n**${fridayLabel}**: ${status.posts.length} offering${status.posts.length !== 1 ? 's' : ''} recorded.\n\n**Devoted mortals:**\n${devotees}`;

      // Add leaderboard teaser
      const leaderboard = getAllTimeLeaderboard();
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

      const status = getFridayStatus(guildId);
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

// In-character follow-up phrases by category
const TIKI_FOLLOWUPS = [
  `The ancient ones REJOICE at this sacred vessel!`,
  `A TRUE offering to the tiki spirits!`,
  `The SACRED ARTS have been honored!`,
  `YESSS... This pleases the ancient ones GREATLY.`,
];

const COCKTAIL_FOLLOWUPS = [
  `A worthy libation... though the spirits dream of TIKI.`,
  `The craft is acknowledged. The spirits nod in approval.`,
  `Not the sacred tiki arts, but the spirits accept your offering.`,
];

const BEER_WINE_FOLLOWUPS = [
  `A humble offering... but the spirits see your devotion.`,
  `The common elixirs are... acceptable.`,
  `Simple, yet the spirits recognize the intent.`,
];

const OTHER_FOLLOWUPS = [
  `An... unusual tribute. The spirits are INTRIGUED.`,
  `The spirits tilt their heads in CURIOSITY.`,
  `Unconventional... but devotion takes many forms.`,
];

/**
 * Handle a tribute via @mention with image attachment
 */
export function handleMentionTribute(
  userId: string,
  username: string,
  guildId: string,
  imageUrl: string,
  messageContent?: string,
  imageAnalysis?: { description: string; category: string; score: number; drinkName?: string }
): { content: string } {
  const score = imageAnalysis?.score || 1;
  const category = imageAnalysis?.category || 'OTHER';

  recordTributePost({
    userId,
    username,
    timestamp: new Date().toISOString(),
    imageUrl,
    guildId,
  }, score);

  const allTimeS = getAllTimeStats(userId);
  const isSpecialDay = isFriday();

  let response = `${ISEE_EMOJI} I SEE your offering, **${username}**...`;

  // Add what Mutumbot SAW in the image
  if (imageAnalysis?.description) {
    response += ` ${imageAnalysis.description}`;
  }

  // In-character response based on category
  if (category === 'TIKI') {
    response += `\n\n${getRandomPhrase(TIKI_FOLLOWUPS)}`;
  } else if (category === 'COCKTAIL') {
    response += `\n\n${getRandomPhrase(COCKTAIL_FOLLOWUPS)}`;
  } else if (category === 'BEER_WINE') {
    response += `\n\n${getRandomPhrase(BEER_WINE_FOLLOWUPS)}`;
  } else {
    response += `\n\n${getRandomPhrase(OTHER_FOLLOWUPS)}`;
  }

  // Friday gets special mention
  if (isSpecialDay) {
    response += ` The SACRED FRIDAY RITUAL has been honored!`;
  }

  // Maybe add random praise/condemnation of other users
  const randomComment = maybeGetRandomComment();
  if (randomComment) {
    response += `\n\n${randomComment}`;
  }

  // Milestone messages (based on score)
  response += getScoreMilestoneMessage(allTimeS.score);

  return { content: response };
}

/**
 * Get milestone message based on score
 */
function getScoreMilestoneMessage(totalScore: number): string {
  // Score milestones (check if we just hit them)
  const milestones = [
    { score: 50, msg: `**50 POINTS!** You have proven your devotion, mortal.` },
    { score: 100, msg: `**100 POINTS!** The spirits recognize you as a TRUE DEVOTEE.` },
    { score: 250, msg: `**250 POINTS!** You have ascended to TIKI ELDER status!` },
    { score: 500, msg: `**500 POINTS!** The ancient ones BOW before your dedication!` },
    { score: 1000, msg: `**1000 POINTS!** You have achieved TIKI IMMORTALITY! Legends speak of your name!` },
  ];

  for (const milestone of milestones) {
    // Check if score just crossed this milestone (within last tribute's max possible score of 10)
    if (totalScore >= milestone.score && totalScore < milestone.score + 10) {
      return `\n\n${ISEE_EMOJI} ${milestone.msg}`;
    }
  }
  return '';
}
