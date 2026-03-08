'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentParams } from '@/src/services/agents';
import type { ModelInfo, InputModality } from '@/src/models';

// Usage:
//   <AgentForm />                    — create mode
//   <AgentForm agent={existingAgent} /> — edit mode

/** JSON-serializable subset of Agent (no Date fields) for server→client prop passing */
export interface SerializableAgent {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  customInstructions: string | null;
  capabilities: string[];
  model: string;
  params: AgentParams;
  isDefault: boolean;
  isActive: boolean;
}

const AVAILABLE_CAPABILITIES = [
  { value: 'image_analysis', label: 'Image Analysis', desc: 'AI-analyze images in /tribute and @mentions. Requires model with image input.' },
  { value: 'tribute_tracking', label: 'Tribute Tracking', desc: 'Enables /tribute, /tally, /demand commands and mention-based tribute scoring.' },
  { value: 'web_search', label: 'Web Search', desc: 'Enables real-time web search via OpenRouter (:online plugin). Extra cost per query.' },
  { value: 'scheduled_messages', label: 'Scheduled Messages', desc: 'AI can create/manage cron events (reminders, auto-messages, AI prompts).' },
  { value: 'random_facts', label: 'Random Facts', desc: 'Enables the /drink random command for tiki and cocktail trivia.' },
  { value: 'content_moderation', label: 'Content Moderation', desc: 'Filter and moderate user messages. (Coming soon)' },
  { value: 'knowledge', label: 'Knowledge', desc: 'AI can remember_fact and recall_facts — persistent memory across conversations.' },
  { value: 'external_api', label: 'External API', desc: 'Call external APIs for data lookups. (Coming soon)' },
] as const;

/** Model requirements for each capability. If the model lacks these, the capability is disabled. */
const CAPABILITY_REQUIREMENTS: Partial<Record<string, { modalities?: InputModality[]; reason: string }>> = {
  image_analysis: { modalities: ['image'], reason: 'Model does not support image input' },
};

/** Custom bot tools grouped by which capability gates them */
const CUSTOM_TOOL_SETS: { capability: string | null; label: string; tools: string[] }[] = [
  { capability: null, label: 'Always Available', tools: ['list_channels'] },
  { capability: 'scheduled_messages', label: 'Scheduled Messages', tools: ['create_scheduled_event', 'list_scheduled_events', 'update_scheduled_event', 'delete_scheduled_event'] },
  { capability: 'knowledge', label: 'Knowledge', tools: ['remember_fact', 'recall_facts'] },
  { capability: 'web_search', label: 'Web Search (OpenRouter)', tools: ['model:online (built-in)'] },
];

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
const DEFAULT_TEMPERATURE = 0.7;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${Math.round(n / 1_000)}K`;
}

function formatPrice(p: number): string {
  if (p === 0) return 'Free';
  if (p < 0.01) return `$${p.toFixed(3)}`;
  return `$${p.toFixed(2)}`;
}

interface AgentFormProps {
  agent?: SerializableAgent;
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

function buildInitialState(agent?: SerializableAgent): FormState {
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
  const [models, setModels] = useState<ModelInfo[]>([]);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/models');
      if (res.ok) setModels(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  // Re-fetch agent data from API on mount to guard against serialization issues
  // between server component and client component (e.g. capabilities lost in transit)
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (!agent?.id || hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    fetch(`/api/admin/agents/${agent.id}`)
      .then((res) => res.ok ? res.json() : null)
      .then((fresh) => {
        if (!fresh?.capabilities) return;
        const freshCaps: string[] = Array.isArray(fresh.capabilities) ? fresh.capabilities : [];
        setForm((prev) => {
          // Only update if the API has capabilities that the initial state is missing
          if (freshCaps.length > 0 && prev.capabilities.length === 0) {
            return { ...prev, capabilities: freshCaps };
          }
          // Also sync if the arrays differ (covers partial corruption)
          const same = prev.capabilities.length === freshCaps.length &&
            prev.capabilities.every((c) => freshCaps.includes(c));
          if (!same && freshCaps.length > 0) {
            return { ...prev, capabilities: freshCaps };
          }
          return prev;
        });
      })
      .catch(() => { /* ignore - initial props are the fallback */ });
  }, [agent?.id]);

  const selectedModel = models.find((m) => m.id === form.model);

  /** Check if a capability is compatible with the currently selected model */
  function isCapabilityDisabled(cap: string): string | null {
    const req = CAPABILITY_REQUIREMENTS[cap];
    if (!req || !selectedModel) return null;
    if (req.modalities?.some((m) => !selectedModel.inputModalities.includes(m))) {
      return req.reason;
    }
    return null;
  }

  // Auto-remove incompatible capabilities when model changes
  const prevModelRef = useRef(form.model);
  useEffect(() => {
    if (prevModelRef.current === form.model || !selectedModel) {
      prevModelRef.current = form.model;
      return;
    }
    prevModelRef.current = form.model;

    setForm((prev) => {
      const incompatible = prev.capabilities.filter((cap) => {
        const req = CAPABILITY_REQUIREMENTS[cap];
        if (!req) return false;
        return req.modalities?.some((m) => !selectedModel.inputModalities.includes(m));
      });
      if (incompatible.length === 0) return prev;
      return { ...prev, capabilities: prev.capabilities.filter((c) => !incompatible.includes(c)) };
    });
  }, [form.model, selectedModel]);

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
          {models.length > 0 ? (
            <select
              id="model"
              value={form.model}
              onChange={(e) => handleField('model', e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              {!models.find((m) => m.id === form.model) && (
                <option value={form.model}>{form.model} (custom)</option>
              )}
              {/* Group by provider */}
              {['Google', 'OpenAI', 'Anthropic', 'DeepSeek', 'Perplexity'].map((provider) => {
                const providerModels = models.filter((m) => m.provider === provider);
                if (providerModels.length === 0) return null;
                return (
                  <optgroup key={provider} label={provider}>
                    {providerModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {formatPrice(m.inputPricePerM)}/{formatPrice(m.outputPricePerM)} per M
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          ) : (
            <input
              id="model"
              type="text"
              value={form.model}
              onChange={(e) => handleField('model', e.target.value)}
              className={inputClass}
              placeholder={DEFAULT_MODEL}
            />
          )}
          {/* Model info card */}
          {selectedModel && (
            <div className="mt-3 rounded-md border border-gray-700 bg-gray-800/60 p-3 text-xs space-y-1.5">
              <p className="text-gray-300 font-medium">{selectedModel.description}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-400">
                <span>In: {formatPrice(selectedModel.inputPricePerM)}/M</span>
                <span>Out: {formatPrice(selectedModel.outputPricePerM)}/M</span>
                <span>Context: {formatTokens(selectedModel.maxInputTokens)}</span>
                <span>Max out: {formatTokens(selectedModel.maxOutputTokens)}</span>
                <span>Speed: {selectedModel.speed}</span>
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {selectedModel.inputModalities.map((m) => (
                  <span key={m} className="rounded-full bg-blue-900/40 border border-blue-700/40 px-2 py-0.5 text-blue-300">
                    {m}
                  </span>
                ))}
                {selectedModel.nativeTools.map((t) => (
                  <span key={t} className="rounded-full bg-green-900/40 border border-green-700/40 px-2 py-0.5 text-green-300">
                    {t.replace('_', ' ')}
                  </span>
                ))}
              </div>
              {selectedModel.notes && (
                <p className="text-gray-500 italic">{selectedModel.notes}</p>
              )}
            </div>
          )}
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
            Select what features this agent is allowed to use. Incompatible options are auto-disabled based on the selected model.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AVAILABLE_CAPABILITIES.map(({ value, label, desc }) => {
              const checked = form.capabilities.includes(value);
              const disabledReason = isCapabilityDisabled(value);
              const disabled = disabledReason !== null;
              return (
                <label
                  key={value}
                  title={disabledReason ?? desc}
                  className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors ${
                    disabled
                      ? 'border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed opacity-50'
                      : checked
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 cursor-pointer'
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-amber-500 shrink-0 mt-0.5"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => !disabled && toggleCapability(value)}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{label}</span>
                      {disabled && <span className="text-[10px] text-gray-600">N/A</span>}
                    </div>
                    <p className={`text-xs mt-0.5 leading-snug ${disabled ? 'text-gray-700' : checked ? 'text-amber-400/60' : 'text-gray-500'}`}>
                      {disabled ? disabledReason : desc}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Active Tools Summary */}
        <div>
          <span className={labelClass}>Active Tools</span>
          <p className="text-xs text-gray-500 mb-3">
            Tools available to this agent based on capabilities and model.
          </p>
          <div className="space-y-2">
            {/* Custom bot tools */}
            {CUSTOM_TOOL_SETS.map(({ capability, label, tools }) => {
              const active = capability === null || form.capabilities.includes(capability);
              return (
                <div key={label} className={`rounded-md border px-3 py-2 text-xs ${active ? 'border-gray-700 bg-gray-800/60' : 'border-gray-800 bg-gray-900/40 opacity-40'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-medium ${active ? 'text-gray-300' : 'text-gray-600'}`}>{label}</span>
                    {capability && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-800 text-gray-600'}`}>
                        {active ? 'enabled' : 'disabled'}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tools.map((t) => (
                      <span key={t} className={`rounded px-1.5 py-0.5 font-mono ${active ? 'bg-gray-700 text-gray-400' : 'bg-gray-800 text-gray-600'}`}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {/* Native model tools */}
            {selectedModel && selectedModel.nativeTools.length > 0 && (
              <div className="rounded-md border border-green-900/50 bg-green-900/10 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-green-400">Native Model Tools</span>
                  <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">built-in</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedModel.nativeTools.map((t) => (
                    <span key={t} className="rounded bg-green-900/30 px-1.5 py-0.5 font-mono text-green-300">
                      {t.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {selectedModel && selectedModel.nativeTools.length === 0 && (
              <p className="text-xs text-gray-600 italic">This model has no native tools.</p>
            )}
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
