import Link from 'next/link';
import { getWorkflows, getAgents } from '@/src/services/agents';
import type { Workflow, Agent } from '@/src/services/agents';

export const dynamic = 'force-dynamic';

function PolicySummary({ policy }: { policy: Workflow['contextPolicy'] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      <span className="inline-flex items-center rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
        {policy.recentMessages} msgs
      </span>
      <span className="inline-flex items-center rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
        {policy.maxAgeHours}h window
      </span>
      {policy.useSummary && (
        <span className="inline-flex items-center rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-xs text-amber-400">
          Summary
        </span>
      )}
      {policy.includeTributeContext && (
        <span className="inline-flex items-center rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
          Tributes
        </span>
      )}
    </div>
  );
}

function WorkflowRow({
  workflow,
  agentMap,
}: {
  workflow: Workflow;
  agentMap: Map<string, Agent>;
}) {
  const agent = agentMap.get(workflow.agentId);

  return (
    <Link
      href={`/admin/workflows/${workflow.id}`}
      className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 hover:bg-gray-800/50 transition-colors sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="flex-1 min-w-0">
        {/* Name + badges */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-100 truncate">{workflow.name}</span>
          {workflow.isDefault && (
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-xs font-medium text-amber-400">
              Default
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              workflow.isActive
                ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                : 'bg-gray-800 border border-gray-700 text-gray-500'
            }`}
          >
            {workflow.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Agent name */}
        {agent && (
          <p className="text-xs text-gray-500 mb-1">
            Agent:{' '}
            <span className="text-gray-400 font-medium">{agent.name}</span>
          </p>
        )}

        {/* Context policy summary */}
        <PolicySummary policy={workflow.contextPolicy} />
      </div>

      {/* Max chars */}
      <div className="shrink-0 text-right">
        <span className="text-xs font-mono text-gray-500">
          {(workflow.contextPolicy.maxTranscriptChars / 1000).toFixed(0)}k chars
        </span>
      </div>
    </Link>
  );
}

export default async function WorkflowsPage() {
  let workflows: Workflow[] = [];
  let agents: Agent[] = [];
  let loadError: string | null = null;

  try {
    [workflows, agents] = await Promise.all([getWorkflows(), getAgents()]);
  } catch {
    loadError = 'Failed to load workflows. Check the database connection.';
  }

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Workflows</h2>
          <p className="mt-1 text-sm text-gray-500">
            Context policies that control how much conversation history the AI receives per channel.
          </p>
        </div>
        <Link
          href="/admin/workflows/new"
          className="shrink-0 rounded-md bg-amber-600 hover:bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          Create Workflow
        </Link>
      </div>

      {/* Error state */}
      {loadError && (
        <div className="rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      {/* Empty state */}
      {!loadError && workflows.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
          <p className="text-sm font-medium text-gray-400">No workflows found</p>
          <p className="mt-1 text-xs text-gray-600">
            Create your first workflow to get started.
          </p>
        </div>
      )}

      {/* Workflow list */}
      {workflows.length > 0 && (
        <div className="space-y-3">
          {workflows.map((workflow) => (
            <WorkflowRow key={workflow.id} workflow={workflow} agentMap={agentMap} />
          ))}
        </div>
      )}
    </div>
  );
}
