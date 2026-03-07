'use client';

// Usage: /admin/memories
// Browse user memories stored in the user_memories table.
// Supports filtering by user ID. Each card shows a summary preview
// that can be expanded to reveal the full AI-generated text.

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserMemory {
  id: number;
  user_id: string;
  channel_id: string;
  guild_id: string | null;
  summary: string;
  message_count: number;
  last_updated_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUMMARY_PREVIEW_LENGTH = 150;

// ─── Shared style tokens ──────────────────────────────────────────────────────

const INPUT_CLASS =
  'rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingCard() {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-5 animate-pulse">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="space-y-2 flex-1">
          <div className="h-3 w-36 rounded bg-gray-700" />
          <div className="h-3 w-28 rounded bg-gray-700" />
        </div>
        <div className="h-5 w-12 rounded-full bg-gray-700 shrink-0" />
      </div>
      <div className="space-y-2 mt-4">
        <div className="h-3 w-full rounded bg-gray-700" />
        <div className="h-3 w-5/6 rounded bg-gray-700" />
        <div className="h-3 w-3/4 rounded bg-gray-700" />
      </div>
    </div>
  );
}

function MemoryCard({ memory }: { memory: UserMemory }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = memory.summary.length > SUMMARY_PREVIEW_LENGTH;
  const displayedSummary =
    isLong && !expanded ? `${memory.summary.slice(0, SUMMARY_PREVIEW_LENGTH)}…` : memory.summary;

  return (
    <article
      className="rounded-lg border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 transition-colors"
      aria-label={`Memory for user ${memory.user_id}`}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <dl className="space-y-1 min-w-0">
          {/* User ID */}
          <div className="flex items-baseline gap-2">
            <dt className="text-xs font-medium text-gray-500 shrink-0">User</dt>
            <dd
              className="text-sm font-mono text-gray-100 truncate"
              title={memory.user_id}
            >
              {memory.user_id}
            </dd>
          </div>

          {/* Channel ID */}
          <div className="flex items-baseline gap-2">
            <dt className="text-xs font-medium text-gray-500 shrink-0">Channel</dt>
            <dd
              className="text-sm font-mono text-gray-400 truncate"
              title={memory.channel_id}
            >
              {memory.channel_id}
            </dd>
          </div>

          {/* Last updated */}
          <div className="flex items-baseline gap-2">
            <dt className="text-xs font-medium text-gray-500 shrink-0">Updated</dt>
            <dd className="text-xs text-gray-500">{formatDate(memory.last_updated_at)}</dd>
          </div>
        </dl>

        {/* Message count badge */}
        <div
          className="shrink-0 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-semibold text-amber-400 whitespace-nowrap"
          aria-label={`${memory.message_count} messages`}
          title="Message count"
        >
          {memory.message_count} msg{memory.message_count !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Summary */}
      <div className="border-t border-gray-800 pt-4">
        <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Summary</p>
        <p className="font-mono text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
          {displayedSummary}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </article>
  );
}

// ─── Search bar ───────────────────────────────────────────────────────────────

interface SearchBarProps {
  draftUserId: string;
  onDraftChange: (v: string) => void;
  onSearch: () => void;
  onClear: () => void;
  hasActiveFilter: boolean;
  disabled: boolean;
}

function SearchBar({
  draftUserId,
  onDraftChange,
  onSearch,
  onClear,
  hasActiveFilter,
  disabled,
}: SearchBarProps) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') onSearch();
  }

  return (
    <div
      className="rounded-lg border border-gray-800 bg-gray-900 p-4"
      role="search"
      aria-label="Filter user memories"
    >
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <label
            htmlFor="mem-user-id"
            className="block text-xs font-medium text-gray-400 mb-1.5"
          >
            User ID
          </label>
          <input
            id="mem-user-id"
            type="search"
            value={draftUserId}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Filter by Discord user ID…"
            disabled={disabled}
            className={`${INPUT_CLASS} w-full`}
          />
        </div>

        <button
          type="button"
          onClick={onSearch}
          disabled={disabled}
          className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors whitespace-nowrap"
        >
          Search
        </button>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors whitespace-nowrap"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MemoriesPage() {
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft vs committed pattern: input is live, fetch only runs on submit
  const [draftUserId, setDraftUserId] = useState('');
  const [committedUserId, setCommittedUserId] = useState('');

  // Track in-flight requests to discard stale responses
  const fetchSeqRef = useRef(0);

  const fetchMemories = useCallback(async (userId: string) => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const url = userId
        ? `/api/admin/memories?userId=${encodeURIComponent(userId)}`
        : '/api/admin/memories';

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const data: UserMemory[] = await res.json();
      if (seq !== fetchSeqRef.current) return;

      setMemories(Array.isArray(data) ? data : []);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load memories.');
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, []);

  // Initial load — show all memories
  useEffect(() => {
    fetchMemories('');
  }, [fetchMemories]);

  function handleSearch() {
    const trimmed = draftUserId.trim();
    setCommittedUserId(trimmed);
    fetchMemories(trimmed);
  }

  function handleClear() {
    setDraftUserId('');
    setCommittedUserId('');
    fetchMemories('');
  }

  const hasActiveFilter = committedUserId !== '';

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-100">User Memories</h2>
        <p className="mt-1 text-sm text-gray-500">
          AI-generated memory summaries built from past conversations. Filter by user ID to see
          memories for a specific user.
        </p>
      </div>

      {/* Search bar */}
      <section aria-label="Search filters" className="mb-6">
        <SearchBar
          draftUserId={draftUserId}
          onDraftChange={setDraftUserId}
          onSearch={handleSearch}
          onClear={handleClear}
          hasActiveFilter={hasActiveFilter}
          disabled={loading}
        />
      </section>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Results section */}
      <section aria-labelledby="memories-heading">
        <div className="flex items-center justify-between mb-4">
          <h3 id="memories-heading" className="text-base font-semibold text-gray-200">
            Memories
            {!loading && memories.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                {memories.length} result{memories.length !== 1 ? 's' : ''}
                {hasActiveFilter ? ' (filtered)' : ''}
              </span>
            )}
          </h3>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <LoadingCard key={i} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && memories.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
            <p className="text-sm font-medium text-gray-400">No memories found</p>
            <p className="mt-1 text-xs text-gray-600">
              {hasActiveFilter
                ? 'No memories match that user ID. Try a different ID or clear the filter.'
                : 'No user memories have been stored yet.'}
            </p>
          </div>
        )}

        {/* Memory cards */}
        {!loading && memories.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {memories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
