import Link from 'next/link';
import { getAgents } from '@/src/services/agents';
import type { Agent } from '@/src/services/agents';

const CAPABILITY_LABELS: Record<string, string> = {
  image_analysis: 'Images',
  tribute_tracking: 'Tributes',
  web_search: 'Web Search',
  scheduled_messages: 'Scheduled',
  random_facts: 'Facts',
  content_moderation: 'Moderation',
  knowledge: 'Knowledge',
  external_api: 'External API',
};

function CapabilityBadge({ capability }: { capability: string }) {
  return (
    <span className="inline-block rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
      {CAPABILITY_LABELS[capability] ?? capability}
    </span>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  return (
    <Link
      href={`/admin/agents/${agent.id}`}
      className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 hover:bg-gray-800/50 transition-colors sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex-1 min-w-0">
        {/* Name + badges */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-100 truncate">
            {agent.name}
          </span>
          {agent.isDefault && (
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-xs font-medium text-amber-400">
              Default
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              agent.isActive
                ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                : 'bg-gray-800 border border-gray-700 text-gray-500'
            }`}
          >
            {agent.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Description */}
        {agent.description && (
          <p className="text-xs text-gray-500 mb-2 line-clamp-2">{agent.description}</p>
        )}

        {/* Capability tags */}
        {agent.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {agent.capabilities.map((cap) => (
              <CapabilityBadge key={cap} capability={cap} />
            ))}
          </div>
        )}
      </div>

      {/* Model */}
      <div className="shrink-0 text-right">
        <span className="text-xs font-mono text-gray-500">{agent.model}</span>
      </div>
    </Link>
  );
}

export default async function AgentsPage() {
  let agents: Agent[] = [];
  let loadError: string | null = null;

  try {
    agents = await getAgents();
  } catch {
    loadError = 'Failed to load agents. Check the database connection.';
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Agents</h2>
          <p className="mt-1 text-sm text-gray-500">
            AI persona configurations. Each agent defines a system prompt, model, and set of capabilities.
          </p>
        </div>
        <Link
          href="/admin/agents/new"
          className="shrink-0 rounded-md bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          Create Agent
        </Link>
      </div>

      {/* Error state */}
      {loadError && (
        <div className="rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      {/* Empty state */}
      {!loadError && agents.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
          <p className="text-sm font-medium text-gray-400">No agents found</p>
          <p className="mt-1 text-xs text-gray-600">
            Create your first agent to get started.
          </p>
        </div>
      )}

      {/* Agent list */}
      {agents.length > 0 && (
        <div className="space-y-3">
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
