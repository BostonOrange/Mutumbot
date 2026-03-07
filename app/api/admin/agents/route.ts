import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getAgents, createAgent } from '@/src/services/agents';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agents = await getAgents();
    return NextResponse.json(agents);
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
    const agent = await createAgent(body.name, {
      description: body.description,
      systemPrompt: body.systemPrompt,
      customInstructions: body.customInstructions,
      capabilities: body.capabilities,
      model: body.model,
      params: body.params,
    });
    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
