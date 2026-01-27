/**
 * Gateway Bot Entry Point
 *
 * Discord.js gateway bot for handling @mentions and scheduled events.
 * Deployed separately to Railway (Vercel handles slash commands).
 *
 * Now includes message ingestion for building LLM context from
 * recent channel history.
 */

import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { handleMentionMessage } from './mentionHandler';
import { startFridayCron, postImmediateDemand } from './fridayCron';
import { startRetentionJob } from './retentionJob';
import { initializeDatabase, isDatabaseAvailable } from '../db';
import {
  ingestMessageCreate,
  ingestMessageUpdate,
  ingestMessageDelete,
  ingestBotMessage,
} from '../services/messageIngestor';
import { registerChannelLookup } from '../services/tools';

// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PARTY_CHANNEL_ID = process.env.PARTY_CHANNEL_ID;
const POST_DEMAND_ON_STARTUP = process.env.POST_DEMAND_ON_STARTUP === 'true';

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN environment variable');
  process.exit(1);
}

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Privileged intent - must enable in Developer Portal
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // Required for DM support
});

// Event: Bot is ready
client.once(Events.ClientReady, async readyClient => {
  console.log(`MUTUMBOT AWAKENS...`);
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Serving ${readyClient.guilds.cache.size} guild(s)`);

  // Initialize database for persistent storage
  try {
    await initializeDatabase();
    console.log(`Database: ${isDatabaseAvailable() ? 'Connected (Neon DB)' : 'Not available (using in-memory fallback)'}`);
  } catch (error) {
    console.error('Database initialization failed:', error);
    console.log('Continuing with in-memory storage...');
  }

  // Start message retention cleanup job (runs every hour)
  startRetentionJob();
  console.log('Message retention job started (purges messages older than 4h)');

  // Register channel lookup for AI tools
  registerChannelLookup(async (guildId: string) => {
    const guild = readyClient.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error(`Guild not found: ${guildId}`);
    }

    // Fetch channels if not cached
    const channels = await guild.channels.fetch();

    return Array.from(channels.values())
      .filter(c => c !== null)
      .map(channel => ({
        id: channel!.id,
        name: channel!.name,
        type: channel!.isTextBased() ? 'text' as const :
              channel!.isVoiceBased() ? 'voice' as const :
              'other' as const,
      }));
  });
  console.log('Channel lookup registered for AI tools');

  // Start Friday cron job if party channel is configured
  if (PARTY_CHANNEL_ID) {
    startFridayCron(client, PARTY_CHANNEL_ID);
    console.log(`Friday tribute demands will be posted to channel: ${PARTY_CHANNEL_ID}`);

    // Post immediate demand if requested (one-off, for testing)
    if (POST_DEMAND_ON_STARTUP) {
      console.log('POST_DEMAND_ON_STARTUP is set - posting immediate demand...');
      await postImmediateDemand(client, PARTY_CHANNEL_ID);
    }
  } else {
    console.log('No PARTY_CHANNEL_ID configured - Friday auto-demands disabled');
  }
});

// Event: Message received
client.on(Events.MessageCreate, async message => {
  const botUserId = client.user?.id || '';

  // Ingest ALL messages (including bot messages) for context building
  // This runs async - we don't await to avoid slowing down responses
  if (!message.author.bot) {
    ingestMessageCreate(message, botUserId).catch(err =>
      console.error('[Ingestor] Error ingesting message:', err)
    );
  }

  // Ignore messages from bots (including self) for response handling
  if (message.author.bot) return;

  // Check if this is a DM
  const isDM = !message.guild;

  // Check if bot was mentioned (in guilds)
  const wasMentioned = client.user && message.mentions.has(client.user);

  // Respond to DMs or @mentions
  if (isDM || wasMentioned) {
    console.log(`[MUTUMBOT] ${isDM ? 'DM' : 'Mention'} from ${message.author.tag}: "${message.content.slice(0, 50)}..."`);
    try {
      const reply = await handleMentionMessage(message);

      // Ingest the bot's own reply for context continuity
      if (reply) {
        ingestBotMessage(reply, botUserId).catch(err =>
          console.error('[Ingestor] Error ingesting bot reply:', err)
        );
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }
});

// Event: Message edited
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  // Ingest updates to keep context accurate
  if (newMessage.partial) {
    try {
      await newMessage.fetch();
    } catch {
      return; // Can't fetch, skip
    }
  }
  ingestMessageUpdate(newMessage).catch(err =>
    console.error('[Ingestor] Error updating message:', err)
  );
});

// Event: Message deleted
client.on(Events.MessageDelete, async message => {
  // Mark as deleted in context store
  ingestMessageDelete(message.id).catch(err =>
    console.error('[Ingestor] Error marking message deleted:', err)
  );
});

// Event: Error handling
client.on(Events.Error, error => {
  console.error('Discord client error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  client.destroy();
  process.exit(0);
});

// Login to Discord
client.login(DISCORD_BOT_TOKEN).catch(error => {
  console.error('Failed to login:', error);
  process.exit(1);
});
