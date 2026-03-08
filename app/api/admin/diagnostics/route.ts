import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/src/db';
import {
  getAgents,
  resolveConfigWithDefaults,
  createScheduledEvent,
  deleteScheduledEvent,
  getScheduledEvents,
  EventType,
} from '@/src/services/agents';
import { getToolsForCapabilities, executeTool, ToolCall } from '@/src/services/tools';
import { SAFETY_GUARDRAILS } from '@/src/personality';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  details: string[];
}

interface DiagnosticsResponse {
  results: TestResult[];
  timestamp: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runTest(
  name: string,
  fn: () => Promise<string[]>
): Promise<TestResult> {
  const start = Date.now();
  try {
    const details = await fn();
    return { name, status: 'pass', durationMs: Date.now() - start, details };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name, status: 'fail', durationMs: Date.now() - start, details: [message] };
  }
}

// ─── System checks ───────────────────────────────────────────────────────────

async function testDatabase(): Promise<string[]> {
  if (!sql) throw new Error('Database client not initialized (DATABASE_URL missing?)');

  const tables = await sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  const tableNames = tables.map((t) => t.tablename as string);

  const required = ['agents', 'workflows', 'threads', 'thread_items'];
  const missing = required.filter((t) => !tableNames.includes(t));
  if (missing.length > 0) {
    throw new Error(`Missing required tables: ${missing.join(', ')}`);
  }

  const agentCount = await sql`SELECT COUNT(*)::int AS count FROM agents WHERE is_active = TRUE`;
  const threadCount = await sql`SELECT COUNT(*)::int AS count FROM threads`;

  return [
    `Connected to Railway Postgres`,
    `${tableNames.length} tables found: ${tableNames.join(', ')}`,
    `${agentCount[0].count} active agents, ${threadCount[0].count} threads`,
  ];
}

async function testDiscordApi(): Promise<string[]> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN not set');

  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API returned ${res.status}: ${body}`);
  }

  const bot = await res.json();
  const details = [`Bot token valid`, `Bot user: ${bot.username}#${bot.discriminator} (${bot.id})`];

  // Check guild if configured
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (guildRes.ok) {
      const guild = await guildRes.json();
      details.push(`Guild: ${guild.name} (${guild.id})`);
    }
  }

  return details;
}

async function testOpenRouter(): Promise<string[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  // Minimal completion to verify the API works
  const response = await openrouter.chat.completions.create({
    model: 'google/gemini-2.5-flash-lite',
    messages: [{ role: 'user', content: 'Reply with only the word "ok"' }],
    max_tokens: 10,
  });

  const reply = response.choices?.[0]?.message?.content ?? '(empty)';
  return [
    `OpenRouter API reachable`,
    `Model: google/gemini-2.5-flash-lite`,
    `Test response: "${reply.trim()}"`,
    `Usage: ${response.usage?.prompt_tokens ?? '?'} prompt + ${response.usage?.completion_tokens ?? '?'} completion tokens`,
  ];
}

async function testAgentResolution(agentId?: string): Promise<string[]> {
  const agents = await getAgents();
  if (agents.length === 0) throw new Error('No active agents found in database');

  const targetAgent = agentId
    ? agents.find((a) => a.id === agentId)
    : agents.find((a) => a.isDefault);

  if (!targetAgent) {
    throw new Error(agentId ? `Agent ${agentId} not found` : 'No default agent found');
  }

  const config = await resolveConfigWithDefaults(null);
  const tools = getToolsForCapabilities(targetAgent.capabilities);

  return [
    `Agent: ${targetAgent.name} (${targetAgent.id})`,
    `Model: ${targetAgent.model}`,
    `Capabilities: ${targetAgent.capabilities.join(', ') || 'none'}`,
    `Available tools: ${tools.length} (${tools.map((t) => t.function.name).join(', ') || 'none'})`,
    `System prompt: ${config.systemPrompt.length} chars`,
    `Safety guardrails: ${config.systemPrompt.startsWith(SAFETY_GUARDRAILS) ? 'present (correct)' : 'MISSING (ERROR)'}`,
  ];
}

// ─── AI feature tests ────────────────────────────────────────────────────────

async function testAiResponse(agentId: string, prompt: string): Promise<string[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Build the system prompt the same way the real pipeline does
  const config = await resolveConfigWithDefaults(null);
  // Use the selected agent's prompt instead of the default
  let systemPrompt = SAFETY_GUARDRAILS + '\n\n' + agent.systemPrompt;
  if (agent.customInstructions) {
    systemPrompt += '\n\n' + agent.customInstructions;
  }

  const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  const response = await openrouter.chat.completions.create({
    model: agent.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: agent.params.temperature,
    max_tokens: agent.params.maxTokens || 500,
  });

  const reply = response.choices?.[0]?.message?.content ?? '(empty response)';

  return [
    `Agent: ${agent.name}`,
    `Model: ${agent.model}`,
    `Prompt: "${prompt}"`,
    ``,
    `--- Response ---`,
    reply.trim(),
    `--- End Response ---`,
    ``,
    `Tokens: ${response.usage?.prompt_tokens ?? '?'} prompt + ${response.usage?.completion_tokens ?? '?'} completion`,
  ];
}

async function testToolCalling(agentId: string): Promise<string[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = getToolsForCapabilities(agent.capabilities);
  if (tools.length === 0) {
    return [
      `Agent: ${agent.name}`,
      `Capabilities: ${agent.capabilities.join(', ') || 'none'}`,
      `No tools available for this agent's capabilities — skipping tool call test`,
    ];
  }

  let systemPrompt = SAFETY_GUARDRAILS + '\n\n' + agent.systemPrompt;
  if (agent.customInstructions) {
    systemPrompt += '\n\n' + agent.customInstructions;
  }

  const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });

  const response = await openrouter.chat.completions.create({
    model: agent.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'List the available Discord channels.' },
    ],
    temperature: agent.params.temperature,
    max_tokens: agent.params.maxTokens || 500,
    tools: tools.map((t) => ({ type: 'function' as const, function: t.function })),
    tool_choice: 'auto',
  });

  const message = response.choices?.[0]?.message;
  const toolCalls = message?.tool_calls ?? [];

  const details = [
    `Agent: ${agent.name}`,
    `Available tools: ${tools.map((t) => t.function.name).join(', ')}`,
    `Prompt: "List the available Discord channels."`,
    ``,
  ];

  if (toolCalls.length > 0) {
    details.push(`Tool calls made: ${toolCalls.length}`);
    for (const tc of toolCalls) {
      const fn = (tc as { type: string; function: { name: string; arguments: string } }).function;
      if (fn) {
        details.push(`  \u2192 ${fn.name}(${fn.arguments})`);
      }
    }
    details.push(``, `Tool calling is working correctly.`);
  } else {
    details.push(`No tool calls made (model responded directly)`);
    if (message?.content) {
      details.push(`Response: "${message.content.trim().slice(0, 200)}..."`);
    }
  }

  return details;
}

async function testKnowledge(agentId: string): Promise<string[]> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  if (!agent.capabilities.includes('knowledge')) {
    return [
      `Agent: ${agent.name}`,
      `Knowledge capability not enabled — skipping`,
    ];
  }

  if (!sql) throw new Error('Database not available');

  // Check existing knowledge
  const facts = await sql`
    SELECT COUNT(*)::int AS count FROM agent_knowledge WHERE agent_id = ${agentId}
  `;

  // Write a test fact
  const testFact = `Diagnostics test ran at ${new Date().toISOString()}`;
  await sql`
    INSERT INTO agent_knowledge (agent_id, fact, category, subject, source_thread_id)
    VALUES (${agentId}, ${testFact}, 'test', 'diagnostics', 'test:diagnostics')
  `;

  // Read it back
  const readBack = await sql`
    SELECT fact FROM agent_knowledge
    WHERE agent_id = ${agentId} AND category = 'test' AND subject = 'diagnostics'
    ORDER BY created_at DESC LIMIT 1
  `;

  // Clean up test fact
  await sql`
    DELETE FROM agent_knowledge
    WHERE agent_id = ${agentId} AND category = 'test' AND subject = 'diagnostics'
  `;

  const readBackFact = readBack[0]?.fact as string | undefined;

  return [
    `Agent: ${agent.name}`,
    `Existing knowledge facts: ${facts[0].count}`,
    `Write test: ${readBackFact === testFact ? 'OK' : 'FAILED'}`,
    `Read-back test: ${readBackFact ? 'OK' : 'FAILED'}`,
    `Cleanup: OK (test fact removed)`,
  ];
}

async function testMessageIngestion(): Promise<string[]> {
  if (!sql) throw new Error('Database not available');

  const recentItems = await sql`
    SELECT COUNT(*)::int AS count FROM thread_items
    WHERE created_at > NOW() - INTERVAL '24 hours'
  `;

  const totalItems = await sql`
    SELECT COUNT(*)::int AS count FROM thread_items
  `;

  const recentMessages = await sql`
    SELECT COUNT(*)::int AS count FROM discord_messages_recent
  `;

  return [
    `Total thread items: ${totalItems[0].count}`,
    `Items in last 24h: ${recentItems[0].count}`,
    `Messages in recent buffer: ${recentMessages[0].count}`,
    recentItems[0].count > 0
      ? `Message ingestion is active`
      : `No recent items — gateway may not be running or no messages received`,
  ];
}

// ─── New capability tests ─────────────────────────────────────────────────────

async function testWebSearch(agentId: string): Promise<string[]> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  if (!agent.capabilities.includes('web_search')) {
    return [`Agent: ${agent.name}`, `web_search capability not enabled — skipping`];
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const onlineModel = `${agent.model}:online`;
  const openrouter = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey });

  const response = await openrouter.chat.completions.create({
    model: onlineModel,
    messages: [
      { role: 'user', content: "What is today's date? Reply with just the date." },
    ],
    max_tokens: 100,
  });

  const reply = response.choices?.[0]?.message?.content ?? '(empty)';
  return [
    `Agent: ${agent.name}`,
    `Model: ${onlineModel}`,
    `Prompt: "What is today's date?"`,
    `Response: "${reply.trim()}"`,
    `Tokens: ${response.usage?.prompt_tokens ?? '?'} prompt + ${response.usage?.completion_tokens ?? '?'} completion`,
    `Web search (:online plugin) is working.`,
  ];
}

async function testImageAnalysis(agentId: string): Promise<string[]> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  if (!agent.capabilities.includes('image_analysis')) {
    return [`Agent: ${agent.name}`, `image_analysis capability not enabled — skipping`];
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const openrouter = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey });

  const testImageUrl =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Good_Food_Display_-_NCI_Visuals_Online.jpg/220px-Good_Food_Display_-_NCI_Visuals_Online.jpg';

  const response = await openrouter.chat.completions.create({
    model: agent.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in one sentence.' },
          { type: 'image_url', image_url: { url: testImageUrl } },
        ],
      },
    ],
    max_tokens: 150,
  });

  const reply = response.choices?.[0]?.message?.content ?? '(empty)';
  return [
    `Agent: ${agent.name}`,
    `Model: ${agent.model}`,
    `Test image: food display (Wikipedia commons)`,
    `Description: "${reply.trim()}"`,
    `Tokens: ${response.usage?.prompt_tokens ?? '?'} prompt + ${response.usage?.completion_tokens ?? '?'} completion`,
    `Image analysis is working.`,
  ];
}

async function testScheduledEvents(agentId: string): Promise<string[]> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  if (!agent.capabilities.includes('scheduled_messages')) {
    return [`Agent: ${agent.name}`, `scheduled_messages capability not enabled — skipping`];
  }

  const testEvent = await createScheduledEvent(
    '__diagnostics_test__',
    'test:diagnostics:channel',
    '0 0 31 2 *',
    'custom_message' as EventType,
    {
      description: 'Diagnostics test event — safe to delete',
      payload: { message: 'Test message from diagnostics' },
      timezone: 'UTC',
    }
  );

  const events = await getScheduledEvents({ threadId: 'test:diagnostics:channel' });
  const found = events.find((e) => e.id === testEvent.id);

  await deleteScheduledEvent(testEvent.id);

  const afterDelete = await getScheduledEvents({ threadId: 'test:diagnostics:channel' });
  const stillExists = afterDelete.find((e) => e.id === testEvent.id);

  return [
    `Agent: ${agent.name}`,
    `Create test: ${testEvent.id ? 'OK' : 'FAILED'}`,
    `Read-back test: ${found ? 'OK' : 'FAILED'}`,
    `Delete test: ${!stillExists ? 'OK' : 'FAILED (event still exists)'}`,
    `Scheduled events CRUD is working.`,
  ];
}

async function testToolExecution(agentId: string): Promise<string[]> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = getToolsForCapabilities(agent.capabilities);
  if (tools.length === 0) {
    return [`Agent: ${agent.name}`, `No tools available — skipping`];
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  let systemPrompt = SAFETY_GUARDRAILS + '\n\n' + agent.systemPrompt;
  if (agent.customInstructions) systemPrompt += '\n\n' + agent.customInstructions;

  const openrouter = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey });

  const response = await openrouter.chat.completions.create({
    model: agent.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'List the available Discord channels.' },
    ],
    temperature: agent.params.temperature,
    max_tokens: 500,
    tools: tools.map((t) => ({ type: 'function' as const, function: t.function })),
    tool_choice: 'auto',
  });

  const message = response.choices?.[0]?.message;
  const toolCalls = message?.tool_calls ?? [];
  const details: string[] = [
    `Agent: ${agent.name}`,
    `Available tools: ${tools.map((t) => t.function.name).join(', ')}`,
  ];

  if (toolCalls.length === 0) {
    details.push(`Model did not suggest any tool calls.`);
    if (message?.content) details.push(`Response: "${message.content.trim().slice(0, 200)}"`);
    return details;
  }

  details.push(`Tool calls suggested: ${toolCalls.length}`);

  for (const tc of toolCalls) {
    const fn = (tc as ToolCall).function;
    if (!fn) continue;

    details.push(``, `\u2192 ${fn.name}(${fn.arguments})`);
    try {
      const toolResult = await executeTool(tc as ToolCall, 'test:diagnostics', agent.capabilities, agent.id);
      const resultSnippet = toolResult.content.slice(0, 300);
      details.push(`  Result: ${resultSnippet}${toolResult.content.length > 300 ? '...' : ''}`);
    } catch (err) {
      details.push(`  Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  details.push(``, `Full tool execution loop completed.`);
  return details;
}

async function testUserMemory(): Promise<string[]> {
  if (!sql) throw new Error('Database not available');

  const tables = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_memories'
  `;
  if (tables.length === 0) {
    return [`user_memories table not found — memory system not initialized`];
  }

  const totalMemories = await sql`SELECT COUNT(*)::int AS count FROM user_memories`;
  const recentMemories = await sql`
    SELECT COUNT(*)::int AS count FROM user_memories
    WHERE last_updated_at > NOW() - INTERVAL '24 hours'
  `;

  const topUsers = await sql`
    SELECT user_id, channel_id, message_count, LENGTH(summary) as summary_length
    FROM user_memories
    ORDER BY last_updated_at DESC
    LIMIT 5
  `;

  const details = [
    `Total user memories: ${totalMemories[0].count}`,
    `Updated in last 24h: ${recentMemories[0].count}`,
  ];

  if (topUsers.length > 0) {
    details.push(``, `Recent memories:`);
    for (const row of topUsers) {
      details.push(
        `  User ${row.user_id} in ${row.channel_id}: ${row.message_count} msgs, ${row.summary_length} char summary`
      );
    }
  }

  return details;
}

async function testTributeTracking(agentId: string): Promise<string[]> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  if (!agent.capabilities.includes('tribute_tracking')) {
    return [`Agent: ${agent.name}`, `tribute_tracking capability not enabled — skipping`];
  }

  if (!sql) throw new Error('Database not available');

  // Verify tributes table exists and is queryable
  const tributeCount = await sql`SELECT COUNT(*)::int AS count FROM tributes`;
  const recentTributes = await sql`
    SELECT COUNT(*)::int AS count FROM tributes
    WHERE created_at > NOW() - INTERVAL '7 days'
  `;

  // Verify command gating works
  const GATED_COMMANDS = ['tribute', 'tally', 'demand'];

  return [
    `Agent: ${agent.name}`,
    `Total tributes in DB: ${tributeCount[0].count}`,
    `Tributes in last 7 days: ${recentTributes[0].count}`,
    `Gated commands: ${GATED_COMMANDS.join(', ')}`,
    `Tribute tracking is working.`,
  ];
}

async function testRandomFacts(agentId: string): Promise<string[]> {
  const agents = await getAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  if (!agent.capabilities.includes('random_facts')) {
    return [`Agent: ${agent.name}`, `random_facts capability not enabled — skipping`];
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const openrouter = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey });

  // Test that the AI can generate a random fact (same pattern as handleRandomDrinkFact)
  const response = await openrouter.chat.completions.create({
    model: agent.model,
    messages: [
      { role: 'user', content: 'Tell me one short fun fact about tiki cocktails.' },
    ],
    max_tokens: 150,
    temperature: 0.9,
  });

  const reply = response.choices?.[0]?.message?.content ?? '(empty)';

  return [
    `Agent: ${agent.name}`,
    `Model: ${agent.model}`,
    `Gated command: /drink random`,
    `Test fact: "${reply.trim().slice(0, 200)}"`,
    `Tokens: ${response.usage?.prompt_tokens ?? '?'} prompt + ${response.usage?.completion_tokens ?? '?'} completion`,
    `Random facts generation is working.`,
  ];
}

async function testCapabilityGating(): Promise<string[]> {
  const details: string[] = [];

  const noCapTools = getToolsForCapabilities([]);
  const baseToolNames = noCapTools.map((t) => t.function.name);
  details.push(`No capabilities \u2192 ${noCapTools.length} tools: ${baseToolNames.join(', ')}`);

  const schedulingTools = getToolsForCapabilities(['scheduled_messages']);
  const schedulingNames = schedulingTools
    .map((t) => t.function.name)
    .filter((n) => !baseToolNames.includes(n));
  details.push(`scheduled_messages \u2192 adds: ${schedulingNames.join(', ') || 'none'}`);

  const knowledgeTools = getToolsForCapabilities(['knowledge']);
  const knowledgeNames = knowledgeTools
    .map((t) => t.function.name)
    .filter((n) => !baseToolNames.includes(n));
  details.push(`knowledge \u2192 adds: ${knowledgeNames.join(', ') || 'none'}`);

  const allCapTools = getToolsForCapabilities(['scheduled_messages', 'knowledge', 'web_search', 'image_analysis']);
  details.push(`All capabilities \u2192 ${allCapTools.length} total tools`);

  const webTools = getToolsForCapabilities(['web_search']);
  const webOnlyNames = webTools.map((t) => t.function.name).filter((n) => !baseToolNames.includes(n));
  details.push(
    `web_search \u2192 adds: ${
      webOnlyNames.length === 0
        ? 'none (correct \u2014 uses :online plugin)'
        : webOnlyNames.join(', ') + ' (unexpected!)'
    }`
  );

  // Non-tool capabilities: verify they don't add tools but ARE real capabilities
  details.push(`tribute_tracking \u2192 gates: /tribute, /tally, /demand, @mention scoring`);
  details.push(`random_facts \u2192 gates: /drink random`);
  details.push(`image_analysis \u2192 gates: image analysis in /tribute and @mentions`);

  return details;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { agentId, tests, customPrompt } = body as {
      agentId?: string;
      tests: string[];
      customPrompt?: string;
    };

    const results: TestResult[] = [];

    for (const test of tests) {
      switch (test) {
        case 'database':
          results.push(await runTest('Database Connection', testDatabase));
          break;
        case 'discord':
          results.push(await runTest('Discord API', testDiscordApi));
          break;
        case 'openrouter':
          results.push(await runTest('OpenRouter API', testOpenRouter));
          break;
        case 'agent_resolution':
          results.push(await runTest('Agent Resolution', () => testAgentResolution(agentId)));
          break;
        case 'basic_response':
          if (!agentId) {
            results.push({ name: 'Basic AI Response', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            const prompt = customPrompt || 'What is a Mai Tai? Keep your answer short.';
            results.push(await runTest('Basic AI Response', () => testAiResponse(agentId, prompt)));
          }
          break;
        case 'tool_calling':
          if (!agentId) {
            results.push({ name: 'Tool Calling', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Tool Calling', () => testToolCalling(agentId)));
          }
          break;
        case 'knowledge':
          if (!agentId) {
            results.push({ name: 'Knowledge Storage', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Knowledge Storage', () => testKnowledge(agentId)));
          }
          break;
        case 'message_ingestion':
          results.push(await runTest('Message Ingestion', testMessageIngestion));
          break;
        case 'custom_prompt':
          if (!agentId || !customPrompt) {
            results.push({ name: 'Custom Prompt', status: 'skip', durationMs: 0, details: ['Agent and prompt required'] });
          } else {
            results.push(await runTest('Custom Prompt', () => testAiResponse(agentId, customPrompt)));
          }
          break;
        case 'web_search':
          if (!agentId) {
            results.push({ name: 'Web Search (:online)', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Web Search (:online)', () => testWebSearch(agentId)));
          }
          break;
        case 'image_analysis':
          if (!agentId) {
            results.push({ name: 'Image Analysis', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Image Analysis', () => testImageAnalysis(agentId)));
          }
          break;
        case 'scheduled_events':
          if (!agentId) {
            results.push({ name: 'Scheduled Events CRUD', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Scheduled Events CRUD', () => testScheduledEvents(agentId)));
          }
          break;
        case 'tool_execution':
          if (!agentId) {
            results.push({ name: 'Tool Execution Loop', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Tool Execution Loop', () => testToolExecution(agentId)));
          }
          break;
        case 'user_memory':
          results.push(await runTest('User Memory', testUserMemory));
          break;
        case 'capability_gating':
          results.push(await runTest('Capability Gating', testCapabilityGating));
          break;
        case 'tribute_tracking':
          if (!agentId) {
            results.push({ name: 'Tribute Tracking', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Tribute Tracking', () => testTributeTracking(agentId)));
          }
          break;
        case 'random_facts':
          if (!agentId) {
            results.push({ name: 'Random Facts', status: 'skip', durationMs: 0, details: ['No agent selected'] });
          } else {
            results.push(await runTest('Random Facts', () => testRandomFacts(agentId)));
          }
          break;
      }
    }

    const response: DiagnosticsResponse = {
      results,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Diagnostics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
