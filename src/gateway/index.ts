/**
 * Gateway Bot Entry Point
 *
 * Discord.js gateway bot for handling @mentions and scheduled events.
 * Deployed separately to Railway (Vercel handles slash commands).
 */

import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { handleMentionMessage } from './mentionHandler';
import { startFridayCron } from './fridayCron';

// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PARTY_CHANNEL_ID = process.env.PARTY_CHANNEL_ID;

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
client.once(Events.ClientReady, readyClient => {
  console.log(`MUTUMBOT AWAKENS...`);
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Serving ${readyClient.guilds.cache.size} guild(s)`);

  // Start Friday cron job if party channel is configured
  if (PARTY_CHANNEL_ID) {
    startFridayCron(client, PARTY_CHANNEL_ID);
    console.log(`Friday tribute demands will be posted to channel: ${PARTY_CHANNEL_ID}`);
  } else {
    console.log('No PARTY_CHANNEL_ID configured - Friday auto-demands disabled');
  }
});

// Event: Message received
client.on(Events.MessageCreate, async message => {
  // Ignore messages from bots (including self)
  if (message.author.bot) return;

  // Check if bot was mentioned
  if (client.user && message.mentions.has(client.user)) {
    try {
      await handleMentionMessage(message);
    } catch (error) {
      console.error('Error handling mention:', error);
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
