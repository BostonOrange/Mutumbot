import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/src/db';
import { assignWorkflowToThread } from '@/src/services/agents';

export const dynamic = 'force-dynamic';

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

    // Resolve Discord channel/server names via bot token
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const parts = (row.thread_id as string).split(':');
        let guild_name: string | null = null;
        let channel_name: string | null = null;

        if (botToken && parts.length === 3 && parts[0] === 'discord' && parts[1] !== 'dm') {
          const [, guildId, channelId] = parts;
          try {
            const [guildRes, channelRes] = await Promise.all([
              fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${botToken}` },
              }),
              fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                headers: { Authorization: `Bot ${botToken}` },
              }),
            ]);
            if (guildRes.ok) {
              const guild = await guildRes.json();
              guild_name = guild.name;
            }
            if (channelRes.ok) {
              const channel = await channelRes.json();
              channel_name = channel.name;
            }
          } catch {
            // Discord API unavailable — fall back to IDs only
          }
        }

        return { ...row, guild_name, channel_name };
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
