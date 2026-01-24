import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyKey } from 'discord-interactions';
import {
  DiscordInteraction,
  InteractionType,
  InteractionResponseType,
  InteractionResponse,
} from '../src/types';
import { handleBeerCommand } from '../src/beer-tracker';
import { handleDrinkQuestion, handleDrinkList, handleRandomDrinkFact } from '../src/drink-questions';

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
async function handleApplicationCommand(interaction: DiscordInteraction): Promise<InteractionResponse> {
  const commandName = interaction.data?.name;
  const options = interaction.data?.options || [];
  const userId = interaction.member?.user?.id || interaction.user?.id || 'unknown';
  const username = interaction.member?.user?.username || interaction.user?.username || 'Unknown User';
  const guildId = interaction.guild_id || 'dm';

  switch (commandName) {
    case 'beer': {
      const subcommand = options[0]?.name || 'status';
      let imageUrl: string | undefined;

      // Check for image attachment in post subcommand
      if (subcommand === 'post') {
        const imageOption = options[0]?.options?.find(opt => opt.name === 'image');
        if (imageOption && interaction.data?.resolved?.attachments) {
          const attachmentId = imageOption.value as string;
          imageUrl = interaction.data.resolved.attachments[attachmentId]?.url;
        }
      }

      const result = handleBeerCommand(subcommand, userId, username, guildId, imageUrl);

      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }

    case 'drink': {
      const subcommand = options[0]?.name || 'list';

      if (subcommand === 'ask') {
        const questionOption = options[0]?.options?.find(opt => opt.name === 'question');
        const question = (questionOption?.value as string) || '';
        const result = await handleDrinkQuestion(question);

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

    case 'cheers': {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '🍻 **CHEERS!** 🍻\n\nHere\'s to good times and great drinks! 🥂',
        },
      };
    }

    default:
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: 'Unknown command. Try `/beer`, `/drink`, or `/cheers`!',
        },
      };
  }
}
