import { sql } from '@/src/db';
import StatCard from './components/StatCard';

export const dynamic = 'force-dynamic';

async function getStats() {
  if (!sql) {
    return {
      agentCount: 'N/A',
      workflowCount: 'N/A',
      channelCount: 'N/A',
      knowledgeCount: 'N/A',
      memoryCount: 'N/A',
    };
  }

  const [agents, workflows, channels, knowledge, memories] = await Promise.all([
    sql`SELECT COUNT(*)::int AS count FROM agents WHERE is_active = TRUE`,
    sql`SELECT COUNT(*)::int AS count FROM workflows`,
    sql`SELECT COUNT(*)::int AS count FROM threads WHERE workflow_id IS NOT NULL`,
    sql`SELECT COUNT(*)::int AS count FROM agent_knowledge`,
    sql`SELECT COUNT(*)::int AS count FROM user_memories`,
  ]);

  return {
    agentCount: agents[0]?.count ?? 0,
    workflowCount: workflows[0]?.count ?? 0,
    channelCount: channels[0]?.count ?? 0,
    knowledgeCount: knowledge[0]?.count ?? 0,
    memoryCount: memories[0]?.count ?? 0,
  };
}

export default async function AdminOverviewPage() {
  const stats = await getStats().catch(() => ({
    agentCount: 'N/A',
    workflowCount: 'N/A',
    channelCount: 'N/A',
    knowledgeCount: 'N/A',
    memoryCount: 'N/A',
  }));

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-100">Overview</h2>
        <p className="mt-1 text-sm text-gray-500">
          Current state of all Mutumbot resources.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Active Agents"
          value={stats.agentCount}
          subtitle="Agents with is_active = true"
        />
        <StatCard
          title="Workflows"
          value={stats.workflowCount}
          subtitle="Total configured workflows"
        />
        <StatCard
          title="Channel Assignments"
          value={stats.channelCount}
          subtitle="Threads with a workflow assigned"
        />
        <StatCard
          title="Knowledge Facts"
          value={stats.knowledgeCount}
          subtitle="Entries in agent_knowledge"
        />
        <StatCard
          title="User Memories"
          value={stats.memoryCount}
          subtitle="Entries in user_memories"
        />
      </div>
    </div>
  );
}
