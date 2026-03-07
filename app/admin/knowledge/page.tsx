'use client';

// Usage: /admin/knowledge
// Browse and delete facts stored in the agent_knowledge table.
// Requires selecting an agent first (agentId is mandatory for the API).

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
}

interface AgentFact {
  id: string;
  agentId: string;
  fact: string;
  category: string | null;
  subject: string | null;
  sourceThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const FACT_PREVIEW_LENGTH = 100;

// ─── Shared style tokens ──────────────────────────────────────────────────────

const INPUT_CLASS =
  'rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors';

const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer`;

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

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      sp.set(key, String(value));
    }
  }
  return sp.toString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LoadingRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="border-b border-gray-800 last:border-0 animate-pulse">
          <td className="py-3 px-4"><div className="h-3 w-24 rounded bg-gray-700" /></td>
          <td className="py-3 px-4"><div className="h-3 w-20 rounded bg-gray-700" /></td>
          <td className="py-3 px-4"><div className="h-3 w-64 rounded bg-gray-700" /></td>
          <td className="py-3 px-4"><div className="h-3 w-16 rounded bg-gray-700" /></td>
          <td className="py-3 px-4"><div className="h-6 w-14 rounded bg-gray-700" /></td>
        </tr>
      ))}
    </>
  );
}

function ExpandableFact({ fact }: { fact: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = fact.length > FACT_PREVIEW_LENGTH;
  const preview = isLong && !expanded ? `${fact.slice(0, FACT_PREVIEW_LENGTH)}…` : fact;

  return (
    <span>
      <span className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {preview}
      </span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-2 text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors whitespace-nowrap"
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </span>
  );
}

function FactRow({
  fact,
  onDelete,
}: {
  fact: AgentFact;
  onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const confirmed = window.confirm(
      'Delete this fact? This action cannot be undone.\n\n' +
        (fact.fact.length > 120 ? `${fact.fact.slice(0, 120)}…` : fact.fact),
    );
    if (!confirmed) return;

    setDeleting(true);
    await onDelete(fact.id);
    // No need to setDeleting(false) — row is removed on success, and on error
    // we restore so user can try again.
    setDeleting(false);
  }

  return (
    <tr className="border-b border-gray-800 last:border-0 hover:bg-gray-800/30 transition-colors">
      {/* Subject */}
      <td className="py-3 px-4 align-top w-[14%]">
        {fact.subject ? (
          <span className="text-sm text-gray-200 font-medium">{fact.subject}</span>
        ) : (
          <span className="text-xs text-gray-600 italic">None</span>
        )}
      </td>

      {/* Category */}
      <td className="py-3 px-4 align-top w-[12%]">
        {fact.category ? (
          <span className="inline-block rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
            {fact.category}
          </span>
        ) : (
          <span className="text-xs text-gray-600 italic">None</span>
        )}
      </td>

      {/* Fact text */}
      <td className="py-3 px-4 align-top">
        <ExpandableFact fact={fact.fact} />
      </td>

      {/* Date */}
      <td className="py-3 px-4 align-top whitespace-nowrap w-[9rem]">
        <span className="text-xs text-gray-500">{formatDate(fact.createdAt)}</span>
      </td>

      {/* Delete */}
      <td className="py-3 px-4 align-top w-[5rem]">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md bg-red-800/70 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-semibold text-red-200 border border-red-700/50 hover:border-red-600 transition-colors whitespace-nowrap"
          aria-label={`Delete fact: ${fact.fact.slice(0, 60)}`}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}

// ─── Search bar ───────────────────────────────────────────────────────────────

interface SearchBarProps {
  search: string;
  category: string;
  subject: string;
  onSearchChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onSubjectChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}

function SearchBar({
  search,
  category,
  subject,
  onSearchChange,
  onCategoryChange,
  onSubjectChange,
  onSubmit,
  disabled,
}: SearchBarProps) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') onSubmit();
  }

  return (
    <div
      className="flex flex-wrap gap-3 items-end"
      role="search"
      aria-label="Filter knowledge facts"
    >
      {/* Free text search */}
      <div className="flex-1 min-w-[180px]">
        <label htmlFor="kb-search" className="block text-xs font-medium text-gray-400 mb-1.5">
          Search
        </label>
        <input
          id="kb-search"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search fact text…"
          disabled={disabled}
          className={`${INPUT_CLASS} w-full`}
        />
      </div>

      {/* Category filter */}
      <div className="min-w-[140px]">
        <label htmlFor="kb-category" className="block text-xs font-medium text-gray-400 mb-1.5">
          Category
        </label>
        <input
          id="kb-category"
          type="text"
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. drinks"
          disabled={disabled}
          className={`${INPUT_CLASS} w-full`}
        />
      </div>

      {/* Subject filter */}
      <div className="min-w-[140px]">
        <label htmlFor="kb-subject" className="block text-xs font-medium text-gray-400 mb-1.5">
          Subject
        </label>
        <input
          id="kb-subject"
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. rum"
          disabled={disabled}
          className={`${INPUT_CLASS} w-full`}
        />
      </div>

      {/* Search button */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        className="rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors whitespace-nowrap"
      >
        Search
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  // Agent selection
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  // Filter fields (draft values before search is triggered)
  const [draftSearch, setDraftSearch] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  const [draftSubject, setDraftSubject] = useState('');

  // Committed filter state (what's actually been fetched against)
  const [committedFilters, setCommittedFilters] = useState({
    search: '',
    category: '',
    subject: '',
  });

  // Facts
  const [facts, setFacts] = useState<AgentFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);

  // Track in-flight request to avoid stale responses
  const fetchSeqRef = useRef(0);

  // ── Fetch agents on mount ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      setAgentsLoading(true);
      setAgentsError(null);
      try {
        const res = await fetch('/api/admin/agents');
        if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
        const data: Agent[] = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setAgents(list);
        if (list.length > 0) setSelectedAgentId(list[0].id);
      } catch (err) {
        if (!cancelled) {
          setAgentsError(err instanceof Error ? err.message : 'Failed to load agents.');
        }
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    }

    loadAgents();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch facts whenever agent or committed filters/limit change ───────────

  const fetchFacts = useCallback(
    async (agentId: string, filters: typeof committedFilters, fetchLimit: number) => {
      if (!agentId) return;

      const seq = ++fetchSeqRef.current;
      setFactsLoading(true);
      setFactsError(null);

      try {
        // Fetch one extra to determine if there are more pages
        const qs = buildQueryString({
          agentId,
          search: filters.search || undefined,
          category: filters.category || undefined,
          subject: filters.subject || undefined,
          limit: fetchLimit + 1,
        });

        const res = await fetch(`/api/admin/knowledge?${qs}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }

        const data: AgentFact[] = await res.json();
        if (seq !== fetchSeqRef.current) return; // stale response — discard

        const page = Array.isArray(data) ? data : [];
        setHasMore(page.length > fetchLimit);
        setFacts(page.slice(0, fetchLimit));
      } catch (err) {
        if (seq !== fetchSeqRef.current) return;
        setFactsError(err instanceof Error ? err.message : 'Failed to load facts.');
      } finally {
        if (seq === fetchSeqRef.current) setFactsLoading(false);
      }
    },
    [],
  );

  // Run fetch whenever agent, committed filters, or limit changes
  useEffect(() => {
    if (selectedAgentId) {
      fetchFacts(selectedAgentId, committedFilters, limit);
    }
  }, [selectedAgentId, committedFilters, limit, fetchFacts]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleAgentChange(agentId: string) {
    setSelectedAgentId(agentId);
    setLimit(PAGE_SIZE);
    // Reset draft and committed filters on agent change
    setDraftSearch('');
    setDraftCategory('');
    setDraftSubject('');
    setCommittedFilters({ search: '', category: '', subject: '' });
  }

  function handleSearch() {
    setLimit(PAGE_SIZE);
    setCommittedFilters({
      search: draftSearch.trim(),
      category: draftCategory.trim(),
      subject: draftSubject.trim(),
    });
  }

  function handleLoadMore() {
    setLimit((prev) => prev + PAGE_SIZE);
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/admin/knowledge?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      // Remove from local state immediately — avoids a full refetch
      setFacts((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete fact.');
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  const hasActiveFilters =
    committedFilters.search || committedFilters.category || committedFilters.subject;

  const tableDisabled = factsLoading || !selectedAgentId;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-100">Knowledge Browser</h2>
        <p className="mt-1 text-sm text-gray-500">
          Browse and manage facts stored for each agent. Select an agent, then filter by keyword,
          category, or subject.
        </p>
      </div>

      {/* Agent selector */}
      <section aria-label="Agent selection" className="mb-6">
        <div className="flex items-center gap-4">
          <div className="min-w-[240px]">
            <label htmlFor="kb-agent" className="block text-xs font-medium text-gray-400 mb-1.5">
              Agent <span className="text-red-400">*</span>
            </label>
            {agentsLoading ? (
              <div className="h-9 w-full rounded-md bg-gray-800 animate-pulse" />
            ) : agentsError ? (
              <p className="text-sm text-red-400">{agentsError}</p>
            ) : agents.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No agents found.</p>
            ) : (
              <select
                id="kb-agent"
                value={selectedAgentId}
                onChange={(e) => handleAgentChange(e.target.value)}
                className={`${SELECT_CLASS} w-full`}
                aria-label="Select agent to browse knowledge"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </section>

      {/* Search / filter bar — only shown once an agent is selected */}
      {selectedAgentId && (
        <section aria-label="Search filters" className="mb-6">
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <SearchBar
              search={draftSearch}
              category={draftCategory}
              subject={draftSubject}
              onSearchChange={setDraftSearch}
              onCategoryChange={setDraftCategory}
              onSubjectChange={setDraftSubject}
              onSubmit={handleSearch}
              disabled={factsLoading}
            />
          </div>
        </section>
      )}

      {/* Facts error */}
      {factsError && (
        <div className="mb-6 rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
          {factsError}
        </div>
      )}

      {/* Prompt to select an agent */}
      {!selectedAgentId && !agentsLoading && !agentsError && (
        <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
          <p className="text-sm font-medium text-gray-400">Select an agent to view its facts</p>
          <p className="mt-1 text-xs text-gray-600">
            Choose an agent from the dropdown above to browse its knowledge base.
          </p>
        </div>
      )}

      {/* Results table */}
      {selectedAgentId && (
        <section aria-labelledby="facts-heading">
          {/* Table header row with result context */}
          <div className="flex items-center justify-between mb-3">
            <h3 id="facts-heading" className="text-base font-semibold text-gray-200">
              Facts
              {!factsLoading && facts.length > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  {facts.length}
                  {hasMore && '+'} result{facts.length !== 1 ? 's' : ''}
                  {hasActiveFilters ? ' (filtered)' : ''}
                </span>
              )}
            </h3>
          </div>

          {/* Loading skeleton */}
          {factsLoading && facts.length === 0 ? (
            <div className="rounded-lg border border-gray-800 overflow-x-auto">
              <table className="w-full text-left" aria-label="Loading facts">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-900/60">
                    <ColumnHeaders />
                  </tr>
                </thead>
                <tbody className="bg-gray-900 divide-y divide-gray-800">
                  <LoadingRows count={6} />
                </tbody>
              </table>
            </div>
          ) : facts.length === 0 ? (
            /* Empty state */
            <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
              <p className="text-sm font-medium text-gray-400">No facts found</p>
              <p className="mt-1 text-xs text-gray-600">
                {hasActiveFilters
                  ? 'Try adjusting your filters or clearing the search.'
                  : 'This agent has no stored facts yet.'}
              </p>
            </div>
          ) : (
            /* Facts table */
            <>
              <div className="rounded-lg border border-gray-800 overflow-x-auto">
                <table className="w-full text-left" aria-label="Knowledge facts">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-900/60">
                      <ColumnHeaders />
                    </tr>
                  </thead>
                  <tbody className="bg-gray-900">
                    {facts.map((fact) => (
                      <FactRow key={fact.id} fact={fact} onDelete={handleDelete} />
                    ))}
                    {/* Loading more rows inline */}
                    {factsLoading && <LoadingRows count={3} />}
                  </tbody>
                </table>
              </div>

              {/* Load more */}
              {hasMore && !factsLoading && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    className="rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 px-5 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors"
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Column headers (extracted to avoid duplication in loading + data states) ─

function ColumnHeaders() {
  const cols = ['Subject', 'Category', 'Fact', 'Date', ''];
  return (
    <>
      {cols.map((label, i) => (
        <th
          key={i}
          scope="col"
          className="py-3 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500"
        >
          {label}
        </th>
      ))}
    </>
  );
}
