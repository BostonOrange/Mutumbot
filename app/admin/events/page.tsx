'use client';

import { useState, useEffect, useCallback } from 'react';

interface ScheduledEvent {
  id: string;
  name: string;
  description: string | null;
  threadId: string;
  guildName: string | null;
  channelName: string | null;
  cronExpression: string;
  eventType: string;
  payload: Record<string, unknown>;
  timezone: string;
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'failed' | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  tribute_reminder: { label: 'Tribute Reminder', color: 'bg-amber-900/40 text-amber-400 border-amber-700/50' },
  custom_message: { label: 'Custom Message', color: 'bg-blue-900/40 text-blue-400 border-blue-700/50' },
  ai_prompt: { label: 'AI Prompt', color: 'bg-purple-900/40 text-purple-400 border-purple-700/50' },
  status_report: { label: 'Status Report', color: 'bg-green-900/40 text-green-400 border-green-700/50' },
  channel_summary: { label: 'Channel Summary', color: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/50' },
};

/** Simple cron-to-English description */
function describeCron(cron: string, tz: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [minute, hour, , , weekday] = parts;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let desc = '';
  if (hour !== '*' && minute !== '*') {
    desc += `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  if (weekday !== '*') {
    if (weekday.includes('-')) {
      const [start, end] = weekday.split('-').map(Number);
      desc += ` ${days[start]}-${days[end]}`;
    } else if (weekday.includes(',')) {
      desc += ` ${weekday.split(',').map((d) => days[Number(d)]).join(', ')}`;
    } else {
      desc += ` every ${days[Number(weekday)]}`;
    }
  } else {
    desc += ' daily';
  }

  const shortTz = tz.replace('Europe/', '').replace('America/', '');
  return `${desc.trim()} (${shortTz})`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Extract channel ID from thread ID */
function channelDisplay(event: ScheduledEvent): string {
  if (event.channelName) return `#${event.channelName}`;
  const parts = event.threadId.split(':');
  return parts[2] ? `#${parts[2]}` : event.threadId;
}

function guildDisplay(event: ScheduledEvent): string {
  if (event.guildName) return event.guildName;
  const parts = event.threadId.split(':');
  if (parts[1] === 'dm') return 'DM';
  return parts[1] ?? 'Unknown';
}

export default function EventsPage() {
  const [events, setEvents] = useState<ScheduledEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/events');
      if (!res.ok) throw new Error('Failed to load events');
      setEvents(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  async function toggleActive(event: ScheduledEvent) {
    setToggling((prev) => new Set(prev).add(event.id));
    try {
      const res = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: event.id, isActive: !event.isActive }),
      });
      if (!res.ok) throw new Error('Failed to toggle event');
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setToggling((prev) => { const next = new Set(prev); next.delete(event.id); return next; });
    }
  }

  async function handleDelete(event: ScheduledEvent) {
    if (!window.confirm(`Delete "${event.name}"? This cannot be undone.`)) return;
    setDeleting((prev) => new Set(prev).add(event.id));
    try {
      const res = await fetch(`/api/admin/events?id=${event.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete event');
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDeleting((prev) => { const next = new Set(prev); next.delete(event.id); return next; });
    }
  }

  // Group events by channel
  const grouped = events.reduce<Record<string, ScheduledEvent[]>>((acc, event) => {
    const key = event.threadId;
    (acc[key] ??= []).push(event);
    return acc;
  }, {});

  const activeCount = events.filter((e) => e.isActive).length;
  const failedCount = events.filter((e) => e.lastRunStatus === 'failed').length;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-100">Scheduled Events</h2>
        <p className="mt-1 text-sm text-gray-500">
          Cron-based events across all channels. Manage reminders, auto-messages, and AI prompts.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-2.5">
          <span className="text-xs text-gray-500">Total</span>
          <span className="ml-2 text-sm font-semibold text-gray-200">{events.length}</span>
        </div>
        <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-2.5">
          <span className="text-xs text-gray-500">Active</span>
          <span className="ml-2 text-sm font-semibold text-green-400">{activeCount}</span>
        </div>
        {failedCount > 0 && (
          <div className="rounded-md border border-red-900/50 bg-red-900/20 px-4 py-2.5">
            <span className="text-xs text-red-400">Failed</span>
            <span className="ml-2 text-sm font-semibold text-red-300">{failedCount}</span>
          </div>
        )}
        <div className="rounded-md border border-gray-800 bg-gray-900 px-4 py-2.5">
          <span className="text-xs text-gray-500">Channels</span>
          <span className="ml-2 text-sm font-semibold text-gray-200">{Object.keys(grouped).length}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-sm text-gray-500">Loading events...</div>
      )}

      {/* Empty */}
      {!loading && events.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
          <p className="text-sm font-medium text-gray-400">No scheduled events</p>
          <p className="mt-1 text-xs text-gray-600">
            Events are created by the AI via the scheduled_messages capability.
          </p>
        </div>
      )}

      {/* Events grouped by channel */}
      {Object.entries(grouped).map(([threadId, channelEvents]) => {
        const sample = channelEvents[0];
        const channelActive = channelEvents.filter((e) => e.isActive).length;
        const channelFailed = channelEvents.filter((e) => e.lastRunStatus === 'failed').length;

        return (
          <div key={threadId} className="mb-6">
            {/* Channel header */}
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-sm font-semibold text-gray-200">
                {channelDisplay(sample)}
              </h3>
              <span className="text-xs text-gray-500">{guildDisplay(sample)}</span>
              <span className="text-xs text-gray-600 font-mono">{threadId}</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-gray-500">{channelEvents.length} event{channelEvents.length !== 1 ? 's' : ''}</span>
                {channelActive > 0 && <span className="text-xs text-green-500">{channelActive} active</span>}
                {channelFailed > 0 && <span className="text-xs text-red-400">{channelFailed} failed</span>}
              </div>
            </div>

            {/* Event rows */}
            <div className="space-y-2">
              {channelEvents.map((event) => {
                const typeInfo = EVENT_TYPE_LABELS[event.eventType] ?? { label: event.eventType, color: 'bg-gray-800 text-gray-400 border-gray-700' };
                const isExpanded = expandedId === event.id;
                const isToggling = toggling.has(event.id);
                const isDeleting = deleting.has(event.id);

                return (
                  <div
                    key={event.id}
                    className={`rounded-lg border bg-gray-900 p-4 transition-colors ${
                      event.isActive ? 'border-gray-800' : 'border-gray-800/50 opacity-60'
                    }`}
                  >
                    {/* Main row */}
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-100">{event.name}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${typeInfo.color}`}>
                            {typeInfo.label}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            event.isActive
                              ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                              : 'bg-gray-800 border border-gray-700 text-gray-500'
                          }`}>
                            {event.isActive ? 'Active' : 'Paused'}
                          </span>
                          {event.lastRunStatus === 'failed' && (
                            <span className="rounded-full bg-red-900/40 border border-red-700/50 px-2 py-0.5 text-[11px] font-medium text-red-400">
                              Last run failed
                            </span>
                          )}
                        </div>

                        {/* Schedule */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                          <span className="font-mono">{event.cronExpression}</span>
                          <span>{describeCron(event.cronExpression, event.timezone)}</span>
                          {event.lastRunAt && (
                            <span className={event.lastRunStatus === 'failed' ? 'text-red-400' : 'text-gray-500'}>
                              Last run: {timeAgo(event.lastRunAt)}
                            </span>
                          )}
                          {!event.lastRunAt && (
                            <span className="text-gray-600 italic">Never run</span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : event.id)}
                          className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                        <button
                          onClick={() => toggleActive(event)}
                          disabled={isToggling}
                          className={`rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            event.isActive
                              ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                              : 'bg-green-800 hover:bg-green-700 text-green-200'
                          }`}
                        >
                          {isToggling ? '...' : event.isActive ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => handleDelete(event)}
                          disabled={isDeleting}
                          className="rounded px-3 py-1 text-xs font-medium bg-red-900/60 hover:bg-red-800 text-red-300 transition-colors disabled:opacity-50"
                        >
                          {isDeleting ? '...' : 'Delete'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-800 space-y-2 text-xs">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div>
                            <span className="text-gray-500 block">Timezone</span>
                            <span className="text-gray-300">{event.timezone}</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">Created</span>
                            <span className="text-gray-300">{new Date(event.createdAt).toLocaleDateString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">Last Run</span>
                            <span className={event.lastRunStatus === 'failed' ? 'text-red-400' : 'text-gray-300'}>
                              {event.lastRunAt ? new Date(event.lastRunAt).toLocaleString() : 'Never'}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">Event ID</span>
                            <span className="text-gray-400 font-mono break-all">{event.id}</span>
                          </div>
                        </div>

                        {/* Payload */}
                        {Object.keys(event.payload).length > 0 && (
                          <div>
                            <span className="text-gray-500 block mb-1">Payload</span>
                            <pre className="rounded bg-gray-800 p-2 text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Last error */}
                        {event.lastError && (
                          <div>
                            <span className="text-red-400 block mb-1">Last Error</span>
                            <pre className="rounded bg-red-900/20 border border-red-900/50 p-2 text-red-300 font-mono overflow-x-auto whitespace-pre-wrap">
                              {event.lastError}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
