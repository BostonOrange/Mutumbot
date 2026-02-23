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
import { initializeDatabase } from '../src/db';
import {
  handleDrinkQuestion,
  handleDrinkList,
  handleRandomDrinkFact,
  analyzeImage,
} from '../src/drink-questions';
import { ISEE_EMOJI, getRandomPhrase, TRIBUTE_DEMAND_PHRASES } from '../src/personality';
import { formatPersonalStats, formatLeaderboard } from '../src/formatters';

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const DISCORD_APP_ID = process.env.DISCORD_APP_ID || '';

/**
 * Edit the original deferred response
 */
async function editOriginalResponse(
  interactionToken: string,
  content: string
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${DISCORD_APP_ID}/${interactionToken}/messages/@original`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    console.error('Failed to edit response:', response.status, await response.text());
  }
}

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

  // Initialize database (creates tables if needed)
  try {
    await initializeDatabase();
  } catch (err) {
    console.error('Database initialization failed:', err);
    res.status(500).json({ error: 'Database not available' });
    return;
  }

  // Handle Application Commands (slash commands)
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;
    const deferredCommands = ['ask', 'drink', 'tribute'];

    // Check if this is a subcommand that needs deferring
    const subcommand = interaction.data?.options?.[0]?.name;
    const needsDefer = deferredCommands.includes(commandName || '') &&
      (commandName === 'ask' ||
       (commandName === 'drink' && (subcommand === 'ask' || subcommand === 'random')) ||
       (commandName === 'tribute' && subcommand === 'offer'));

    if (needsDefer) {
      // Return deferred response immediately
      res.status(200).json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

      // Process async and edit the response
      try {
        const response = await handleApplicationCommand(interaction);
        const content = response.data?.content || 'The spirits have spoken.';
        await editOriginalResponse(interaction.token, content);
      } catch (error) {
        console.error('Deferred command failed:', error);
        await editOriginalResponse(
          interaction.token,
          `${ISEE_EMOJI} The spirits encountered a DISTURBANCE. Try again, mortal.`
        );
      }
      return;
    }

    // Synchronous commands respond immediately
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
    // /tribute command
    case 'tribute': {
      const subcommand = options[0]?.name || 'status';
      let imageUrl: string | undefined;

      if (subcommand === 'offer') {
        const imageOption = options[0]?.options?.find(opt => opt.name === 'image');
        if (imageOption && interaction.data?.resolved?.attachments) {
          const attachmentId = imageOption.value as string;
          imageUrl = interaction.data.resolved.attachments[attachmentId]?.url;
        }

        // Try AI image analysis for better scoring
        if (imageUrl) {
          try {
            const analysis = await analyzeImage(imageUrl);
            if (analysis) {
              const { handleMentionTribute } = await import('../src/tribute-tracker');
              const result = await handleMentionTribute(
                userId, username, guildId, channelId || '', imageUrl, undefined, analysis
              );
              return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: result,
              };
            }
          } catch (error) {
            console.error('AI image analysis failed for slash tribute, falling back:', error);
          }
        }
      }

      const result = await handleTributeCommand(subcommand, userId, username, guildId, imageUrl);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    // /ask command
    case 'ask': {
      const questionOption = options.find(opt => opt.name === 'question');
      const question = (questionOption?.value as string) || '';
      const result = await handleDrinkQuestion(question, channelId);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    // /drink command (legacy)
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

      const result = handleDrinkList();
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    // /cheers command
    case 'cheers': {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} **THE SPIRITS RAISE THEIR VESSELS!**\n\nTo good fortune, ancient traditions, and the SACRED ELIXIRS that bind us all! CHEERS, mortals!`,
        },
      };
    }

    // /demand command
    case 'demand': {
      const subcommand = options[0]?.name || 'now';

      if (subcommand === 'now') {
        const demandMessage = getRandomPhrase(TRIBUTE_DEMAND_PHRASES);
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: demandMessage },
        };
      }

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} Use \`/demand now\` to trigger a tribute demand.`,
        },
      };
    }

    // /tally command
    case 'tally': {
      const subcommand = options[0]?.name || 'me';

      if (subcommand === 'me') {
        const [stats, allTimeBoard] = await Promise.all([
          getFullUserStats(userId, guildId),
          getAllTimeLeaderboard(50, guildId),
        ]);
        const rank = allTimeBoard.findIndex(e => e.userId === userId) + 1;
        const rankText = rank > 0 ? `#${rank} of ${allTimeBoard.length}` : 'Unranked';

        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: formatPersonalStats(username, stats, rankText),
          },
        };
      }

      if (subcommand === 'leaderboard') {
        const [allTimeRaw, dailyRaw, fridayRaw] = await Promise.all([
          getAllTimeLeaderboard(50, guildId),
          getDailyLeaderboard(20, guildId),
          getFridayLeaderboard(20, guildId),
        ]);

        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: formatLeaderboard(allTimeRaw.slice(0, 10), dailyRaw.slice(0, 5), fridayRaw.slice(0, 5)) },
        };
      }

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} Unknown tally command. Use \`/tally me\` or \`/tally leaderboard\`.`,
        },
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
