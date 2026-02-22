/**
 * Script to register slash commands with Discord
 *
 * Run with: npm run register
 *
 * Make sure to set the following environment variables:
 * - DISCORD_APP_ID
 * - DISCORD_BOT_TOKEN
 * - DISCORD_GUILD_ID (optional, for guild-specific commands during development)
 */

console.log('Starting registration script...');

import * as dotenv from 'dotenv';
dotenv.config();

console.log('Loaded env, APP_ID:', process.env.DISCORD_APP_ID ? 'SET' : 'NOT SET');

const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
  console.error('Missing required environment variables: DISCORD_APP_ID and DISCORD_BOT_TOKEN');
  process.exit(1);
}

// Slash command definitions
const commands = [
  {
    name: 'tribute',
    description: 'Friday tribute offerings to the ancient tiki spirits',
    options: [
      {
        name: 'offer',
        description: 'Offer your Friday tribute to the spirits',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'image',
            description: 'Visual proof of your offering (the spirits demand it!)',
            type: 11, // ATTACHMENT
            required: false,
          },
        ],
      },
      {
        name: 'status',
        description: 'See who has honored the ritual this Friday',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'demand',
        description: 'Invoke the spirits to demand tribute from mortals',
        type: 1, // SUB_COMMAND
      },
    ],
  },
  {
    name: 'ask',
    description: 'Seek ancient wisdom about drinks and libations',
    options: [
      {
        name: 'question',
        description: 'Your question for the tiki spirits',
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: 'drink',
    description: 'Consult the ancient knowledge of beverages',
    options: [
      {
        name: 'ask',
        description: 'Ask a question about any drink (use /ask for a simpler command)',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'question',
            description: 'Your question about drinks',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'list',
        description: 'Reveal what ancient knowledge the spirits possess',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'random',
        description: 'Receive a random revelation from the tiki depths',
        type: 1, // SUB_COMMAND
      },
    ],
  },
  {
    name: 'cheers',
    description: 'Raise your vessel to the spirits!',
  },
  {
    name: 'tally',
    description: 'Check tribute scores and rankings',
    options: [
      {
        name: 'me',
        description: 'View your personal tribute stats',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'leaderboard',
        description: 'View the tribute leaderboard',
        type: 1, // SUB_COMMAND
      },
    ],
  },
  {
    name: 'demand',
    description: 'Invoke the spirits to demand tribute',
    options: [
      {
        name: 'now',
        description: 'Post an immediate tribute demand',
        type: 1, // SUB_COMMAND
      },
    ],
  },
];

async function registerCommands(): Promise<void> {
  // Use guild-specific endpoint for faster updates during development
  // Use global endpoint for production
  const url = DISCORD_GUILD_ID
    ? `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`;

  console.log(`Registering ${commands.length} commands...`);
  console.log(`Target: ${DISCORD_GUILD_ID ? `Guild ${DISCORD_GUILD_ID}` : 'Global'}`);

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(commands),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to register commands: ${response.status} ${response.statusText}`);
      console.error(error);
      process.exit(1);
    }

    const data = (await response.json()) as { name: string; id: string }[];
    console.log(`Successfully registered ${data.length} commands:`);
    data.forEach(cmd => {
      console.log(`  - /${cmd.name} (ID: ${cmd.id})`);
    });

    if (!DISCORD_GUILD_ID) {
      console.log('\nNote: Global commands may take up to 1 hour to propagate.');
    }
  } catch (error) {
    console.error('Error registering commands:', error);
    process.exit(1);
  }
}

registerCommands();
