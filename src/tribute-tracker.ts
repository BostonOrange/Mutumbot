/**
 * Tribute Tracker
 *
 * Tracks tribute offerings to Mutumbot, the ancient tiki entity.
 * Mortals prove their devotion by sharing images of their libations.
 * Tributes are accepted any day, but Fridays are SACRED.
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

// In-memory storage (for production, use a database like Vercel KV or Upstash Redis)
const tributePosts: Map<string, TributePost[]> = new Map();

// Track total tributes per user (persists across weeks)
const userTributeTally: Map<string, number> = new Map();

/**
 * Get the current Friday's date key (YYYY-MM-DD format)
 */
export function getCurrentFridayKey(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();

  // If it's Friday (5), use today
  // Otherwise, find the most recent Friday
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

/**
 * Record a tribute offering and update tally
 */
export function recordTributePost(post: TributePost): void {
  const key = getCurrentFridayKey();
  const posts = tributePosts.get(key) || [];
  posts.push(post);
  tributePosts.set(key, posts);

  // Update user's total tally
  const currentTally = userTributeTally.get(post.userId) || 0;
  userTributeTally.set(post.userId, currentTally + 1);
}

/**
 * Get a user's total tribute count
 */
export function getUserTributeCount(userId: string): number {
  return userTributeTally.get(userId) || 0;
}

/**
 * Get the tribute leaderboard
 */
export function getTributeLeaderboard(limit: number = 5): Array<{ odId: string; count: number }> {
  return Array.from(userTributeTally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([odId, count]) => ({ odId, count }));
}

/**
 * Get the status for the current Friday
 */
export function getFridayStatus(guildId: string): FridayStatus {
  const key = getCurrentFridayKey();
  const allPosts = tributePosts.get(key) || [];
  const guildPosts = allPosts.filter(p => p.guildId === guildId);

  return {
    date: key,
    hasTributePost: guildPosts.length > 0,
    posts: guildPosts,
  };
}

/**
 * Check if a user has already offered tribute this Friday
 */
export function hasUserOfferedTribute(userId: string, guildId: string): boolean {
  const key = getCurrentFridayKey();
  const allPosts = tributePosts.get(key) || [];
  return allPosts.some(p => p.userId === userId && p.guildId === guildId);
}

/**
 * Generate a response for the /tribute command
 */
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

      const totalTributes = getUserTributeCount(userId);
      const isTiki = messageContent ? isTikiRelated(messageContent) : false;
      const isSpecialDay = isFriday();

      // Build response based on context
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

      // Add Friday bonus message
      if (isSpecialDay) {
        response += `\n\n**${username}** honors the SACRED FRIDAY RITUAL!`;
      } else {
        response += `\n\n**${username}**'s tribute has been recorded.`;
      }

      // Add tally
      response += `\n*Total tributes from this devotee: ${totalTributes}*`;

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
        const total = getUserTributeCount(p.userId);
        return `  - ${p.username} (${total} total)`;
      }).join('\n');

      return {
        content: `${getRandomPhrase(TRIBUTES_RECEIVED_STATUS)}\n\n**${fridayLabel}**: ${status.posts.length} offering${status.posts.length !== 1 ? 's' : ''} recorded.\n\n**Devoted mortals:**\n${devotees}`,
      };
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
 * Phrases for non-Friday tributes (still accepted, just different vibe)
 */
const NON_FRIDAY_TRIBUTE_PHRASES = [
  `${ISEE_EMOJI} An offering outside the sacred Friday? Your devotion is... NOTED.`,
  `${ISEE_EMOJI} The spirits did not DEMAND this tribute... but they accept it nonetheless.`,
  `${ISEE_EMOJI} UNEXPECTED... but welcome. Your offering pleases the ancient ones.`,
  `${ISEE_EMOJI} A tribute on a common day? You seek FAVOR with the spirits...`,
];

/**
 * Handle a tribute via @mention with image attachment
 * Used by the gateway bot - accepts tributes ANY day
 */
export function handleMentionTribute(
  userId: string,
  username: string,
  guildId: string,
  imageUrl: string,
  messageContent?: string
): { content: string } {
  // Record the tribute (any day now!)
  recordTributePost({
    userId,
    username,
    timestamp: new Date().toISOString(),
    imageUrl,
    guildId,
  });

  const totalTributes = getUserTributeCount(userId);
  const isTiki = messageContent ? isTikiRelated(messageContent) : false;
  const isSpecialDay = isFriday();

  let response: string;

  // Different responses for Friday vs other days
  if (isSpecialDay) {
    // Friday - extra dramatic!
    if (isTiki) {
      response = getRandomPhrase(TIKI_TRIBUTE_PHRASES);
    } else {
      response = getRandomPhrase(TRIBUTE_RECEIVED_PHRASES);
    }
    response += `\n\n**${username}** honors the SACRED FRIDAY RITUAL!`;
  } else {
    // Non-Friday - still accepted but different vibe
    if (isTiki) {
      response = `${ISEE_EMOJI} A TIKI OFFERING outside the sacred Friday? Your devotion runs DEEP, **${username}**...`;
    } else {
      response = getRandomPhrase(NON_FRIDAY_TRIBUTE_PHRASES);
      response += `\n\n**${username}**'s tribute has been recorded.`;
    }
  }

  // Add tally
  response += `\n*Total tributes: ${totalTributes}*`;

  // Milestone messages
  if (totalTributes === 5) {
    response += `\n\n${ISEE_EMOJI} **FIVE TRIBUTES!** You have proven your devotion, mortal.`;
  } else if (totalTributes === 10) {
    response += `\n\n${ISEE_EMOJI} **TEN TRIBUTES!** The spirits recognize you as a TRUE DEVOTEE.`;
  } else if (totalTributes === 25) {
    response += `\n\n${ISEE_EMOJI} **TWENTY-FIVE TRIBUTES!** You have ascended to TIKI ELDER status!`;
  } else if (totalTributes === 50) {
    response += `\n\n${ISEE_EMOJI} **FIFTY TRIBUTES!** The ancient ones BOW before your dedication!`;
  }

  return { content: response };
}
