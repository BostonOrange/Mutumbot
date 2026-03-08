'use client';

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface PayloadDraft {
  message: string;
  prompt: string;
  includeLeaderboard: boolean;
  includeTributeCount: boolean;
  mentionRole: string;
}

interface EditDraft {
  name: string;
  cronExpression: string;
  timezone: string;
  eventType: string;
  description: string;
  payload: PayloadDraft;
}

interface CreateDraft {
  name: string;
  threadId: string;
  cronExpression: string;
  eventType: string;
  timezone: string;
  description: string;
  guildName: string;
  channelName: string;
  payload: PayloadDraft;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  tribute_reminder: { label: 'Tribute Reminder', color: 'bg-amber-900/40 text-amber-400 border-amber-700/50' },
  custom_message:   { label: 'Custom Message',   color: 'bg-blue-900/40 text-blue-400 border-blue-700/50' },
  ai_prompt:        { label: 'AI Prompt',         color: 'bg-purple-900/40 text-purple-400 border-purple-700/50' },
  status_report:    { label: 'Status Report',     color: 'bg-green-900/40 text-green-400 border-green-700/50' },
  channel_summary:  { label: 'Channel Summary',   color: 'bg-cyan-900/40 text-cyan-400 border-cyan-700/50' },
};

const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS);

const CRON_PRESETS: { label: string; value: string; description: string }[] = [
  { label: 'Fridays 17:00',  value: '0 17 * * 5',   description: 'Every Friday at 17:00' },
  { label: 'Daily 9:00',     value: '0 9 * * *',    description: 'Every day at 09:00' },
  { label: 'Mon–Fri 9:00',   value: '0 9 * * 1-5',  description: 'Weekdays at 09:00' },
  { label: 'Every hour',     value: '0 * * * *',    description: 'At the start of every hour' },
  { label: 'Mon 10:00',      value: '0 10 * * 1',   description: 'Every Monday at 10:00' },
];

const COMMON_TIMEZONES = [
  'Europe/Stockholm',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'UTC',
];

const INPUT_CLS = 'bg-gray-800 border border-gray-700 text-gray-200 rounded px-3 py-2 text-sm w-full focus:outline-none focus:border-gray-500';
const SELECT_CLS = `${INPUT_CLS} cursor-pointer`;
const TEXTAREA_CLS = `${INPUT_CLS} resize-y min-h-[80px]`;
const LABEL_CLS = 'block text-xs font-medium text-gray-400 mb-1';
const FIELD_CLS = 'flex flex-col gap-1';

const EMPTY_PAYLOAD: PayloadDraft = {
  message: '',
  prompt: '',
  includeLeaderboard: false,
  includeTributeCount: false,
  mentionRole: '',
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Simple cron-to-English description */
function describeCron(cron: string, tz: string): string {
  const parts = cron.trim().split(/\s+/);
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
      desc += ` ${days[start]}–${days[end]}`;
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
  return `${Math.floor(hours / 24)}d ago`;
}

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

function payloadFromEvent(event: ScheduledEvent): PayloadDraft {
  const p = event.payload;
  return {
    message:              typeof p.message === 'string' ? p.message : '',
    prompt:               typeof p.prompt  === 'string' ? p.prompt  : '',
    includeLeaderboard:   typeof p.includeLeaderboard === 'boolean' ? p.includeLeaderboard : false,
    includeTributeCount:  typeof p.includeTributeCount === 'boolean' ? p.includeTributeCount : false,
    mentionRole:          typeof p.mentionRole === 'string' ? p.mentionRole : '',
  };
}

function buildPayload(eventType: string, draft: PayloadDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (eventType === 'custom_message' && draft.message) payload.message = draft.message;
  if (eventType === 'ai_prompt' && draft.prompt) payload.prompt = draft.prompt;
  if (eventType === 'status_report') {
    if (draft.includeLeaderboard) payload.includeLeaderboard = true;
    if (draft.includeTributeCount) payload.includeTributeCount = true;
  }
  if (draft.mentionRole) payload.mentionRole = draft.mentionRole;
  return payload;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CronHelper({
  value,
  timezone,
  onChange,
}: {
  value: string;
  timezone: string;
  onChange: (v: string) => void;
}) {
  const description = value.trim() ? describeCron(value, timezone) : null;

  return (
    <div className="rounded bg-gray-800/60 border border-gray-700/60 p-3 space-y-2">
      <p className="text-xs font-medium text-gray-400">Presets</p>
      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              value === preset.value
                ? 'bg-amber-700 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
            title={preset.description}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {description && (
        <p className="text-xs text-gray-400 italic">
          Runs: <span className="text-gray-300 not-italic">{description}</span>
        </p>
      )}
    </div>
  );
}

function PayloadFields({
  eventType,
  payload,
  onChange,
}: {
  eventType: string;
  payload: PayloadDraft;
  onChange: (p: PayloadDraft) => void;
}) {
  const set = <K extends keyof PayloadDraft>(key: K, val: PayloadDraft[K]) =>
    onChange({ ...payload, [key]: val });

  return (
    <div className="space-y-3">
      {eventType === 'custom_message' && (
        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>Message</label>
          <textarea
            className={TEXTAREA_CLS}
            value={payload.message}
            onChange={(e) => set('message', e.target.value)}
            placeholder="Message text to send..."
          />
        </div>
      )}

      {eventType === 'ai_prompt' && (
        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>AI Prompt</label>
          <textarea
            className={TEXTAREA_CLS}
            value={payload.prompt}
            onChange={(e) => set('prompt', e.target.value)}
            placeholder="Prompt to send to the AI..."
          />
        </div>
      )}

      {eventType === 'status_report' && (
        <div className="space-y-2">
          <label className={LABEL_CLS}>Status Report Options</label>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              className="accent-amber-600"
              checked={payload.includeLeaderboard}
              onChange={(e) => set('includeLeaderboard', e.target.checked)}
            />
            Include leaderboard
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              className="accent-amber-600"
              checked={payload.includeTributeCount}
              onChange={(e) => set('includeTributeCount', e.target.checked)}
            />
            Include tribute count
          </label>
        </div>
      )}

      <div className={FIELD_CLS}>
        <label className={LABEL_CLS}>Mention Role (optional)</label>
        <input
          type="text"
          className={INPUT_CLS}
          value={payload.mentionRole}
          onChange={(e) => set('mentionRole', e.target.value)}
          placeholder="e.g. @everyone or role ID"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline edit form
// ---------------------------------------------------------------------------

function EditForm({
  event,
  onSave,
  onCancel,
}: {
  event: ScheduledEvent;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EditDraft>({
    name:           event.name,
    cronExpression: event.cronExpression,
    timezone:       event.timezone,
    eventType:      event.eventType,
    description:    event.description ?? '',
    payload:        payloadFromEvent(event),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof EditDraft>(key: K, val: EditDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  async function handleSave() {
    if (!draft.name.trim()) { setError('Name is required'); return; }
    if (!draft.cronExpression.trim()) { setError('Cron expression is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name:           draft.name.trim(),
        cronExpression: draft.cronExpression.trim(),
        timezone:       draft.timezone,
        eventType:      draft.eventType,
        description:    draft.description.trim() || null,
        payload:        buildPayload(draft.eventType, draft.payload),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-700 space-y-4">
      {error && (
        <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/50 rounded px-3 py-2">{error}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>Name</label>
          <input type="text" className={INPUT_CLS} value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </div>

        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>Event Type</label>
          <select
            className={SELECT_CLS}
            value={draft.eventType}
            onChange={(e) => {
              set('eventType', e.target.value);
              set('payload', EMPTY_PAYLOAD);
            }}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{EVENT_TYPE_LABELS[t]?.label ?? t}</option>
            ))}
          </select>
        </div>

        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>Cron Expression</label>
          <input
            type="text"
            className={`${INPUT_CLS} font-mono`}
            value={draft.cronExpression}
            onChange={(e) => set('cronExpression', e.target.value)}
            placeholder="0 17 * * 5"
          />
        </div>

        <div className={FIELD_CLS}>
          <label className={LABEL_CLS}>Timezone</label>
          <select className={SELECT_CLS} value={draft.timezone} onChange={(e) => set('timezone', e.target.value)}>
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
      </div>

      <CronHelper
        value={draft.cronExpression}
        timezone={draft.timezone}
        onChange={(v) => set('cronExpression', v)}
      />

      <div className={FIELD_CLS}>
        <label className={LABEL_CLS}>Description (optional)</label>
        <input
          type="text"
          className={INPUT_CLS}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Short description..."
        />
      </div>

      <PayloadFields
        eventType={draft.eventType}
        payload={draft.payload}
        onChange={(p) => set('payload', p)}
      />

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded px-4 py-1.5 text-sm font-medium bg-amber-700 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded px-4 py-1.5 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form (inline panel at top)
// ---------------------------------------------------------------------------

function CreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CreateDraft>({
    name:           '',
    threadId:       'discord:',
    cronExpression: '',
    eventType:      'custom_message',
    timezone:       'Europe/Stockholm',
    description:    '',
    guildName:      '',
    channelName:    '',
    payload:        EMPTY_PAYLOAD,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof CreateDraft>(key: K, val: CreateDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  async function handleSubmit() {
    if (!draft.name.trim())           { setError('Name is required'); return; }
    if (!draft.threadId.trim())       { setError('Thread ID is required'); return; }
    if (!draft.cronExpression.trim()) { setError('Cron expression is required'); return; }
    if (!draft.eventType)             { setError('Event type is required'); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:           draft.name.trim(),
          threadId:       draft.threadId.trim(),
          cronExpression: draft.cronExpression.trim(),
          eventType:      draft.eventType,
          timezone:       draft.timezone,
          description:    draft.description.trim() || undefined,
          guildName:      draft.guildName.trim() || undefined,
          channelName:    draft.channelName.trim() || undefined,
          payload:        buildPayload(draft.eventType, draft.payload),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Failed to create event');
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-amber-700/40 bg-gray-900 p-5">
      <h3 className="text-sm font-semibold text-gray-100 mb-4">New Scheduled Event</h3>

      {error && (
        <p className="mb-3 text-xs text-red-400 bg-red-900/20 border border-red-900/50 rounded px-3 py-2">{error}</p>
      )}

      <div className="space-y-4">
        {/* Core fields */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Name *</label>
            <input
              type="text"
              className={INPUT_CLS}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Friday tribute reminder"
            />
          </div>

          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Event Type *</label>
            <select
              className={SELECT_CLS}
              value={draft.eventType}
              onChange={(e) => {
                set('eventType', e.target.value);
                set('payload', EMPTY_PAYLOAD);
              }}
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{EVENT_TYPE_LABELS[t]?.label ?? t}</option>
              ))}
            </select>
          </div>

          <div className={`${FIELD_CLS} sm:col-span-2`}>
            <label className={LABEL_CLS}>
              Thread ID *
              <span className="ml-1 font-normal text-gray-500">— format: discord:guildId:channelId</span>
            </label>
            <input
              type="text"
              className={`${INPUT_CLS} font-mono`}
              value={draft.threadId}
              onChange={(e) => set('threadId', e.target.value)}
              placeholder="discord:123456789:987654321"
            />
          </div>

          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Cron Expression *</label>
            <input
              type="text"
              className={`${INPUT_CLS} font-mono`}
              value={draft.cronExpression}
              onChange={(e) => set('cronExpression', e.target.value)}
              placeholder="0 17 * * 5"
            />
          </div>

          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Timezone</label>
            <select
              className={SELECT_CLS}
              value={draft.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>

        <CronHelper
          value={draft.cronExpression}
          timezone={draft.timezone}
          onChange={(v) => set('cronExpression', v)}
        />

        {/* Optional metadata */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Description (optional)</label>
            <input
              type="text"
              className={INPUT_CLS}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Short description..."
            />
          </div>
          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Guild Name (optional)</label>
            <input
              type="text"
              className={INPUT_CLS}
              value={draft.guildName}
              onChange={(e) => set('guildName', e.target.value)}
              placeholder="Tiki Room Stockholm"
            />
          </div>
          <div className={FIELD_CLS}>
            <label className={LABEL_CLS}>Channel Name (optional)</label>
            <input
              type="text"
              className={INPUT_CLS}
              value={draft.channelName}
              onChange={(e) => set('channelName', e.target.value)}
              placeholder="general"
            />
          </div>
        </div>

        {/* Payload */}
        <PayloadFields
          eventType={draft.eventType}
          payload={draft.payload}
          onChange={(p) => set('payload', p)}
        />

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded px-4 py-1.5 text-sm font-medium bg-amber-700 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Event'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded px-4 py-1.5 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event row — read view + edit mode
// ---------------------------------------------------------------------------

function EventRow({
  event,
  onRefresh,
}: {
  event: ScheduledEvent;
  onRefresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'collapsed' | 'details' | 'edit'>('collapsed');
  const [toggling, setToggling]   = useState(false);
  const [deleting, setDeleting]   = useState(false);

  const typeInfo = EVENT_TYPE_LABELS[event.eventType] ?? {
    label: event.eventType,
    color: 'bg-gray-800 text-gray-400 border-gray-700',
  };

  async function toggleActive() {
    setToggling(true);
    try {
      const res = await fetch('/api/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: event.id, isActive: !event.isActive }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      await onRefresh();
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${event.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/events?id=${event.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      await onRefresh();
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave(updates: Record<string, unknown>) {
    const res = await fetch('/api/admin/events', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: event.id, ...updates }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? 'Save failed');
    }
    await onRefresh();
    setMode('collapsed');
  }

  return (
    <div
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

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
            <span className="font-mono">{event.cronExpression}</span>
            <span>{describeCron(event.cronExpression, event.timezone)}</span>
            {event.lastRunAt ? (
              <span className={event.lastRunStatus === 'failed' ? 'text-red-400' : 'text-gray-500'}>
                Last run: {timeAgo(event.lastRunAt)}
              </span>
            ) : (
              <span className="text-gray-600 italic">Never run</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setMode(mode === 'details' ? 'collapsed' : 'details')}
            className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            {mode === 'details' ? 'Hide' : 'Details'}
          </button>
          <button
            onClick={() => setMode(mode === 'edit' ? 'collapsed' : 'edit')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'edit'
                ? 'bg-amber-800 text-amber-200'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            Edit
          </button>
          <button
            onClick={toggleActive}
            disabled={toggling}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              event.isActive
                ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                : 'bg-green-800 hover:bg-green-700 text-green-200'
            }`}
          >
            {toggling ? '...' : event.isActive ? 'Pause' : 'Resume'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded px-3 py-1 text-xs font-medium bg-red-900/60 hover:bg-red-800 text-red-300 transition-colors disabled:opacity-50"
          >
            {deleting ? '...' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Details panel */}
      {mode === 'details' && (
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

          {Object.keys(event.payload).length > 0 && (
            <div>
              <span className="text-gray-500 block mb-1">Payload</span>
              <pre className="rounded bg-gray-800 p-2 text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
          )}

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

      {/* Inline edit form */}
      {mode === 'edit' && (
        <EditForm
          event={event}
          onSave={handleSave}
          onCancel={() => setMode('collapsed')}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EventsPage() {
  const [events, setEvents]       = useState<ScheduledEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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

  // Group events by channel thread ID
  const grouped = events.reduce<Record<string, ScheduledEvent[]>>((acc, event) => {
    (acc[event.threadId] ??= []).push(event);
    return acc;
  }, {});

  const activeCount = events.filter((e) => e.isActive).length;
  const failedCount = events.filter((e) => e.lastRunStatus === 'failed').length;

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Scheduled Events</h2>
          <p className="mt-1 text-sm text-gray-500">
            Cron-based events across all channels. Manage reminders, auto-messages, and AI prompts.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className={`shrink-0 rounded px-4 py-2 text-sm font-medium transition-colors ${
            showCreate
              ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              : 'bg-amber-700 hover:bg-amber-600 text-white'
          }`}
        >
          {showCreate ? 'Cancel' : '+ New Event'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateForm
          onCreated={async () => { await fetchEvents(); setShowCreate(false); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

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
      {loading && <div className="text-sm text-gray-500">Loading events...</div>}

      {/* Empty */}
      {!loading && events.length === 0 && !showCreate && (
        <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
          <p className="text-sm font-medium text-gray-400">No scheduled events</p>
          <p className="mt-1 text-xs text-gray-600">
            Create your first event using the &ldquo;+ New Event&rdquo; button above.
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
              <h3 className="text-sm font-semibold text-gray-200">{channelDisplay(sample)}</h3>
              <span className="text-xs text-gray-500">{guildDisplay(sample)}</span>
              <span className="text-xs text-gray-600 font-mono">{threadId}</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-gray-500">
                  {channelEvents.length} event{channelEvents.length !== 1 ? 's' : ''}
                </span>
                {channelActive > 0 && <span className="text-xs text-green-500">{channelActive} active</span>}
                {channelFailed > 0 && <span className="text-xs text-red-400">{channelFailed} failed</span>}
              </div>
            </div>

            <div className="space-y-2">
              {channelEvents.map((event) => (
                <EventRow key={event.id} event={event} onRefresh={fetchEvents} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
