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
      SELECT t.thread_id, t.workflow_id, w.name AS workflow_name, a.name AS agent_name
      FROM threads t
      LEFT JOIN workflows w ON t.workflow_id = w.id
      LEFT JOIN agents a ON w.agent_id = a.id
      WHERE t.workflow_id IS NOT NULL
      ORDER BY t.updated_at DESC
    `;

    return NextResponse.json(rows);
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
