/**
 * Gateway Bot Entry Point
 *
 * Discord.js gateway bot for handling @mentions and scheduled events.
 * Deployed separately to Railway (Vercel handles slash commands).
 */

import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { handleMentionMessage } from './mentionHandler';
import { startFridayCron, postImmediateDemand } from './fridayCron';
import { initializeDatabase, isDatabaseAvailable } from '../db';

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
  // Ignore messages from bots (including self)
  if (message.author.bot) return;

  // Check if this is a DM
  const isDM = !message.guild;

  // Check if bot was mentioned (in guilds)
  const wasMentioned = client.user && message.mentions.has(client.user);

  // Respond to DMs or @mentions
  if (isDM || wasMentioned) {
    console.log(`[MUTUMBOT] ${isDM ? 'DM' : 'Mention'} from ${message.author.tag}: "${message.content.slice(0, 50)}..."`);
    try {
      await handleMentionMessage(message);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }
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
