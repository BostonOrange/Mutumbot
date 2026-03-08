'use client';

// Usage:
//   <PlaygroundSidebar
//     agentId={agentId}
//     workflowId={workflowId}
//     sessionId={sessionId}
//     onAgentChange={setAgentId}
//     onWorkflowChange={setWorkflowId}
//     onNewSession={handleNewSession}
//   />

import { useState, useEffect, useCallback } from 'react';

interface Agent {
  id: string;
  name: string;
  model: string;
  capabilities: string[];
  params: Record<string, unknown>;
  isDefault?: boolean;
}

interface Workflow {
  id: string;
  name: string;
  agentId: string;
  contextPolicy: {
    recentMessages: number;
    maxAgeHours: number;
    useSummary: boolean;
    maxTranscriptChars: number;
    includeTributeContext: boolean;
    customInstructions?: string;
  };
  isDefault?: boolean;
}

export interface PlaygroundSidebarProps {
  agentId: string;
  workflowId: string;
  sessionId: string;
  onAgentChange: (id: string) => void;
  onWorkflowChange: (id: string) => void;
  onNewSession: () => void;
}

const SELECT_CLASS =
  'w-full rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer';

const LABEL_CLASS = 'block text-xs font-medium text-gray-400 mb-1.5';

export default function PlaygroundSidebar({
  agentId,
  workflowId,
  sessionId,
  onAgentChange,
  onWorkflowChange,
  onNewSession,
}: PlaygroundSidebarProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [cleaningUp, setCleaningUp] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/agents');
      if (res.ok) setAgents(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/workflows');
      if (res.ok) setWorkflows(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchEventCount = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      // handleDrinkQuestion generates discord:dm:{sessionId} as the operating thread ID
      const threadId = `discord:dm:${sid}`;
      const res = await fetch(`/api/admin/events?threadId=${encodeURIComponent(threadId)}`);
      if (res.ok) {
        const events: unknown[] = await res.json();
        setEventCount(events.length);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);
  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);
  useEffect(() => { fetchEventCount(sessionId); }, [fetchEventCount, sessionId]);

  // ── Auto-select default agent on mount ────────────────────────────────────

  useEffect(() => {
    if (agentId || agents.length === 0) return;
    const defaultAgent = agents.find((a) => a.isDefault) ?? agents[0];
    if (defaultAgent) onAgentChange(defaultAgent.id);
  }, [agents, agentId, onAgentChange]);

  // ── Auto-select workflow when agent changes ───────────────────────────────

  useEffect(() => {
    if (!agentId || workflows.length === 0) return;
    const agentWorkflows = workflows.filter((w) => w.agentId === agentId);
    if (agentWorkflows.length === 0) return;

    const currentMatchesAgent = agentWorkflows.some((w) => w.id === workflowId);
    if (!currentMatchesAgent) {
      const pick = agentWorkflows.find((w) => w.isDefault) ?? agentWorkflows[0];
      onWorkflowChange(pick.id);
    }
  }, [agentId, workflows, workflowId, onWorkflowChange]);

  // ── Derived selections ─────────────────────────────────────────────────────

  const selectedAgent = agents.find((a) => a.id === agentId);
  const agentWorkflows = workflows.filter((w) => w.agentId === agentId);
  const selectedWorkflow = agentWorkflows.find((w) => w.id === workflowId);

  const threadId = sessionId ? `discord:dm:${sessionId}` : '—';
  const temperature =
    typeof selectedAgent?.params?.temperature === 'number'
      ? selectedAgent.params.temperature.toFixed(1)
      : '—';

  // ── Clean up ───────────────────────────────────────────────────────────────

  async function handleCleanUp() {
    if (!sessionId || cleaningUp) return;
    setCleaningUp(true);
    try {
      await fetch('/api/admin/playground/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      setEventCount(0);
    } catch { /* ignore */ }
    finally { setCleaningUp(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <aside className="w-72 min-h-0 flex-shrink-0 bg-gray-900/50 border-r border-gray-800 flex flex-col p-4 space-y-5 overflow-y-auto">

      {/* Agent selector */}
      <div>
        <label htmlFor="pg-agent" className={LABEL_CLASS}>
          Agent
        </label>
        <select
          id="pg-agent"
          value={agentId}
          onChange={(e) => onAgentChange(e.target.value)}
          className={SELECT_CLASS}
        >
          {agents.length === 0 && (
            <option value="">Loading…</option>
          )}
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{a.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Workflow selector */}
      <div>
        <label htmlFor="pg-workflow" className={LABEL_CLASS}>
          Workflow
        </label>
        <select
          id="pg-workflow"
          value={workflowId}
          onChange={(e) => onWorkflowChange(e.target.value)}
          disabled={agentWorkflows.length === 0}
          className={`${SELECT_CLASS} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {agentWorkflows.length === 0 && (
            <option value="">No workflows for this agent</option>
          )}
          {agentWorkflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}{w.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* New Session button */}
      <button
        type="button"
        onClick={onNewSession}
        className="w-full rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors"
      >
        New Session
      </button>

      {/* Divider */}
      <div className="border-t border-gray-800" />

      {/* Context Inspector */}
      <div>
        <button
          type="button"
          onClick={() => setInspectorOpen((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-medium text-gray-400 hover:text-gray-300 transition-colors"
          aria-expanded={inspectorOpen}
        >
          <span>Context Inspector</span>
          <span aria-hidden="true">{inspectorOpen ? '▲' : '▼'}</span>
        </button>

        {inspectorOpen && (
          <div className="mt-3 space-y-3 text-xs">

            {/* Thread ID */}
            <div>
              <p className="text-gray-500 mb-0.5">Thread ID</p>
              <p className="font-mono text-[10px] break-all text-gray-300">{threadId}</p>
            </div>

            {/* Model + temperature */}
            <div className="flex gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-gray-500 mb-0.5">Model</p>
                <p className="text-gray-300 break-all">{selectedAgent?.model ?? '—'}</p>
              </div>
              <div className="shrink-0">
                <p className="text-gray-500 mb-0.5">Temp</p>
                <p className="text-gray-300">{temperature}</p>
              </div>
            </div>

            {/* Capabilities */}
            {selectedAgent && (
              <div>
                <p className="text-gray-500 mb-1">Capabilities</p>
                {Array.isArray(selectedAgent.capabilities) && selectedAgent.capabilities.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {selectedAgent.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="inline-block rounded-full bg-amber-900/30 border border-amber-700/30 px-2 py-0.5 text-xs text-amber-400"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600 italic">None configured</p>
                )}
              </div>
            )}

            {/* Context policy */}
            {selectedWorkflow && (
              <div>
                <p className="text-gray-500 mb-1">Context Policy</p>
                <div className="space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Messages</span>
                    <span className="text-gray-400">{selectedWorkflow.contextPolicy.recentMessages}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max age</span>
                    <span className="text-gray-400">{selectedWorkflow.contextPolicy.maxAgeHours}h</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Summary</span>
                    <span className={selectedWorkflow.contextPolicy.useSummary ? 'text-amber-400' : 'text-gray-600'}>
                      {selectedWorkflow.contextPolicy.useSummary ? 'on' : 'off'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max chars</span>
                    <span className="text-gray-400">
                      {selectedWorkflow.contextPolicy.maxTranscriptChars.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Scheduled events */}
            <div>
              <div className="flex items-center justify-between">
                <p className="text-gray-500">Scheduled Events</p>
                <span className="text-gray-400">
                  {eventCount === null ? '…' : eventCount}
                </span>
              </div>
              {sessionId && (
                <button
                  type="button"
                  onClick={handleCleanUp}
                  disabled={cleaningUp}
                  className="mt-1 text-amber-500 hover:text-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {cleaningUp ? 'Cleaning…' : 'Clean up'}
                </button>
              )}
            </div>

          </div>
        )}
      </div>
    </aside>
  );
}
