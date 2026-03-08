import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/src/db';
import { getAgents, resolveConfigWithDefaults } from '@/src/services/agents';
import { getToolsForCapabilities } from '@/src/services/tools';
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
