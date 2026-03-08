import { auth } from '@/lib/auth';
import { NextRequest } from 'next/server';
import { sql } from '@/src/db';
import { handleDrinkQuestion } from '@/src/drink-questions';
import { assignWorkflowToThread } from '@/src/services/agents';
import { addThreadItem } from '@/src/services/threads';

export const dynamic = 'force-dynamic';

const PLAYGROUND_USER_ID = 'admin-test-user';
const PLAYGROUND_USERNAME = 'Playground Tester';
const CHUNK_SIZE = 20;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  let message: string;
  let agentId: string;
  let workflowId: string;
  let sessionId: string;

  try {
    const body = await request.json() as {
      message?: string;
      agentId?: string;
      workflowId?: string;
      sessionId?: string;
    };
    message = body.message ?? '';
    agentId = body.agentId ?? '';
    workflowId = body.workflowId ?? '';
    sessionId = body.sessionId ?? '';
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (!message || !agentId || !workflowId || !sessionId) {
    return new Response('message, agentId, workflowId, and sessionId are required', { status: 400 });
  }

  // handleDrinkQuestion(channelId, guildId=null) internally generates discord:dm:{channelId}
  // as the thread ID. All data (thread items, runs, tool calls) lives on this thread.
  const threadId = `discord:dm:${sessionId}`;

  // Ensure thread row exists before any writes that reference it
  if (sql) {
    await sql`
      INSERT INTO threads (thread_id, state)
      VALUES (${threadId}, '{"isDm": false}'::jsonb)
      ON CONFLICT (thread_id) DO NOTHING
    `;
  }

  await assignWorkflowToThread(threadId, workflowId);

  // Generate a stable messageId used for both the thread item and the AI call
  const messageId = `playground-${Date.now()}`;

  await addThreadItem(threadId, {
    type: 'user_message',
    role: 'user',
    authorId: PLAYGROUND_USER_ID,
    authorName: PLAYGROUND_USERNAME,
    content: message,
    sourceMessageId: messageId,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(chunk));
      };

      try {
        const result = await handleDrinkQuestion(
          message,
          sessionId,
          undefined,
          messageId,
          null,
          PLAYGROUND_USER_ID,
          PLAYGROUND_USERNAME,
        );

        const { content, runId } = result;

        await addThreadItem(threadId, {
          type: 'assistant_message',
          role: 'assistant',
          content,
          sourceMessageId: `${messageId}-response`,
        });

        for (let offset = 0; offset < content.length; offset += CHUNK_SIZE) {
          send('token', { text: content.slice(offset, offset + CHUNK_SIZE) });
        }

        send('done', { content, runId });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Playground] Chat error:', error);
        send('error', { error: errorMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
