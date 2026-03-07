import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAgent } from '@/src/services/agents';
import AgentForm from '@/app/admin/components/AgentForm';

interface AgentEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function AgentEditPage({ params }: AgentEditPageProps) {
  const { id } = await params;
  const isNew = id === 'new';

  let agent = undefined;

  if (!isNew) {
    try {
      const found = await getAgent(id);
      if (!found) notFound();
      agent = found;
    } catch {
      notFound();
    }
  }

  const pageTitle = isNew ? 'Create Agent' : 'Edit Agent';
  const pageSubtitle = isNew
    ? 'Define a new AI persona with its own system prompt and capabilities.'
    : `Editing "${agent?.name}". Changes take effect on the next message in channels using this agent.`;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/agents" className="hover:text-gray-300 transition-colors">
          Agents
        </Link>
        <span>/</span>
        <span className="text-gray-300">{isNew ? 'New' : (agent?.name ?? id)}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-100">{pageTitle}</h2>
          {agent?.isDefault && (
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-xs font-medium text-amber-400">
              Default Agent
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">{pageSubtitle}</p>
      </div>

      {/* Form card */}
      <div className="max-w-3xl rounded-lg border border-gray-800 bg-gray-900 p-6">
        <AgentForm agent={agent} />
      </div>
    </div>
  );
}
