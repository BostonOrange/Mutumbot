import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/src/db';
import { resetThread } from '@/src/services/threads';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { sessionId } = body as { sessionId?: string };

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // handleDrinkQuestion generates discord:dm:{sessionId} as the operating thread ID.
    // All data (thread items, runs, tool side effects) lives on this thread.
    const threadId = `discord:dm:${sessionId}`;

    // Reset thread (clears summary + thread_items)
    await resetThread(threadId, { clearSummary: true, clearItems: true });

    let scheduledEventsCount = 0;
    let knowledgeFactsCount = 0;

    if (sql) {
      // Delete scheduled events created during this session
      const events = await sql`
        DELETE FROM scheduled_events
        WHERE thread_id = ${threadId}
        RETURNING id
      `;
      scheduledEventsCount = events.length;

      // Delete agent knowledge facts learned during this session
      const facts = await sql`
        DELETE FROM agent_knowledge
        WHERE source_thread_id = ${threadId}
        RETURNING id
      `;
      knowledgeFactsCount = facts.length;
    }

    console.log(
      `[Playground] Session ${sessionId} cleaned up — ` +
        `scheduled_events: ${scheduledEventsCount}, knowledge_facts: ${knowledgeFactsCount}`
    );

    return NextResponse.json({
      ok: true,
      threadId,
      cleaned: {
        thread: true,
        scheduledEvents: scheduledEventsCount,
        knowledgeFacts: knowledgeFactsCount,
      },
    });
  } catch (error) {
    console.error('[Playground] Session cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
