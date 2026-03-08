import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  getScheduledEvents,
  createScheduledEvent,
  updateScheduledEvent,
  deleteScheduledEvent,
} from '@/src/services/agents';
import type { EventType, ScheduledEventPayload } from '@/src/services/agents';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const threadId = searchParams.get('threadId') ?? undefined;
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const events = await getScheduledEvents({ threadId, activeOnly: activeOnly || undefined });

    // Serialize dates to ISO strings for JSON transport
    const serialized = events.map((e) => ({
      ...e,
      lastRunAt: e.lastRunAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    }));

    return NextResponse.json(serialized);
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
    const { name, threadId, cronExpression, eventType, description, payload, timezone, guildName, channelName } = body;

    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 });
    if (!cronExpression) return NextResponse.json({ error: 'cronExpression is required' }, { status: 400 });
    if (!eventType) return NextResponse.json({ error: 'eventType is required' }, { status: 400 });

    const created = await createScheduledEvent(
      name as string,
      threadId as string,
      cronExpression as string,
      eventType as EventType,
      {
        description: description ?? undefined,
        payload: (payload ?? {}) as ScheduledEventPayload,
        timezone: timezone ?? 'Europe/Stockholm',
        guildName: guildName ?? undefined,
        channelName: channelName ?? undefined,
      }
    );

    const serialized = {
      ...created,
      lastRunAt: created.lastRunAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };

    return NextResponse.json(serialized, { status: 201 });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, name, description, cronExpression, eventType, payload, timezone, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updates: Parameters<typeof updateScheduledEvent>[1] = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (cronExpression !== undefined) updates.cronExpression = cronExpression;
    if (eventType !== undefined) updates.eventType = eventType as EventType;
    if (payload !== undefined) updates.payload = payload as ScheduledEventPayload;
    if (timezone !== undefined) updates.timezone = timezone;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await updateScheduledEvent(id as string, updates);
    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const deleted = await deleteScheduledEvent(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
