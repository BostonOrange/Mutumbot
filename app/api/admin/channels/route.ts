import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/src/db';
import { assignWorkflowToThread } from '@/src/services/agents';

export const dynamic = 'force-dynamic';

// Cache resolved Discord names for the lifetime of this request batch
// (avoids duplicate API calls for the same guild across rows)
interface DiscordNames {
  guild_name: string | null;
  channel_name: string | null;
  dm_username: string | null;
}

async function resolveDiscordNames(
  threadId: string,
  botToken: string | undefined
): Promise<DiscordNames> {
  const result: DiscordNames = { guild_name: null, channel_name: null, dm_username: null };
  if (!botToken) return result;

  const parts = threadId.split(':');
  if (parts.length !== 3 || parts[0] !== 'discord') return result;

  const headers = { Authorization: `Bot ${botToken}` };

  if (parts[1] === 'dm') {
    // DM channel — resolve the recipient user
    const channelId = parts[2];
    try {
      const channelRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, { headers });
      if (channelRes.ok) {
        const channel = await channelRes.json();
        // DM channels have a recipients array
        const recipient = channel.recipients?.[0];
        if (recipient) {
          result.dm_username = recipient.global_name || recipient.username || null;
          result.channel_name = `DM: ${result.dm_username}`;
        }
      }
    } catch {
      // Discord API unavailable
    }
  } else {
    // Guild channel
    const [, guildId, channelId] = parts;
    try {
      const [guildRes, channelRes] = await Promise.all([
        fetch(`https://discord.com/api/v10/guilds/${guildId}`, { headers }),
        fetch(`https://discord.com/api/v10/channels/${channelId}`, { headers }),
      ]);
      if (guildRes.ok) {
        const guild = await guildRes.json();
        result.guild_name = guild.name;
      }
      if (channelRes.ok) {
        const channel = await channelRes.json();
        result.channel_name = channel.name;
      }
    } catch {
      // Discord API unavailable
    }
  }

  return result;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!sql) {
      return NextResponse.json([]);
    }

    const rows = await sql`
      SELECT
        t.thread_id,
        t.workflow_id,
        w.name AS workflow_name,
        a.name AS agent_name,
        t.summary,
        t.summary_updated_at,
        t.updated_at,
        (SELECT COUNT(*)::int FROM thread_items ti WHERE ti.thread_id = t.thread_id) AS item_count
      FROM threads t
      LEFT JOIN workflows w ON t.workflow_id = w.id
      LEFT JOIN agents a ON w.agent_id = a.id
      ORDER BY t.workflow_id IS NOT NULL DESC, t.updated_at DESC
    `;

    // Resolve Discord names, deduplicating guild lookups
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const guildCache = new Map<string, string | null>();

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const threadId = row.thread_id as string;
        const names = await resolveDiscordNames(threadId, botToken);

        // Cache guild names to avoid redundant API calls
        const parts = threadId.split(':');
        if (parts[1] && parts[1] !== 'dm') {
          if (guildCache.has(parts[1])) {
            names.guild_name = guildCache.get(parts[1]) ?? null;
          } else {
            guildCache.set(parts[1], names.guild_name);
          }
        }

        return { ...row, ...names };
      })
    );

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    await assignWorkflowToThread(body.threadId, body.workflowId, {
      resetHistory: body.resetHistory,
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
