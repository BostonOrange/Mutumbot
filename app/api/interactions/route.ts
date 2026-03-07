/**
 * Discord Interactions Handler (Next.js App Router Route)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyKey } from 'discord-interactions';
import {
  DiscordInteraction,
  InteractionType,
  InteractionResponseType,
  InteractionResponse,
} from '@/src/types';
import {
  handleTributeCommand,
  getFullUserStats,
  getAllTimeLeaderboard,
  getDailyLeaderboard,
  getFridayLeaderboard,
} from '@/src/tribute-tracker';
import { initializeDatabase } from '@/src/db';
import {
  handleDrinkQuestion,
  handleDrinkList,
  handleRandomDrinkFact,
  analyzeImage,
} from '@/src/drink-questions';
import { ISEE_EMOJI, getRandomPhrase, TRIBUTE_DEMAND_PHRASES } from '@/src/personality';
import { formatPersonalStats, formatLeaderboard } from '@/src/formatters';

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const DISCORD_APP_ID = process.env.DISCORD_APP_ID || '';

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

function verifyDiscordRequest(
  rawBody: string,
  signature: string,
  timestamp: string
): boolean {
  if (!signature || !timestamp) {
    return false;
  }
  return verifyKey(rawBody, signature, timestamp, DISCORD_PUBLIC_KEY);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature-ed25519') || '';
  const timestamp = request.headers.get('x-signature-timestamp') || '';

  if (!verifyDiscordRequest(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
  }

  const interaction: DiscordInteraction = JSON.parse(rawBody);

  if (interaction.type === InteractionType.PING) {
    const response: InteractionResponse = { type: InteractionResponseType.PONG };
    return NextResponse.json(response);
  }

  try {
    await initializeDatabase();
  } catch (err) {
    console.error('Database initialization failed:', err);
    return NextResponse.json({ error: 'Database not available' }, { status: 500 });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const commandName = interaction.data?.name;
    const subcommand = interaction.data?.options?.[0]?.name;
    const deferredCommands = ['ask', 'drink', 'tribute'];
    const needsDefer =
      deferredCommands.includes(commandName || '') &&
      (commandName === 'ask' ||
        (commandName === 'drink' && (subcommand === 'ask' || subcommand === 'random')) ||
        (commandName === 'tribute' && subcommand === 'offer'));

    if (needsDefer) {
      // Fire-and-forget: start background work before returning the deferred response.
      // Next.js App Router cannot continue processing after the response is returned,
      // so we kick off the async work here and let it resolve via editOriginalResponse.
      handleApplicationCommand(interaction)
        .then(async (response) => {
          const content = response.data?.content || 'The spirits have spoken.';
          await editOriginalResponse(interaction.token, content);
        })
        .catch(async (error) => {
          console.error('Deferred command failed:', error);
          await editOriginalResponse(
            interaction.token,
            `${ISEE_EMOJI} The spirits encountered a DISTURBANCE. Try again, mortal.`
          );
        });

      return NextResponse.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });
    }

    const response = await handleApplicationCommand(interaction);
    return NextResponse.json(response);
  }

  return NextResponse.json({ error: 'Unknown interaction type' }, { status: 400 });
}

async function handleApplicationCommand(
  interaction: DiscordInteraction
): Promise<InteractionResponse> {
  const commandName = interaction.data?.name;
  const options = interaction.data?.options || [];
  const userId = interaction.member?.user?.id || interaction.user?.id || 'unknown';
  const username =
    interaction.member?.user?.username || interaction.user?.username || 'Unknown Mortal';
  const guildId = interaction.guild_id || 'dm';
  const guildIdOrNull = interaction.guild_id || null;
  const channelId = interaction.channel_id;

  switch (commandName) {
    case 'tribute': {
      const subcommand = options[0]?.name || 'status';
      let imageUrl: string | undefined;
      if (subcommand === 'offer') {
        const imageOption = options[0]?.options?.find((opt) => opt.name === 'image');
        if (imageOption && interaction.data?.resolved?.attachments) {
          const attachmentId = imageOption.value as string;
          imageUrl = interaction.data.resolved.attachments[attachmentId]?.url;
        }
        if (imageUrl) {
          try {
            const analysis = await analyzeImage(imageUrl);
            if (analysis) {
              const { handleMentionTribute } = await import('@/src/tribute-tracker');
              const result = await handleMentionTribute(
                userId,
                username,
                guildId,
                channelId || '',
                imageUrl,
                undefined,
                analysis
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
    case 'ask': {
      const questionOption = options.find((opt) => opt.name === 'question');
      const question = (questionOption?.value as string) || '';
      const result = await handleDrinkQuestion(
        question,
        channelId,
        undefined,
        undefined,
        guildIdOrNull,
        userId,
        username
      );
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: result,
      };
    }
    case 'drink': {
      const subcommand = options[0]?.name || 'list';
      if (subcommand === 'ask') {
        const questionOption = options[0]?.options?.find((opt) => opt.name === 'question');
        const question = (questionOption?.value as string) || '';
        const result = await handleDrinkQuestion(
          question,
          channelId,
          undefined,
          undefined,
          guildIdOrNull,
          userId,
          username
        );
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
    case 'cheers': {
      return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `${ISEE_EMOJI} **THE SPIRITS RAISE THEIR VESSELS!**\n\nTo good fortune, ancient traditions, and the SACRED ELIXIRS that bind us all! CHEERS, mortals!`,
        },
      };
    }
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
    case 'tally': {
      const subcommand = options[0]?.name || 'me';
      if (subcommand === 'me') {
        const [stats, allTimeBoard] = await Promise.all([
          getFullUserStats(userId, guildId),
          getAllTimeLeaderboard(50, guildId),
        ]);
        const rank = allTimeBoard.findIndex((e) => e.userId === userId) + 1;
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
          data: {
            content: formatLeaderboard(
              allTimeRaw.slice(0, 10),
              dailyRaw.slice(0, 5),
              fridayRaw.slice(0, 5)
            ),
          },
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
