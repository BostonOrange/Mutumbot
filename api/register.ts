/**
 * HTTP Endpoint for Command Registration
 *
 * Alternative to the CLI script for registering commands via HTTP request.
 * Useful for triggering registration from a webhook or manual request.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

// Slash command definitions (must match scripts/register-commands.ts)
const commands = [
  {
    name: 'tribute',
    description: 'Friday tribute offerings to the ancient tiki spirits',
    options: [
      {
        name: 'offer',
        description: 'Offer your Friday tribute to the spirits',
        type: 1,
        options: [
          {
            name: 'image',
            description: 'Visual proof of your offering (the spirits demand it!)',
            type: 11,
            required: false,
          },
        ],
      },
      {
        name: 'status',
        description: 'See who has honored the ritual this Friday',
        type: 1,
      },
      {
        name: 'demand',
        description: 'Invoke the spirits to demand tribute from mortals',
        type: 1,
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
        type: 3,
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
        type: 1,
        options: [
          {
            name: 'question',
            description: 'Your question about drinks',
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: 'list',
        description: 'Reveal what ancient knowledge the spirits possess',
        type: 1,
      },
      {
        name: 'random',
        description: 'Receive a random revelation from the tiki depths',
        type: 1,
      },
    ],
  },
  {
    name: 'cheers',
    description: 'Raise your vessel to the spirits!',
  },
];

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!DISCORD_APP_ID || !DISCORD_BOT_TOKEN) {
    res.status(500).json({
      error: 'Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN environment variables',
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
        details: error,
      });
      return;
    }

    const data = (await response.json()) as { name: string; id: string }[];
    res.status(200).json({
      success: true,
      message: `Successfully registered ${data.length} commands for MUTUMBOT`,
      commands: data.map(cmd => ({
        name: cmd.name,
        id: cmd.id,
      })),
      note: 'Global commands may take up to 1 hour to appear in Discord',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to register commands',
      details: String(error),
    });
  }
}
