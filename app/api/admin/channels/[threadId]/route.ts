import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/src/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!sql) {
      return NextResponse.json({ items: [], summary: null });
    }

    const { threadId } = await params;
    // threadId comes URL-encoded (colons → %3A)
    const decodedThreadId = decodeURIComponent(threadId);

    const [items, thread] = await Promise.all([
      sql`
        SELECT id, type, role, author_id, author_name, content, created_at, metadata
        FROM thread_items
        WHERE thread_id = ${decodedThreadId}
          AND type IN ('user_message', 'assistant_message')
        ORDER BY created_at DESC
        LIMIT 50
      `,
      sql`
        SELECT summary, summary_updated_at
        FROM threads
        WHERE thread_id = ${decodedThreadId}
      `,
    ]);

    return NextResponse.json({
      items,
      summary: thread[0]?.summary ?? null,
      summaryUpdatedAt: thread[0]?.summary_updated_at ?? null,
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
