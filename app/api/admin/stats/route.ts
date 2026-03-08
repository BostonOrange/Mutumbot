import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { sql } from '@/src/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!sql) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 });
    }

    const [agentsResult, workflowsResult, channelsResult, knowledgeResult, memoriesResult] =
      await Promise.all([
        sql`SELECT COUNT(*) AS count FROM agents WHERE is_active = TRUE`,
        sql`SELECT COUNT(*) AS count FROM workflows WHERE is_active = TRUE`,
        sql`SELECT COUNT(*) AS count FROM threads WHERE workflow_id IS NOT NULL`,
        sql`SELECT COUNT(*) AS count FROM agent_knowledge`,
        sql`SELECT COUNT(*) AS count FROM user_memories`,
      ]);

    return NextResponse.json({
      agents: Number(agentsResult[0]?.count ?? 0),
      workflows: Number(workflowsResult[0]?.count ?? 0),
      channels: Number(channelsResult[0]?.count ?? 0),
      knowledge: Number(knowledgeResult[0]?.count ?? 0),
      memories: Number(memoriesResult[0]?.count ?? 0),
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
