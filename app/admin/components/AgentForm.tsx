'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Agent } from '@/src/services/agents';

// Usage:
//   <AgentForm />                    — create mode
//   <AgentForm agent={existingAgent} /> — edit mode

const AVAILABLE_CAPABILITIES = [
  { value: 'image_analysis', label: 'Image Analysis' },
  { value: 'tribute_tracking', label: 'Tribute Tracking' },
  { value: 'web_search', label: 'Web Search' },
  { value: 'scheduled_messages', label: 'Scheduled Messages' },
  { value: 'random_facts', label: 'Random Facts' },
  { value: 'content_moderation', label: 'Content Moderation' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'external_api', label: 'External API' },
] as const;

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
const DEFAULT_TEMPERATURE = 0.7;

interface AgentFormProps {
  agent?: Agent;
}

interface FormState {
  name: string;
  description: string;
  systemPrompt: string;
  customInstructions: string;
  model: string;
  temperature: number;
  capabilities: string[];
}

function buildInitialState(agent?: Agent): FormState {
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    systemPrompt: agent?.systemPrompt ?? '',
    customInstructions: agent?.customInstructions ?? '',
    model: agent?.model ?? DEFAULT_MODEL,
    temperature: agent?.params?.temperature ?? DEFAULT_TEMPERATURE,
    capabilities: agent?.capabilities ?? [],
  };
}

export default function AgentForm({ agent }: AgentFormProps) {
  const router = useRouter();
  const isEditMode = Boolean(agent);

  const [form, setForm] = useState<FormState>(() => buildInitialState(agent));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCapability(cap: string) {
    setForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap],
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const body = {
      name: form.name,
      description: form.description || null,
      systemPrompt: form.systemPrompt || null,
      customInstructions: form.customInstructions || null,
      model: form.model,
      params: { temperature: form.temperature },
      capabilities: form.capabilities,
    };

    try {
      const url = isEditMode
        ? `/api/admin/agents/${agent!.id}`
        : '/api/admin/agents';
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

      router.push('/admin/agents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!agent) return;
    if (!window.confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;

    setError(null);
    setDeleting(true);

    try {
      const res = await fetch(`/api/admin/agents/${agent.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed with status ${res.status}`);
      }

      router.push('/admin/agents');
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

        {/* Default-agent notice */}
        {agent?.isDefault && (
          <div className="rounded-md bg-amber-900/30 border border-amber-700/50 px-4 py-3 text-sm text-amber-300">
            This is the default agent. It cannot be deleted.
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
            placeholder="e.g. Sensei Mutum"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className={labelClass}>
            Description
          </label>
          <input
            id="description"
            type="text"
            value={form.description}
            onChange={(e) => handleField('description', e.target.value)}
            className={inputClass}
            placeholder="Short description of this agent's purpose"
          />
        </div>

        {/* System Prompt */}
        <div>
          <label htmlFor="systemPrompt" className={labelClass}>
            System Prompt
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Full persona definition. Safety guardrails are always prepended automatically.
          </p>
          <textarea
            id="systemPrompt"
            value={form.systemPrompt}
            onChange={(e) => handleField('systemPrompt', e.target.value)}
            className={`${inputClass} min-h-[200px] resize-y font-mono text-xs leading-relaxed`}
            placeholder="You are a wise ancient entity who..."
          />
        </div>

        {/* Custom Instructions */}
        <div>
          <label htmlFor="customInstructions" className={labelClass}>
            Custom Instructions
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Channel-specific tweaks added after the system prompt. Useful without rewriting the full persona.
          </p>
          <textarea
            id="customInstructions"
            value={form.customInstructions}
            onChange={(e) => handleField('customInstructions', e.target.value)}
            className={`${inputClass} min-h-[100px] resize-y`}
            placeholder="Always respond in Swedish. Keep replies under 3 sentences."
          />
        </div>

        {/* Model */}
        <div>
          <label htmlFor="model" className={labelClass}>
            Model
          </label>
          <input
            id="model"
            type="text"
            value={form.model}
            onChange={(e) => handleField('model', e.target.value)}
            className={inputClass}
            placeholder={DEFAULT_MODEL}
          />
        </div>

        {/* Temperature */}
        <div>
          <label htmlFor="temperature" className={labelClass}>
            Temperature
            <span className="ml-2 text-amber-400 font-mono">{form.temperature.toFixed(1)}</span>
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Controls randomness. 0 = deterministic, 2 = very creative.
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-4">0</span>
            <input
              id="temperature"
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) => handleField('temperature', parseFloat(e.target.value))}
              className="flex-1 accent-amber-500 h-2 cursor-pointer"
            />
            <span className="text-xs text-gray-500 w-4">2</span>
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <span className={labelClass}>Capabilities</span>
          <p className="text-xs text-gray-500 mb-3">
            Select what features this agent is allowed to use.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AVAILABLE_CAPABILITIES.map(({ value, label }) => {
              const checked = form.capabilities.includes(value);
              return (
                <label
                  key={value}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    checked
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-amber-500 shrink-0"
                    checked={checked}
                    onChange={() => toggleCapability(value)}
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-800">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || deleting}
              className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-semibold text-white transition-colors"
            >
              {saving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Agent'}
            </button>
            <button
              type="button"
              disabled={saving || deleting}
              onClick={() => router.push('/admin/agents')}
              className="rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>

          {isEditMode && !agent?.isDefault && (
            <button
              type="button"
              disabled={saving || deleting}
              onClick={handleDelete}
              className="rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              {deleting ? 'Deleting...' : 'Delete Agent'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
