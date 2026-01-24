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
    name: 'beer',
    description: 'Friday beer tracking commands',
    options: [
      {
        name: 'post',
        description: 'Post your Friday beer! 🍺',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'image',
            description: 'Attach a picture of your beer',
            type: 11, // ATTACHMENT
            required: false,
          },
        ],
      },
      {
        name: 'status',
        description: 'Check if someone has posted their Friday beer',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'reminder',
        description: 'Send a reminder to post Friday beer',
        type: 1, // SUB_COMMAND
      },
    ],
  },
  {
    name: 'drink',
    description: 'Ask questions about drinks and beverages',
    options: [
      {
        name: 'ask',
        description: 'Ask a question about any drink',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'question',
            description: 'Your question about drinks (e.g., "What types of beer are there?")',
            type: 3, // STRING
            required: true,
          },
        ],
      },
      {
        name: 'list',
        description: 'List all drink categories I know about',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'random',
        description: 'Get a random drink fact',
        type: 1, // SUB_COMMAND
      },
    ],
  },
  {
    name: 'cheers',
    description: 'Send a cheers to the channel! 🍻',
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

    const data = await response.json();
    console.log(`Successfully registered ${data.length} commands:`);
    data.forEach((cmd: { name: string; id: string }) => {
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
