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

// All-time tribute count per user
const allTimeTally: Map<string, number> = new Map();

// Today's tribute count per user (keyed by date)
const dailyTally: Map<string, Map<string, number>> = new Map();

// Friday-specific tribute count per user (only counts Friday tributes)
const fridayTally: Map<string, number> = new Map();

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

/**
 * Record a tribute and update all tallies
 * DM tributes (guildId === 'dm') are NOT counted toward competitive tallies
 */
export function recordTributePost(post: TributePost): void {
  // Don't count DM tributes toward competitive tallies
  if (post.guildId === 'dm') {
    return;
  }

  const todayKey = getTodayKey();
  const fridayKey = getCurrentFridayKey();

  // Record in Friday posts (for weekly tracking)
  const posts = fridayPosts.get(fridayKey) || [];
  posts.push(post);
  fridayPosts.set(fridayKey, posts);

  // Update all-time tally
  const currentAllTime = allTimeTally.get(post.userId) || 0;
  allTimeTally.set(post.userId, currentAllTime + 1);

  // Update daily tally
  if (!dailyTally.has(todayKey)) {
    dailyTally.set(todayKey, new Map());
  }
  const todayMap = dailyTally.get(todayKey)!;
  const currentDaily = todayMap.get(post.userId) || 0;
  todayMap.set(post.userId, currentDaily + 1);

  // Update Friday tally (only if it's Friday)
  if (isFriday()) {
    const currentFriday = fridayTally.get(post.userId) || 0;
    fridayTally.set(post.userId, currentFriday + 1);
  }
}

// ============ TALLY GETTERS ============

export function getAllTimeTribute(userId: string): number {
  return allTimeTally.get(userId) || 0;
}

export function getDailyTribute(userId: string): number {
  const todayKey = getTodayKey();
  const todayMap = dailyTally.get(todayKey);
  return todayMap?.get(userId) || 0;
}

export function getFridayTribute(userId: string): number {
  return fridayTally.get(userId) || 0;
}

// ============ LEADERBOARDS ============

export function getAllTimeLeaderboard(): Array<{ odId: string; count: number }> {
  return Array.from(allTimeTally.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([odId, count]) => ({ odId, count }));
}

export function getDailyLeaderboard(): Array<{ userId: string; count: number }> {
  const todayKey = getTodayKey();
  const todayMap = dailyTally.get(todayKey);
  if (!todayMap) return [];

  return Array.from(todayMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([userId, count]) => ({ userId, count }));
}

export function getFridayLeaderboard(): Array<{ userId: string; count: number }> {
  return Array.from(fridayTally.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([userId, count]) => ({ userId, count }));
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
    // Praise the top tributor
    const top = leaderboard[0];
    const phrase = getRandomPhrase(PRAISE_PHRASES);
    return phrase.replace('TOP_USER', `<@${top.odId}>`).replace('COUNT', String(top.count));
  } else {
    // Condemn the lowest (only if they have at least 1 tribute - don't call out people who never participated)
    const activeTributors = leaderboard.filter(u => u.count > 0);
    if (activeTributors.length < 2) return null;

    const lowest = activeTributors[activeTributors.length - 1];
    // Don't condemn if they're tied with the top
    if (lowest.count === leaderboard[0].count) return null;

    const phrase = getRandomPhrase(CONDEMNATION_PHRASES);
    return phrase.replace('LAZY_USER', `<@${lowest.odId}>`).replace('COUNT', String(lowest.count));
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

      // Milestone messages
      response += getMilestoneMessage(allTime);

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
        const allTime = getAllTimeTribute(p.userId);
        const fridayCount = getFridayTribute(p.userId);
        return `  - ${p.username} (All-time: ${allTime} | Fridays: ${fridayCount})`;
      }).join('\n');

      let response = `${getRandomPhrase(TRIBUTES_RECEIVED_STATUS)}\n\n**${fridayLabel}**: ${status.posts.length} offering${status.posts.length !== 1 ? 's' : ''} recorded.\n\n**Devoted mortals:**\n${devotees}`;

      // Add leaderboard teaser
      const leaderboard = getAllTimeLeaderboard();
      if (leaderboard.length > 0) {
        const top = leaderboard[0];
        response += `\n\n${ISEE_EMOJI} **Most devoted:** <@${top.odId}> with ${top.count} total tributes`;
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

/**
 * Handle a tribute via @mention with image attachment
 */
export function handleMentionTribute(
  userId: string,
  username: string,
  guildId: string,
  imageUrl: string,
  messageContent?: string
): { content: string } {
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

  if (isSpecialDay) {
    // Friday - extra dramatic!
    if (isTiki) {
      response = getRandomPhrase(TIKI_TRIBUTE_PHRASES);
    } else {
      response = getRandomPhrase(TRIBUTE_RECEIVED_PHRASES);
    }
    response += `\n\n**${username}** honors the SACRED FRIDAY RITUAL!`;
    response += `\n*Today: ${daily} | Fridays: ${fridayCount} | All-time: ${allTime}*`;
  } else {
    // Non-Friday
    if (isTiki) {
      response = `${ISEE_EMOJI} A TIKI OFFERING outside the sacred Friday? Your devotion runs DEEP, **${username}**...`;
    } else {
      response = getRandomPhrase(NON_FRIDAY_TRIBUTE_PHRASES);
      response += `\n\n**${username}**'s tribute has been recorded.`;
    }
    response += `\n*Today: ${daily} | All-time: ${allTime}*`;
  }

  // Maybe add random praise/condemnation
  const randomComment = maybeGetRandomComment();
  if (randomComment) {
    response += `\n\n${randomComment}`;
  }

  // Milestone messages
  response += getMilestoneMessage(allTime);

  return { content: response };
}

/**
 * Get milestone message if applicable
 */
function getMilestoneMessage(totalTributes: number): string {
  switch (totalTributes) {
    case 5:
      return `\n\n${ISEE_EMOJI} **FIVE TRIBUTES!** You have proven your devotion, mortal.`;
    case 10:
      return `\n\n${ISEE_EMOJI} **TEN TRIBUTES!** The spirits recognize you as a TRUE DEVOTEE.`;
    case 25:
      return `\n\n${ISEE_EMOJI} **TWENTY-FIVE TRIBUTES!** You have ascended to TIKI ELDER status!`;
    case 50:
      return `\n\n${ISEE_EMOJI} **FIFTY TRIBUTES!** The ancient ones BOW before your dedication!`;
    case 100:
      return `\n\n${ISEE_EMOJI} **ONE HUNDRED TRIBUTES!** You have achieved TIKI IMMORTALITY! Legends speak of your name!`;
    default:
      return '';
  }
}
