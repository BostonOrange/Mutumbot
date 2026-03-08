/**
 * Admin Handler
 *
 * Prefix commands for managing agents, workflows, and channel assignments.
 * Gated behind ADMIN_USER_IDS environment variable.
 *
 * Commands:
 *   !agent list / !agent show <name> / !agent create <name>
 *   !agent edit <name> prompt|model|instructions|capabilities <value>
 *   !workflow list / !workflow show <name> / !workflow create <name> agent=<agentName>
 *   !assign <#channel> workflow=<name> [reset] / !assign <#channel> show
 */

import { Message } from 'discord.js';
import {
  getAgents,
  getWorkflows,
  createAgent,
  updateAgent,
  createWorkflow,
  assignWorkflowToThread,
  getThreadWorkflow,
} from '../services/agents';
import { generateThreadId, getOrCreateThread } from '../services/threads';

const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const COMMAND_PREFIX = '!';

/**
 * Check if a user is an admin
 */
export function isAdmin(userId: string): boolean {
  return ADMIN_USER_IDS.includes(userId);
}

/**
 * Check if a message is an admin command
 */
export function isAdminCommand(content: string): boolean {
  const cleaned = content.replace(/<@!?\d+>/g, '').trim();
  return cleaned.startsWith(`${COMMAND_PREFIX}agent`) ||
         cleaned.startsWith(`${COMMAND_PREFIX}workflow`) ||
         cleaned.startsWith(`${COMMAND_PREFIX}assign`);
}

/**
 * Handle an admin command message. Returns the reply string, or null if not handled.
 */
export async function handleAdminCommand(message: Message): Promise<string | null> {
  const userId = message.author.id;

  if (!isAdmin(userId)) {
    return 'You are not authorized to use admin commands.';
  }

  // Strip bot mention and trim
  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  const parts = content.split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const subcommand = parts[1]?.toLowerCase();

  try {
    switch (command) {
      case '!agent':
        return await handleAgentCommand(subcommand, parts.slice(2));
      case '!workflow':
        return await handleWorkflowCommand(subcommand, parts.slice(2));
      case '!assign':
        return await handleAssignCommand(parts.slice(1), message);
      default:
        return `Unknown command: \`${command}\`. Available: \`!agent\`, \`!workflow\`, \`!assign\``;
    }
  } catch (error) {
    console.error('[Admin] Command error:', error);
    return `Error: ${(error as Error).message}`;
  }
}

// ============ AGENT COMMANDS ============

async function handleAgentCommand(subcommand: string | undefined, args: string[]): Promise<string> {
  switch (subcommand) {
    case 'list':
      return await agentList();
    case 'show':
      return await agentShow(args[0]);
    case 'create':
      return await agentCreate(args[0]);
    case 'edit':
      return await agentEdit(args);
    default:
      return `**Agent commands:**
\`!agent list\` — List all agents
\`!agent show <name>\` — Show agent details
\`!agent create <name>\` — Create a new agent
\`!agent edit <name> prompt|model|instructions|capabilities <value>\` — Edit agent`;
  }
}

async function agentList(): Promise<string> {
  const agents = await getAgents();
  if (agents.length === 0) return 'No agents found.';

  const lines = agents.map(a =>
    `${a.isDefault ? '**[default]** ' : ''}**${a.name}** — model: \`${a.model}\`, capabilities: ${a.capabilities.length > 0 ? a.capabilities.map(c => `\`${c}\``).join(', ') : 'none'}`
  );
  return `**Agents (${agents.length}):**\n${lines.join('\n')}`;
}

async function agentShow(name: string | undefined): Promise<string> {
  if (!name) return 'Usage: `!agent show <name>`';

  const agents = await getAgents();
  const agent = findByName(agents, name);
  if (!agent) return `Agent "${name}" not found. Use \`!agent list\` to see available agents.`;

  return `**Agent: ${agent.name}**
ID: \`${agent.id}\`
Default: ${agent.isDefault ? 'yes' : 'no'}
Model: \`${agent.model}\`
Temperature: ${agent.params.temperature ?? 'default'}
Capabilities: ${agent.capabilities.length > 0 ? agent.capabilities.map(c => `\`${c}\``).join(', ') : 'none'}
System prompt: ${agent.systemPrompt ? `${agent.systemPrompt.slice(0, 200)}${agent.systemPrompt.length > 200 ? '...' : ''}` : '(none)'}
Custom instructions: ${agent.customInstructions ? `${agent.customInstructions.slice(0, 200)}${agent.customInstructions.length > 200 ? '...' : ''}` : '(none)'}`;
}

async function agentCreate(name: string | undefined): Promise<string> {
  if (!name) return 'Usage: `!agent create <name>`';

  const agent = await createAgent(name, {
    description: `Created via admin command`,
    capabilities: [],
  });
  return `Agent **${agent.name}** created (id: \`${agent.id}\`). Use \`!agent edit ${name} prompt <system prompt>\` to set the persona.`;
}

async function agentEdit(args: string[]): Promise<string> {
  const name = args[0];
  const field = args[1]?.toLowerCase();
  const value = args.slice(2).join(' ');

  if (!name || !field || !value) {
    return 'Usage: `!agent edit <name> prompt|model|instructions|capabilities <value>`';
  }

  const agents = await getAgents();
  const agent = findByName(agents, name);
  if (!agent) return `Agent "${name}" not found.`;

  switch (field) {
    case 'prompt':
      await updateAgent(agent.id, { systemPrompt: value });
      return `Updated **${agent.name}** system prompt (${value.length} chars).`;
    case 'model':
      await updateAgent(agent.id, { model: value });
      return `Updated **${agent.name}** model to \`${value}\`.`;
    case 'instructions':
      await updateAgent(agent.id, { customInstructions: value });
      return `Updated **${agent.name}** custom instructions.`;
    case 'capabilities': {
      const caps = value.split(',').map(c => c.trim()).filter(Boolean);
      await updateAgent(agent.id, { capabilities: caps });
      return `Updated **${agent.name}** capabilities: ${caps.map(c => `\`${c}\``).join(', ')}`;
    }
    case 'temperature': {
      const temp = parseFloat(value);
      if (isNaN(temp) || temp < 0 || temp > 2) return 'Temperature must be a number between 0 and 2.';
      await updateAgent(agent.id, { params: { ...agent.params, temperature: temp } });
      return `Updated **${agent.name}** temperature to ${temp}.`;
    }
    default:
      return `Unknown field "${field}". Available: prompt, model, instructions, capabilities, temperature`;
  }
}

// ============ WORKFLOW COMMANDS ============

async function handleWorkflowCommand(subcommand: string | undefined, args: string[]): Promise<string> {
  switch (subcommand) {
    case 'list':
      return await workflowList();
    case 'show':
      return await workflowShow(args[0]);
    case 'create':
      return await workflowCreate(args);
    default:
      return `**Workflow commands:**
\`!workflow list\` — List all workflows
\`!workflow show <name>\` — Show workflow details
\`!workflow create <name> agent=<agentName>\` — Create a workflow linked to an agent`;
  }
}

async function workflowList(): Promise<string> {
  const workflows = await getWorkflows();
  if (workflows.length === 0) return 'No workflows found.';

  const agents = await getAgents();
  const agentMap = new Map(agents.map(a => [a.id, a.name]));

  const lines = workflows.map(w =>
    `${w.isDefault ? '**[default]** ' : ''}**${w.name}** — agent: \`${agentMap.get(w.agentId) || w.agentId}\``
  );
  return `**Workflows (${workflows.length}):**\n${lines.join('\n')}`;
}

async function workflowShow(name: string | undefined): Promise<string> {
  if (!name) return 'Usage: `!workflow show <name>`';

  const workflows = await getWorkflows();
  const workflow = findByName(workflows, name);
  if (!workflow) return `Workflow "${name}" not found.`;

  const agents = await getAgents();
  const agentName = agents.find(a => a.id === workflow.agentId)?.name || workflow.agentId;
  const cp = workflow.contextPolicy;

  return `**Workflow: ${workflow.name}**
ID: \`${workflow.id}\`
Default: ${workflow.isDefault ? 'yes' : 'no'}
Agent: \`${agentName}\`
Context policy: ${cp.recentMessages} messages, ${cp.maxAgeHours}h window, ${cp.maxTranscriptChars} max chars, summary: ${cp.useSummary ? 'on' : 'off'}`;
}

async function workflowCreate(args: string[]): Promise<string> {
  const agentArgIndex = args.findIndex(a => a.toLowerCase().startsWith('agent='));
  const agentArg = agentArgIndex >= 0 ? args[agentArgIndex] : undefined;
  const name = agentArgIndex > 0 ? args.slice(0, agentArgIndex).join(' ') : args[0];

  if (!name || !agentArg) {
    return 'Usage: `!workflow create <name> agent=<agentName>`';
  }

  const agentName = agentArg.split('=')[1];
  const agents = await getAgents();
  const agent = findByName(agents, agentName);
  if (!agent) return `Agent "${agentName}" not found. Use \`!agent list\` to see available agents.`;

  const workflow = await createWorkflow(name, agent.id, {
    description: `Created via admin command, linked to ${agent.name}`,
  });
  return `Workflow **${workflow.name}** created (id: \`${workflow.id}\`), linked to agent **${agent.name}**.`;
}

// ============ ASSIGN COMMANDS ============

async function handleAssignCommand(args: string[], message: Message): Promise<string> {
  // Parse channel mention: <#channelId>
  const channelMention = args[0];
  const channelMatch = channelMention?.match(/^<#(\d+)>$/);

  if (!channelMatch) {
    return `**Assign commands:**
\`!assign <#channel> show\` — Show current workflow for a channel
\`!assign <#channel> workflow=<name> [reset]\` — Assign a workflow to a channel`;
  }

  const channelId = channelMatch[1];
  const guildId = message.guild?.id || null;
  const subcommand = args[1]?.toLowerCase();

  if (subcommand === 'show') {
    const threadId = generateThreadId(channelId, guildId);
    const workflow = await getThreadWorkflow(threadId);
    if (!workflow) return `<#${channelId}> is using the **default** workflow.`;

    const agents = await getAgents();
    const agentName = agents.find(a => a.id === workflow.agentId)?.name || workflow.agentId;
    return `<#${channelId}> is assigned to workflow **${workflow.name}** (agent: **${agentName}**).`;
  }

  const workflowArg = args.find(a => a.toLowerCase().startsWith('workflow='));
  if (!workflowArg) {
    return 'Usage: `!assign <#channel> workflow=<name> [reset]`';
  }

  const workflowName = workflowArg.split('=')[1];
  const workflows = await getWorkflows();
  const workflow = findByName(workflows, workflowName);
  if (!workflow) return `Workflow "${workflowName}" not found. Use \`!workflow list\` to see available workflows.`;

  const shouldReset = args.some(a => a.toLowerCase() === 'reset');
  const threadId = generateThreadId(channelId, guildId);

  // Ensure the thread exists before assigning
  await getOrCreateThread(channelId, guildId);
  await assignWorkflowToThread(threadId, workflow.id, { resetHistory: shouldReset });

  const agents = await getAgents();
  const agentName = agents.find(a => a.id === workflow.agentId)?.name || workflow.agentId;
  return `Assigned <#${channelId}> to workflow **${workflow.name}** (agent: **${agentName}**).${shouldReset ? ' Thread history was reset.' : ''}`;
}

// ============ HELPERS ============

function findByName<T extends { name: string }>(items: T[], name: string): T | undefined {
  const lower = name.toLowerCase();
  return items.find(item => item.name.toLowerCase() === lower) ||
         items.find(item => item.name.toLowerCase().includes(lower));
}
