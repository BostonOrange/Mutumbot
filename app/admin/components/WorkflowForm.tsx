'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Workflow, ContextPolicy } from '@/src/services/agents';
import type { Agent } from '@/src/services/agents';

// Usage:
//   <WorkflowForm agents={agents} />                        — create mode
//   <WorkflowForm workflow={existingWorkflow} agents={agents} /> — edit mode

const DEFAULT_CONTEXT_POLICY: Required<ContextPolicy> = {
  recentMessages: 20,
  maxAgeHours: 8,
  useSummary: true,
  maxTranscriptChars: 10000,
  includeTributeContext: true,
  customInstructions: '',
};

interface WorkflowFormProps {
  workflow?: Workflow;
  agents: Agent[];
}

interface FormState {
  name: string;
  agentId: string;
  recentMessages: number;
  maxAgeHours: number;
  useSummary: boolean;
  maxTranscriptChars: number;
  includeTributeContext: boolean;
  customInstructions: string;
}

function buildInitialState(workflow?: Workflow, agents?: Agent[]): FormState {
  const policy = workflow?.contextPolicy;
  const defaultAgentId = agents?.find((a) => a.isDefault)?.id ?? agents?.[0]?.id ?? '';

  return {
    name: workflow?.name ?? '',
    agentId: workflow?.agentId ?? defaultAgentId,
    recentMessages: policy?.recentMessages ?? DEFAULT_CONTEXT_POLICY.recentMessages,
    maxAgeHours: policy?.maxAgeHours ?? DEFAULT_CONTEXT_POLICY.maxAgeHours,
    useSummary: policy?.useSummary ?? DEFAULT_CONTEXT_POLICY.useSummary,
    maxTranscriptChars: policy?.maxTranscriptChars ?? DEFAULT_CONTEXT_POLICY.maxTranscriptChars,
    includeTributeContext:
      policy?.includeTributeContext ?? DEFAULT_CONTEXT_POLICY.includeTributeContext,
    customInstructions: policy?.customInstructions ?? '',
  };
}

export default function WorkflowForm({ workflow, agents }: WorkflowFormProps) {
  const router = useRouter();
  const isEditMode = Boolean(workflow);

  const [form, setForm] = useState<FormState>(() => buildInitialState(workflow, agents));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const contextPolicy: ContextPolicy = {
      recentMessages: form.recentMessages,
      maxAgeHours: form.maxAgeHours,
      useSummary: form.useSummary,
      maxTranscriptChars: form.maxTranscriptChars,
      includeTributeContext: form.includeTributeContext,
      ...(form.customInstructions ? { customInstructions: form.customInstructions } : {}),
    };

    const body = {
      name: form.name,
      agentId: form.agentId,
      contextPolicy,
    };

    try {
      const url = isEditMode
        ? `/api/admin/workflows/${workflow!.id}`
        : '/api/admin/workflows';
      const method = isEditMode ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed with status ${res.status}`);
      }

      router.push('/admin/workflows');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!workflow) return;
    if (!window.confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) return;

    setError(null);
    setDeleting(true);

    try {
      const res = await fetch(`/api/admin/workflows/${workflow.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed with status ${res.status}`);
      }

      router.push('/admin/workflows');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setDeleting(false);
    }
  }

  const inputClass =
    'w-full rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors';

  const labelClass = 'block text-sm font-medium text-gray-300 mb-1.5';

  return (
    <form onSubmit={handleSave} noValidate>
      <div className="space-y-6">
        {/* Error banner */}
        {error && (
          <div className="rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Default-workflow notice */}
        {workflow?.isDefault && (
          <div className="rounded-md bg-amber-900/30 border border-amber-700/50 px-4 py-3 text-sm text-amber-300">
            This is the default workflow. It cannot be deleted.
          </div>
        )}

        {/* Name */}
        <div>
          <label htmlFor="name" className={labelClass}>
            Name <span className="text-red-400">*</span>
          </label>
          <input
            id="name"
            type="text"
            required
            value={form.name}
            onChange={(e) => handleField('name', e.target.value)}
            className={inputClass}
            placeholder="e.g. Standard Context"
          />
        </div>

        {/* Agent */}
        <div>
          <label htmlFor="agentId" className={labelClass}>
            Agent <span className="text-red-400">*</span>
          </label>
          <p className="text-xs text-gray-500 mb-2">
            The AI persona this workflow uses when responding.
          </p>
          {agents.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              No agents available. Create an agent first.
            </p>
          ) : (
            <select
              id="agentId"
              required
              value={form.agentId}
              onChange={(e) => handleField('agentId', e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Context Policy */}
        <fieldset className="rounded-lg border border-gray-700 p-5">
          <legend className="px-2 text-sm font-semibold text-gray-300">Context Policy</legend>
          <p className="text-xs text-gray-500 mb-5">
            Controls how much conversation history the AI receives on each response.
          </p>

          <div className="space-y-5">
            {/* Recent Messages */}
            <div>
              <label htmlFor="recentMessages" className={labelClass}>
                Recent Messages
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Number of recent messages to include verbatim in context.
              </p>
              <input
                id="recentMessages"
                type="number"
                min={1}
                max={100}
                value={form.recentMessages}
                onChange={(e) =>
                  handleField('recentMessages', Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className={`${inputClass} w-32`}
              />
            </div>

            {/* Max Age Hours */}
            <div>
              <label htmlFor="maxAgeHours" className={labelClass}>
                Max Age (hours)
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Only include messages sent within this many hours.
              </p>
              <input
                id="maxAgeHours"
                type="number"
                min={1}
                max={720}
                value={form.maxAgeHours}
                onChange={(e) =>
                  handleField('maxAgeHours', Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className={`${inputClass} w-32`}
              />
            </div>

            {/* Max Transcript Chars */}
            <div>
              <label htmlFor="maxTranscriptChars" className={labelClass}>
                Max Transcript Characters
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Hard cap on total context characters sent to the AI.
              </p>
              <input
                id="maxTranscriptChars"
                type="number"
                min={1000}
                max={200000}
                step={1000}
                value={form.maxTranscriptChars}
                onChange={(e) =>
                  handleField(
                    'maxTranscriptChars',
                    Math.max(1000, parseInt(e.target.value, 10) || 1000),
                  )
                }
                className={`${inputClass} w-40`}
              />
            </div>

            {/* Checkboxes */}
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.useSummary}
                  onChange={(e) => handleField('useSummary', e.target.checked)}
                  className="mt-0.5 accent-amber-500 shrink-0 h-4 w-4 cursor-pointer"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-300 group-hover:text-gray-200 transition-colors">
                    Use Rolling Summary
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Prepend an AI-generated summary of older conversation history.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.includeTributeContext}
                  onChange={(e) => handleField('includeTributeContext', e.target.checked)}
                  className="mt-0.5 accent-amber-500 shrink-0 h-4 w-4 cursor-pointer"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-300 group-hover:text-gray-200 transition-colors">
                    Include Tribute Context
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Inject tribute stats and leaderboard into the AI context.
                  </span>
                </span>
              </label>
            </div>

            {/* Custom Instructions */}
            <div>
              <label htmlFor="customInstructions" className={labelClass}>
                Custom Instructions
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Workflow-level instructions appended to the agent system prompt for this context.
              </p>
              <textarea
                id="customInstructions"
                value={form.customInstructions}
                onChange={(e) => handleField('customInstructions', e.target.value)}
                className={`${inputClass} min-h-[100px] resize-y`}
                placeholder="e.g. Keep responses brief. Focus on the current topic."
              />
            </div>
          </div>
        </fieldset>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-800">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || deleting || agents.length === 0}
              className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-semibold text-white transition-colors"
            >
              {saving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Workflow'}
            </button>
            <button
              type="button"
              disabled={saving || deleting}
              onClick={() => router.push('/admin/workflows')}
              className="rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>

          {isEditMode && !workflow?.isDefault && (
            <button
              type="button"
              disabled={saving || deleting}
              onClick={handleDelete}
              className="rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              {deleting ? 'Deleting...' : 'Delete Workflow'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
