/**
 * Tribute Tracker
 *
 * Tracks Friday tribute offerings to Mutumbot, the ancient tiki entity.
 * Mortals must prove their devotion by sharing images of their libations.
 */

import { TributePost, FridayStatus } from './types';
import {
  ISEE_EMOJI,
  getRandomPhrase,
  isTikiRelated,
  TRIBUTE_RECEIVED_PHRASES,
  TIKI_TRIBUTE_PHRASES,
  NOT_FRIDAY_PHRASES,
  NO_TRIBUTES_PHRASES,
  TRIBUTES_RECEIVED_STATUS,
} from './personality';

// In-memory storage (for production, use a database like Vercel KV or Upstash Redis)
const tributePosts: Map<string, TributePost[]> = new Map();

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
 * Record a tribute offering
 */
export function recordTributePost(post: TributePost): void {
  const key = getCurrentFridayKey();
  const posts = tributePosts.get(key) || [];
  posts.push(post);
  tributePosts.set(key, posts);
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
      if (!isFriday()) {
        return {
          content: getRandomPhrase(NOT_FRIDAY_PHRASES),
        };
      }

      recordTributePost({
        userId,
        username,
        timestamp: new Date().toISOString(),
        imageUrl,
        guildId,
      });

      // Check if this is a tiki-related tribute for bonus response
      const isTiki = messageContent ? isTikiRelated(messageContent) : false;
      if (isTiki && imageUrl) {
        return {
          content: `${getRandomPhrase(TIKI_TRIBUTE_PHRASES)}\n\n**${username}**'s tribute has been recorded in the ANCIENT LEDGER.`,
        };
      }

      if (imageUrl) {
        return {
          content: `${getRandomPhrase(TRIBUTE_RECEIVED_PHRASES)}\n\n**${username}**'s tribute has been recorded.`,
        };
      }

      // No image provided
      return {
        content: `${ISEE_EMOJI} I acknowledge your intent, **${username}**... but the ritual demands VISUAL PROOF. Attach an image of your libation!`,
      };
    }

    case 'status': {
      const status = getFridayStatus(guildId);
      const fridayLabel = isFriday() ? 'this sacred Friday' : `Friday (${status.date})`;

      if (!status.hasTributePost) {
        return {
          content: `${getRandomPhrase(NO_TRIBUTES_PHRASES)}\n\n**${fridayLabel}**: The offering hall stands EMPTY.${isFriday() ? '\n\nUse `/tribute offer` to make your offering!' : ''}`,
        };
      }

      const devotees = status.posts.map(p => `  - ${p.username}`).join('\n');
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
 * Handle a tribute via @mention with image attachment
 * Used by the gateway bot
 */
export function handleMentionTribute(
  userId: string,
  username: string,
  guildId: string,
  imageUrl: string,
  messageContent?: string
): { content: string } {
  if (!isFriday()) {
    return {
      content: getRandomPhrase(NOT_FRIDAY_PHRASES),
    };
  }

  // Record the tribute
  recordTributePost({
    userId,
    username,
    timestamp: new Date().toISOString(),
    imageUrl,
    guildId,
  });

  // Check if this is a tiki-related tribute
  const isTiki = messageContent ? isTikiRelated(messageContent) : false;

  if (isTiki) {
    return {
      content: `${getRandomPhrase(TIKI_TRIBUTE_PHRASES)}\n\n**${username}**'s tribute has been recorded in the ANCIENT LEDGER.`,
    };
  }

  return {
    content: `${getRandomPhrase(TRIBUTE_RECEIVED_PHRASES)}\n\n**${username}**'s tribute has been recorded.`,
  };
}
