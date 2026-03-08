import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getWorkflows, createWorkflow } from '@/src/services/agents';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const workflows = await getWorkflows();
    return NextResponse.json(workflows);
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
    const workflow = await createWorkflow(body.name, body.agentId, {
      description: body.description,
      contextPolicy: body.contextPolicy,
    });
    return NextResponse.json(workflow, { status: 201 });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
