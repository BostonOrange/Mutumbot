/**
 * Discord Interactions Handler (Vercel Serverless Function)
 *
 * Handles slash commands for Mutumbot, the ominous tiki entity.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey } from 'discord-interactions';
import {
  DiscordInteraction,
  InteractionType,
  InteractionResponseType,
  InteractionResponse,
} from '../src/types';
import {
  handleTributeCommand,
  getFullUserStats,
  getAllTimeLeaderboard,
  getDailyLeaderboard,
  getFridayLeaderboard,
} from '../src/tribute-tracker';
import {
  handleDrinkQuestion,
  handleDrinkList,
  handleRandomDrinkFact,
} from '../src/drink-questions';
import { ISEE_EMOJI, getRandomPhrase, TRIBUTE_DEMAND_PHRASES } from '../src/personality';

// Store scheduled demands (in production, use Redis or similar)
const scheduledDemands: Map<string, { date: string; time: string; channelId: string }> = new Map();

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';

/**
 * Verify Discord interaction signature
 */
function verifyDiscordRequest(req: VercelRequest): boolean {
  const signature = req.headers['x-signature-ed25519'] as string;
  const timestamp = req.headers['x-signature-timestamp'] as string;

  if (!signature || !timestamp) {
    return false;
  }

  const rawBody = JSON.stringify(req.body);
  return verifyKey(rawBody, signature, timestamp, DISCORD_PUBLIC_KEY);
}

/**
 * Handle incoming Discord interactions
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Only allow POST requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify the request is from Discord
  if (!verifyDiscordRequest(req)) {
    res.status(401).json({ error: 'Invalid request signature' });
    return;
  }

  const interaction: DiscordInteraction = req.body;

  // Handle PING (required for Discord to verify the endpoint)
  if (interaction.type === InteractionType.PING) {
    const response: InteractionResponse = { type: InteractionResponseType.PONG };
    res.status(200).json(response);
    return;
  }

  // Handle Application Commands (slash commands)
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const response = await handleApplicationCommand(interaction);
    res.status(200).json(response);
    return;
  }

  // Default response for unhandled interaction types
  res.status(400).json({ error: 'Unknown interaction type' });
}

/**
 * Route application commands to their handlers
 */
async function handleApplicationCommand(
  interaction: DiscordInteraction
): Promise<InteractionResponse> {
  const commandName = interaction.data?.name;
  const options = interaction.data?.options || [];
  const userId = interaction.member?.user?.id || interaction.user?.id || 'unknown';
  const username =
    interaction.member?.user?.username || interaction.user?.username || 'Unknown Mortal';
  const guildId = interaction.guild_id || 'dm';
  const channelId = interaction.channel_id;

  switch (commandName) {
    // /tribute command (formerly /beer)
    case 'tribute': {
      const subcommand = options[0]?.name || 'status';
      let imageUrl: string | undefined;

      // Check for image attachment in offer subcommand
      if (subcommand === 'offer') {
        const imageOption = options[0]?.options?.find(opt => opt.name === 'image');
        if (imageOption && interaction.data?.resolved?.attachments) {
          const attachmentId = imageOption.value as string;
          imageUrl = interaction.data.resolved.attachments[attachmentId]?.url;
        }
      }

      const result = handleTributeCommand(subcommand, userId, username, guildId, imageUrl);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    // /ask command (direct questions, formerly /drink ask)
    case 'ask': {
      const questionOption = options.find(opt => opt.name === 'question');
      const question = (questionOption?.value as string) || '';
      const result = await handleDrinkQuestion(question, channelId);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    // /drink command (legacy, for list and random)
    case 'drink': {
      const subcommand = options[0]?.name || 'list';

      if (subcommand === 'ask') {
        const questionOption = options[0]?.options?.find(opt => opt.name === 'question');
        const question = (questionOption?.value as string) || '';
        const result = await handleDrinkQuestion(question, channelId);

        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: result,
        };
      }

      if (subcommand === 'random') {
        const result = await handleRandomDrinkFact();
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: result,
        };
      }

      // Default to list
      const result = handleDrinkList();
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    // /cheers command - now with ominous flair
    case 'cheers': {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} **THE SPIRITS RAISE THEIR VESSELS!**\n\nTo good fortune, ancient traditions, and the SACRED ELIXIRS that bind us all! CHEERS, mortals!`,
        },
      };
    }

    // /demand command - Admin only, trigger tribute demands
    case 'demand': {
      const subcommand = options[0]?.name || 'now';

      if (subcommand === 'now') {
        // Post an immediate demand
        const demandMessage = getRandomPhrase(TRIBUTE_DEMAND_PHRASES);
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: demandMessage,
          },
        };
      }

      if (subcommand === 'schedule') {
        const dateOption = options[0]?.options?.find(opt => opt.name === 'date');
        const timeOption = options[0]?.options?.find(opt => opt.name === 'time');
        const date = dateOption?.value as string;
        const time = timeOption?.value as string;

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `${ISEE_EMOJI} The spirits cannot comprehend this date format. Use YYYY-MM-DD (e.g., 2024-01-26).`,
            },
          };
        }

        // Validate time format
        if (!/^\d{2}:\d{2}$/.test(time)) {
          return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `${ISEE_EMOJI} The spirits cannot comprehend this time format. Use HH:MM in 24h format (e.g., 15:30).`,
            },
          };
        }

        // Store the scheduled demand (note: in-memory, won't persist across deploys)
        const demandId = `${guildId}-${Date.now()}`;
        scheduledDemands.set(demandId, { date, time, channelId });

        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `${ISEE_EMOJI} The spirits have MARKED their calendars...\n\n**Tribute demand scheduled for ${date} at ${time}** (Stockholm time).\n\n*Note: Scheduled demands require the gateway bot to be running. For immediate demands, use \`/demand now\`.*`,
          },
        };
      }

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} Unknown demand ritual. Use \`/demand now\` or \`/demand schedule\`.`,
        },
      };
    }

    // /tally command - View tribute stats and leaderboard
    case 'tally': {
      const subcommand = options[0]?.name || 'me';

      if (subcommand === 'me') {
        const stats = getFullUserStats(userId);
        const allTimeBoard = getAllTimeLeaderboard();
        const rank = allTimeBoard.findIndex(e => e.userId === userId) + 1;
        const rankText = rank > 0 ? `#${rank} of ${allTimeBoard.length}` : 'Unranked';

        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `${ISEE_EMOJI} **${username}**, the spirits reveal your devotion...\n\n` +
              `**All-Time:** ${stats.allTime.score} pts (${stats.allTime.count} tributes) - ${rankText}\n` +
              `**Fridays:** ${stats.friday.score} pts (${stats.friday.count} tributes)\n` +
              `**Today:** ${stats.daily.score} pts (${stats.daily.count} tributes)\n` +
              `**Private Devotion:** ${stats.private.score} pts (${stats.private.count} DM tributes)\n\n` +
              `*Scoring: Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt*`,
          },
        };
      }

      if (subcommand === 'leaderboard') {
        const allTime = getAllTimeLeaderboard().slice(0, 10);
        const daily = getDailyLeaderboard().slice(0, 5);
        const friday = getFridayLeaderboard().slice(0, 5);

        let content = `${ISEE_EMOJI} **THE SPIRITS REVEAL THE DEVOTED...**\n\n`;

        if (allTime.length > 0) {
          content += `**🏆 All-Time Rankings:**\n`;
          allTime.forEach((entry, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            content += `${medal} <@${entry.userId}> - ${entry.score}pts (${entry.count} tributes)\n`;
          });
        } else {
          content += `*No tributes yet... The spirits HUNGER.*\n`;
        }

        if (daily.length > 0) {
          content += `\n**📅 Today's Devoted:**\n`;
          daily.forEach((entry, i) => {
            content += `${i + 1}. <@${entry.userId}> - ${entry.score}pts\n`;
          });
        }

        if (friday.length > 0) {
          content += `\n**🗿 Friday Champions:**\n`;
          friday.forEach((entry, i) => {
            content += `${i + 1}. <@${entry.userId}> - ${entry.score}pts\n`;
          });
        }

        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content },
        };
      }

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} Unknown tally command. Use \`/tally me\` or \`/tally leaderboard\`.`,
        },
      };
    }

    // Legacy /beer command - redirect to /tribute
    case 'beer': {
      const subcommand = options[0]?.name || 'status';
      let imageUrl: string | undefined;

      if (subcommand === 'post') {
        const imageOption = options[0]?.options?.find(opt => opt.name === 'image');
        if (imageOption && interaction.data?.resolved?.attachments) {
          const attachmentId = imageOption.value as string;
          imageUrl = interaction.data.resolved.attachments[attachmentId]?.url;
        }
      }

      // Map old subcommands to new ones
      const subcommandMap: Record<string, string> = {
        post: 'offer',
        status: 'status',
        reminder: 'demand',
      };

      const mappedSubcommand = subcommandMap[subcommand] || subcommand;
      const result = handleTributeCommand(mappedSubcommand, userId, username, guildId, imageUrl);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    default:
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} Unknown invocation. The spirits recognize: \`/tribute\`, \`/ask\`, \`/tally\`, \`/demand\`, \`/drink\`, or \`/cheers\`.`,
        },
      };
  }
}
