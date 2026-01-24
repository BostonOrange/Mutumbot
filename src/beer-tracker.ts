import { BeerPost, FridayStatus, Embed } from './types';

// In-memory storage (for production, use a database like Vercel KV or Upstash Redis)
const beerPosts: Map<string, BeerPost[]> = new Map();

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
 * Record a beer post
 */
export function recordBeerPost(post: BeerPost): void {
  const key = getCurrentFridayKey();
  const posts = beerPosts.get(key) || [];
  posts.push(post);
  beerPosts.set(key, posts);
}

/**
 * Get the status for the current Friday
 */
export function getFridayStatus(guildId: string): FridayStatus {
  const key = getCurrentFridayKey();
  const allPosts = beerPosts.get(key) || [];
  const guildPosts = allPosts.filter(p => p.guildId === guildId);

  return {
    date: key,
    hasBeerPost: guildPosts.length > 0,
    posts: guildPosts,
  };
}

/**
 * Generate a response for the /beer command
 */
export function handleBeerCommand(
  subcommand: string,
  userId: string,
  username: string,
  guildId: string,
  imageUrl?: string
): { content?: string; embeds?: Embed[] } {
  switch (subcommand) {
    case 'post': {
      if (!isFriday()) {
        return {
          content: '🍺 It\'s not Friday yet! Save your beer pic for Friday.',
        };
      }

      recordBeerPost({
        userId,
        username,
        timestamp: new Date().toISOString(),
        imageUrl,
        guildId,
      });

      return {
        embeds: [{
          title: '🍻 Friday Beer Posted!',
          description: `**${username}** has shared their Friday beer!`,
          color: 0xf5a623,
          fields: imageUrl ? [{ name: 'Image', value: '📷 Photo attached', inline: true }] : [],
          timestamp: new Date().toISOString(),
        }],
      };
    }

    case 'status': {
      const status = getFridayStatus(guildId);
      const fridayLabel = isFriday() ? 'Today' : `Friday (${status.date})`;

      if (!status.hasBeerPost) {
        return {
          embeds: [{
            title: '🍺 Friday Beer Status',
            description: `**${fridayLabel}**: No beer pics posted yet!`,
            color: 0xff6b6b,
            footer: { text: isFriday() ? 'Use /beer post to share your Friday beer!' : 'Wait for Friday to post!' },
          }],
        };
      }

      const participants = status.posts.map(p => `• ${p.username}`).join('\n');
      return {
        embeds: [{
          title: '🍻 Friday Beer Status',
          description: `**${fridayLabel}**: Beer has been posted! 🎉`,
          color: 0x2ecc71,
          fields: [
            { name: 'Participants', value: participants, inline: false },
            { name: 'Total Posts', value: `${status.posts.length}`, inline: true },
          ],
          footer: { text: 'Cheers to Friday! 🍻' },
        }],
      };
    }

    case 'reminder': {
      if (!isFriday()) {
        return {
          content: '📅 It\'s not Friday yet! I\'ll remind everyone when Friday comes.',
        };
      }

      const status = getFridayStatus(guildId);
      if (status.hasBeerPost) {
        return {
          content: '🍻 Great news! Someone already posted their Friday beer!',
        };
      }

      return {
        content: '🚨 **FRIDAY BEER REMINDER** 🚨\n\nIt\'s Friday and no one has posted their beer yet!\nUse `/beer post` to share your Friday beer! 🍺',
      };
    }

    default:
      return {
        content: 'Unknown beer command. Try `/beer post`, `/beer status`, or `/beer reminder`.',
      };
  }
}
