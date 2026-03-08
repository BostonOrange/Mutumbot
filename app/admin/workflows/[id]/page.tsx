import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getWorkflow, getAgents } from '@/src/services/agents';
import WorkflowForm from '@/app/admin/components/WorkflowForm';

export const dynamic = 'force-dynamic';

interface WorkflowEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkflowEditPage({ params }: WorkflowEditPageProps) {
  const { id } = await params;
  const isNew = id === 'new';

  let workflow = undefined;

  const agents = await getAgents().catch(() => []);

  if (!isNew) {
    try {
      const found = await getWorkflow(id);
      if (!found) notFound();
      workflow = found;
    } catch {
      notFound();
    }
  }

  const pageTitle = isNew ? 'Create Workflow' : 'Edit Workflow';
  const pageSubtitle = isNew
    ? 'Define a new context policy and link it to an agent.'
    : `Editing "${workflow?.name}". Changes apply to channels using this workflow on their next message.`;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/admin/workflows" className="hover:text-gray-300 transition-colors">
          Workflows
        </Link>
        <span>/</span>
        <span className="text-gray-300">{isNew ? 'New' : (workflow?.name ?? id)}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-100">{pageTitle}</h2>
          {workflow?.isDefault && (
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-xs font-medium text-amber-400">
              Default Workflow
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">{pageSubtitle}</p>
      </div>

      {/* Form card */}
      <div className="max-w-3xl rounded-lg border border-gray-800 bg-gray-900 p-6">
        <WorkflowForm workflow={workflow} agents={agents} />
      </div>
    </div>
  );
}
