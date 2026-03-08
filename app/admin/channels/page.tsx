'use client';

// Usage: /admin/channels
// Displays all known threads with Discord names, memory stats, and workflow assignments.

import { useState, useEffect, useCallback } from 'react';

interface ChannelRow {
  thread_id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  agent_name: string | null;
  guild_name: string | null;
  channel_name: string | null;
  summary: string | null;
  summary_updated_at: string | null;
  updated_at: string | null;
  item_count: number;
}

interface Workflow {
  id: string;
  name: string;
  isDefault?: boolean;
}

type ActionStatus = { type: 'success' | 'error'; message: string; threadId: string } | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatThreadIdShort(threadId: string): string {
  const parts = threadId.split(':');
  if (parts.length === 3 && parts[0] === 'discord') {
    if (parts[1] === 'dm') return `DM: ${parts[2]}`;
    return parts[2];
  }
  return threadId;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ─── Shared style constants ───────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors';

const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBanner({ status, onDismiss }: { status: ActionStatus; onDismiss: () => void }) {
  if (!status) return null;
  const isSuccess = status.type === 'success';
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-4 py-3 text-sm ${
        isSuccess
          ? 'bg-green-900/40 border-green-700 text-green-300'
          : 'bg-red-900/40 border-red-700 text-red-300'
      }`}
    >
      <span>{status.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-4 shrink-0 text-xs opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}

function WorkflowSelect({
  id,
  value,
  workflows,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  workflows: Workflow[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (workflows.length === 0) {
    return <span className="text-xs text-gray-500 italic">No workflows</span>;
  }
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={SELECT_CLASS}
      aria-label="Select workflow"
    >
      {workflows.map((wf) => (
        <option key={wf.id} value={wf.id}>
          {wf.name}
          {wf.isDefault ? ' (default)' : ''}
        </option>
      ))}
    </select>
  );
}

// ─── Memory / History panel ──────────────────────────────────────────────────

interface ThreadItem {
  id: string;
  type: string;
  role: string;
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
}

function MemoryPanel({ row }: { row: ChannelRow }) {
  const [expanded, setExpanded] = useState(false);
  const [historyItems, setHistoryItems] = useState<ThreadItem[] | null>(null);
  const [historySummary, setHistorySummary] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const hasSummary = !!row.summary;
  const hasMemory = row.item_count > 0 || hasSummary;

  if (!hasMemory) {
    return <span className="text-xs text-gray-600 italic">No memory</span>;
  }

  async function loadHistory() {
    if (historyItems !== null) {
      setExpanded(!expanded);
      return;
    }
    setExpanded(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/channels/${encodeURIComponent(row.thread_id)}`);
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(data.items ?? []);
        setHistorySummary(data.summary ?? null);
      }
    } catch {
      // silently fail
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={loadHistory}
        className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
      >
        {row.item_count} messages{hasSummary ? ' + summary' : ''}
        {row.summary_updated_at && ` (${formatRelativeTime(row.summary_updated_at)})`}
        <span className="ml-1">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="mt-2 rounded-md bg-gray-800/60 border border-gray-700 p-3 max-h-64 overflow-y-auto space-y-2">
          {historyLoading && <p className="text-xs text-gray-500">Loading...</p>}
          {historySummary && (
            <div className="pb-2 mb-2 border-b border-gray-700">
              <p className="text-xs font-semibold text-gray-400 mb-1">Rolling Summary</p>
              <p className="text-xs text-gray-500 whitespace-pre-wrap">{historySummary}</p>
            </div>
          )}
          {historyItems && historyItems.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-400 mb-1">
                Recent Messages (newest first)
              </p>
              {historyItems.map((item) => (
                <div key={item.id} className="text-xs">
                  <span className={`font-medium ${item.role === 'assistant' ? 'text-amber-400' : 'text-blue-400'}`}>
                    {item.author_name ?? (item.role === 'assistant' ? 'Bot' : 'User')}
                  </span>
                  <span className="text-gray-600 ml-1.5">
                    {formatRelativeTime(item.created_at)}
                  </span>
                  <p className="text-gray-400 mt-0.5 whitespace-pre-wrap break-words">{item.content}</p>
                </div>
              ))}
            </div>
          )}
          {historyItems && historyItems.length === 0 && !historySummary && (
            <p className="text-xs text-gray-600 italic">No conversation history found.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Channel table row ──────────────────────────────────────────────────────

function ChannelTableRow({
  row,
  workflows,
  onUpdate,
  actionStatus,
}: {
  row: ChannelRow;
  workflows: Workflow[];
  onUpdate: (threadId: string, workflowId: string, resetHistory: boolean) => Promise<void>;
  actionStatus: ActionStatus;
}) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState(row.workflow_id ?? workflows[0]?.id ?? '');
  const [resetHistory, setResetHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  const isDirty = selectedWorkflowId !== (row.workflow_id ?? '') || resetHistory;
  const isThisRowStatus = actionStatus?.threadId === row.thread_id;

  async function handleUpdate() {
    setSaving(true);
    await onUpdate(row.thread_id, selectedWorkflowId, resetHistory);
    setResetHistory(false);
    setSaving(false);
  }

  return (
    <tr className="border-b border-gray-800 last:border-0">
      {/* Channel info */}
      <td className="py-3 px-4 align-top">
        <div className="min-w-[160px]">
          {row.channel_name ? (
            <span className="block text-sm font-medium text-gray-100">
              #{row.channel_name}
            </span>
          ) : (
            <span className="block text-sm font-mono text-gray-100 truncate max-w-[160px]">
              {formatThreadIdShort(row.thread_id)}
            </span>
          )}
          {row.guild_name && (
            <span className="block text-xs text-gray-500 mt-0.5">{row.guild_name}</span>
          )}
          <span className="block text-xs text-gray-600 mt-0.5 font-mono truncate max-w-[200px]" title={row.thread_id}>
            {row.thread_id}
          </span>
        </div>
      </td>

      {/* Agent */}
      <td className="py-3 px-4 align-top">
        {row.workflow_id ? (
          <span className="text-sm text-gray-300">{row.agent_name ?? '\u2014'}</span>
        ) : (
          <span className="text-xs text-amber-400 italic">Unassigned (uses default)</span>
        )}
      </td>

      {/* Memory */}
      <td className="py-3 px-4 align-top">
        <MemoryPanel row={row} />
      </td>

      {/* Workflow dropdown */}
      <td className="py-3 px-4 align-top min-w-[180px]">
        <WorkflowSelect
          id={`wf-${row.thread_id}`}
          value={selectedWorkflowId}
          workflows={workflows}
          onChange={setSelectedWorkflowId}
          disabled={saving}
        />
      </td>

      {/* Reset history + Update */}
      <td className="py-3 px-4 align-top whitespace-nowrap">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={resetHistory}
              onChange={(e) => setResetHistory(e.target.checked)}
              disabled={saving}
              className="accent-amber-500 h-4 w-4 cursor-pointer"
              aria-label="Reset conversation history"
            />
            <span className="text-xs text-gray-400">Reset</span>
          </label>
          <button
            type="button"
            disabled={saving || !isDirty}
            onClick={handleUpdate}
            className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-semibold text-white transition-colors whitespace-nowrap"
          >
            {saving ? 'Saving...' : 'Update'}
          </button>
        </div>
        {isThisRowStatus && (
          <p
            className={`text-xs mt-1 ${
              actionStatus?.type === 'success' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {actionStatus?.message}
          </p>
        )}
      </td>
    </tr>
  );
}

// ─── Assign new channel form ──────────────────────────────────────────────────

function AssignNewForm({
  workflows,
  onAssign,
  status,
}: {
  workflows: Workflow[];
  onAssign: (threadId: string, workflowId: string, resetHistory: boolean) => Promise<void>;
  status: ActionStatus;
}) {
  const defaultWorkflowId = workflows.find((w) => w.isDefault)?.id ?? workflows[0]?.id ?? '';

  const [threadId, setThreadId] = useState('');
  const [workflowId, setWorkflowId] = useState(defaultWorkflowId);
  const [resetHistory, setResetHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Keep default in sync when workflows first load
  useEffect(() => {
    if (!workflowId && defaultWorkflowId) {
      setWorkflowId(defaultWorkflowId);
    }
  }, [defaultWorkflowId, workflowId]);

  const isNewFormStatus = status?.threadId === '__new__';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    const trimmed = threadId.trim();
    if (!trimmed) {
      setLocalError('Thread ID is required.');
      return;
    }
    if (!workflowId) {
      setLocalError('Select a workflow.');
      return;
    }

    setSaving(true);
    await onAssign(trimmed, workflowId, resetHistory);
    setSaving(false);

    // Only clear the form on success
    if (status?.type !== 'error') {
      setThreadId('');
      setResetHistory(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="space-y-4">
        {localError && (
          <p className="text-sm text-red-400">{localError}</p>
        )}
        {isNewFormStatus && (
          <p
            className={`text-sm ${
              status?.type === 'success' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {status?.message}
          </p>
        )}

        {/* Thread ID */}
        <div>
          <label htmlFor="new-thread-id" className="block text-sm font-medium text-gray-300 mb-1.5">
            Thread ID <span className="text-red-400">*</span>
          </label>
          <input
            id="new-thread-id"
            type="text"
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            placeholder="discord:guildId:channelId"
            disabled={saving}
            className={INPUT_CLASS}
            aria-describedby="thread-id-hint"
          />
          <p id="thread-id-hint" className="mt-1 text-xs text-gray-500">
            Format: <code className="font-mono">discord:guildId:channelId</code> or{' '}
            <code className="font-mono">discord:dm:channelId</code>
          </p>
        </div>

        {/* Workflow */}
        <div>
          <label htmlFor="new-workflow-id" className="block text-sm font-medium text-gray-300 mb-1.5">
            Workflow <span className="text-red-400">*</span>
          </label>
          <WorkflowSelect
            id="new-workflow-id"
            value={workflowId}
            workflows={workflows}
            onChange={setWorkflowId}
            disabled={saving}
          />
        </div>

        {/* Reset history */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={resetHistory}
            onChange={(e) => setResetHistory(e.target.checked)}
            disabled={saving}
            className="mt-0.5 accent-amber-500 shrink-0 h-4 w-4 cursor-pointer"
          />
          <span>
            <span className="block text-sm font-medium text-gray-300 group-hover:text-gray-200 transition-colors">
              Reset Conversation History
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Clears the existing thread history when assigning this workflow.
            </span>
          </span>
        </label>

        <div className="pt-1">
          <button
            type="submit"
            disabled={saving || workflows.length === 0}
            className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-semibold text-white transition-colors"
          >
            {saving ? 'Assigning...' : 'Assign'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionStatus>(null);

  const fetchData = useCallback(async () => {
    setLoadError(null);
    try {
      const [channelsRes, workflowsRes] = await Promise.all([
        fetch('/api/admin/channels'),
        fetch('/api/admin/workflows'),
      ]);

      if (!channelsRes.ok || !workflowsRes.ok) {
        throw new Error('Failed to load data from the server.');
      }

      const [channelsData, workflowsData] = await Promise.all([
        channelsRes.json(),
        workflowsRes.json(),
      ]);

      setChannels(Array.isArray(channelsData) ? channelsData : []);
      setWorkflows(Array.isArray(workflowsData) ? workflowsData : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unexpected error loading data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleAssign(
    threadId: string,
    workflowId: string,
    resetHistory: boolean,
    isNew = false,
  ) {
    setActionStatus(null);
    try {
      const res = await fetch('/api/admin/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, workflowId, resetHistory }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed with status ${res.status}`);
      }

      const workflowName = workflows.find((w) => w.id === workflowId)?.name ?? workflowId;
      setActionStatus({
        type: 'success',
        message: `Workflow "${workflowName}" assigned successfully.`,
        threadId: isNew ? '__new__' : threadId,
      });

      // Refresh the list so the table stays consistent
      await fetchData();
    } catch (err) {
      setActionStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'An unexpected error occurred.',
        threadId: isNew ? '__new__' : threadId,
      });
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-100">Channel Assignments</h2>
        <p className="mt-1 text-sm text-gray-500">
          Map Discord channels to workflows. The assigned workflow controls which AI agent and context
          policy applies when the bot responds in that channel.
        </p>
      </div>

      {/* Global status banner (for row-level updates) */}
      {actionStatus && actionStatus.threadId !== '__new__' && (
        <div className="mb-6">
          <StatusBanner status={actionStatus} onDismiss={() => setActionStatus(null)} />
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div className="mb-6 rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      {/* ── Channels Table ── */}
      <section aria-labelledby="channels-heading" className="mb-10">
        <h3
          id="channels-heading"
          className="text-base font-semibold text-gray-200 mb-4"
        >
          Known Channels
        </h3>

        {loading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-10 text-center">
            <p className="text-sm text-gray-500">Loading...</p>
          </div>
        ) : channels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
            <p className="text-sm font-medium text-gray-400">No channels found</p>
            <p className="mt-1 text-xs text-gray-600">
              Channels appear here automatically when the bot interacts in them. You can also add one manually below.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-800 overflow-x-auto">
            <table className="w-full text-left" aria-label="Known channels">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-900/60">
                  <th scope="col" className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Channel
                  </th>
                  <th scope="col" className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Agent
                  </th>
                  <th scope="col" className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Memory
                  </th>
                  <th scope="col" className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Workflow
                  </th>
                  <th scope="col" className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-gray-900 divide-y divide-gray-800">
                {channels.map((row) => (
                  <ChannelTableRow
                    key={row.thread_id}
                    row={row}
                    workflows={workflows}
                    onUpdate={(tid, wid, reset) => handleAssign(tid, wid, reset, false)}
                    actionStatus={actionStatus}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Assign New Channel ── */}
      <section aria-labelledby="assign-new-heading">
        <div className="max-w-lg rounded-lg border border-gray-800 bg-gray-900 p-6">
          <h3
            id="assign-new-heading"
            className="text-base font-semibold text-gray-200 mb-1"
          >
            Assign New Channel
          </h3>
          <p className="text-xs text-gray-500 mb-5">
            Enter a thread ID to connect it to a workflow. If the channel is already assigned, this
            will update its workflow.
          </p>

          {loading ? (
            <p className="text-sm text-gray-500">Loading workflows...</p>
          ) : (
            <AssignNewForm
              workflows={workflows}
              onAssign={(tid, wid, reset) => handleAssign(tid, wid, reset, true)}
              status={actionStatus?.threadId === '__new__' ? actionStatus : null}
            />
          )}
        </div>
      </section>
    </div>
  );
}
