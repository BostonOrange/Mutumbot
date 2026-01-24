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
import { handleTributeCommand } from '../src/tribute-tracker';
import {
  handleDrinkQuestion,
  handleDrinkList,
  handleRandomDrinkFact,
} from '../src/drink-questions';
import { ISEE_EMOJI } from '../src/personality';

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
          content: `${ISEE_EMOJI} Unknown invocation. The spirits recognize: \`/tribute\`, \`/ask\`, \`/drink\`, or \`/cheers\`.`,
        },
      };
  }
}
