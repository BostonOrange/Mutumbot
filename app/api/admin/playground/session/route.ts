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

    // The playground uses admin:playground:{sessionId} as the primary thread ID.
    // handleDrinkQuestion internally builds discord:dm:{sessionId} when the channel
    // ID is passed directly, so we clean up both to avoid orphaned data.
    const primaryThreadId = `admin:playground:${sessionId}`;
    const internalThreadId = `discord:dm:${sessionId}`;

    // Reset both threads (clears summary + thread_items)
    await resetThread(primaryThreadId, { clearSummary: true, clearItems: true });
    await resetThread(internalThreadId, { clearSummary: true, clearItems: true });

    // Delete scheduled events for both thread IDs
    let scheduledEventsCount = 0;
    if (sql) {
      const primaryEvents = await sql`
        DELETE FROM scheduled_events
        WHERE thread_id = ${primaryThreadId}
        RETURNING id
      `;
      const internalEvents = await sql`
        DELETE FROM scheduled_events
        WHERE thread_id = ${internalThreadId}
        RETURNING id
      `;
      scheduledEventsCount = primaryEvents.length + internalEvents.length;
    }

    // Delete agent knowledge facts sourced from both thread IDs
    let knowledgeFactsCount = 0;
    if (sql) {
      const primaryFacts = await sql`
        DELETE FROM agent_knowledge
        WHERE source_thread_id = ${primaryThreadId}
        RETURNING id
      `;
      const internalFacts = await sql`
        DELETE FROM agent_knowledge
        WHERE source_thread_id = ${internalThreadId}
        RETURNING id
      `;
      knowledgeFactsCount = primaryFacts.length + internalFacts.length;
    }

    console.log(
      `[Playground] Session ${sessionId} cleaned up — ` +
        `scheduled_events: ${scheduledEventsCount}, knowledge_facts: ${knowledgeFactsCount}`
    );

    return NextResponse.json({
      ok: true,
      threadId: primaryThreadId,
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
