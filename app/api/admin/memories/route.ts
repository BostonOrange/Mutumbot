import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/src/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!sql) {
      return NextResponse.json([]);
    }

    const { searchParams } = request.nextUrl;
    const userId = searchParams.get('userId');

    const rows = userId
      ? await sql`
          SELECT * FROM user_memories
          WHERE user_id = ${userId}
          ORDER BY last_updated_at DESC
        `
      : await sql`
          SELECT * FROM user_memories
          ORDER BY last_updated_at DESC
        `;

    return NextResponse.json(rows);
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
