import type { VercelRequest, VercelResponse } from '@vercel/node';

const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Slash command definitions
const commands = [
  {
    name: 'beer',
    description: 'Friday beer tracking commands',
    options: [
      {
        name: 'post',
        description: 'Post your Friday beer! 🍺',
        type: 1,
        options: [
          {
            name: 'image',
            description: 'Attach a picture of your beer',
            type: 11,
            required: false,
          },
        ],
      },
      {
        name: 'status',
        description: 'Check if someone has posted their Friday beer',
        type: 1,
      },
      {
        name: 'reminder',
        description: 'Send a reminder to post Friday beer',
        type: 1,
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
        type: 1,
        options: [
          {
            name: 'question',
            description: 'Your question about drinks (e.g., "What types of beer are there?")',
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: 'list',
        description: 'List all drink categories I know about',
        type: 1,
      },
      {
        name: 'random',
        description: 'Get a random drink fact',
        type: 1,
      },
    ],
  },
  {
    name: 'cheers',
    description: 'Send a cheers to the channel! 🍻',
  },
];

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
    res.status(500).json({
      error: 'Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN environment variables'
    });
    return;
  }

  const url = `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`;

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
      res.status(response.status).json({
        error: 'Failed to register commands',
        details: error
      });
      return;
    }

    const data = await response.json() as { name: string; id: string }[];
    res.status(200).json({
      success: true,
      message: `Successfully registered ${data.length} commands`,
      commands: data.map((cmd) => ({
        name: cmd.name,
        id: cmd.id,
      })),
      note: 'Global commands may take up to 1 hour to appear in Discord',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to register commands',
      details: String(error)
    });
  }
}
