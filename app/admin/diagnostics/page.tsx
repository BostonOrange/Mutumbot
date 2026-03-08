'use client';

// Usage: /admin/diagnostics
// Run system health checks and test AI agents with configurable prompts.
// Results displayed as a copyable log.

import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  model: string;
  isDefault?: boolean;
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  inputModalities: string[];
  maxInputTokens: number;
  maxOutputTokens: number;
  inputPricePerM: number;
  outputPricePerM: number;
  tier: string;
  speed: string;
  nativeTools: string[];
  notes?: string;
}

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  details: string[];
}

interface DiagnosticsResponse {
  results: TestResult[];
  timestamp: string;
}

// ─── Test definitions ─────────────────────────────────────────────────────────

const SYSTEM_TESTS = [
  { id: 'database', label: 'Database Connection', description: 'Check Postgres connectivity and tables' },
  { id: 'discord', label: 'Discord API', description: 'Validate bot token and guild access' },
  { id: 'openrouter', label: 'OpenRouter API', description: 'Verify AI model is reachable' },
];

const AGENT_TESTS = [
  { id: 'agent_resolution', label: 'Agent Resolution', description: 'Resolve agent config, prompt, capabilities, tools' },
  { id: 'basic_response', label: 'Basic AI Response', description: 'Send a test prompt and get a response' },
  { id: 'tool_calling', label: 'Tool Calling', description: 'Verify the agent can invoke tools' },
  { id: 'knowledge', label: 'Knowledge Storage', description: 'Write and read back a test fact' },
  { id: 'message_ingestion', label: 'Message Ingestion', description: 'Check message pipeline stats' },
];

// ─── Shared styles ────────────────────────────────────────────────────────────

const SELECT_CLASS =
  'rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors cursor-pointer';

const INPUT_CLASS =
  'w-full rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors';

const BTN_PRIMARY =
  'rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors whitespace-nowrap';

const BTN_SECONDARY =
  'rounded-md border border-gray-700 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 transition-colors whitespace-nowrap';

// ─── Log formatting ──────────────────────────────────────────────────────────

function formatStatusIcon(status: string): string {
  if (status === 'pass') return '\u2713';
  if (status === 'fail') return '\u2717';
  return '\u2014';
}

function formatLogEntry(result: TestResult): string {
  const icon = result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'SKIP';
  const lines = [`[${icon}] ${result.name} (${result.durationMs}ms)`];
  for (const detail of result.details) {
    if (detail === '') {
      lines.push('');
    } else {
      lines.push(`  ${result.status === 'pass' ? '\u2713' : result.status === 'fail' ? '\u2717' : '\u2014'} ${detail}`);
    }
  }
  return lines.join('\n');
}

function formatFullLog(results: TestResult[], timestamp: string): string {
  const header = `Mutumbot Diagnostics — ${new Date(timestamp).toLocaleString()}\n${'='.repeat(60)}`;
  const entries = results.map(formatLogEntry).join('\n\n');
  const summary = results.reduce(
    (acc, r) => {
      acc[r.status]++;
      return acc;
    },
    { pass: 0, fail: 0, skip: 0 }
  );
  const footer = `\n${'='.repeat(60)}\nSummary: ${summary.pass} passed, ${summary.fail} failed, ${summary.skip} skipped`;
  return `${header}\n\n${entries}\n${footer}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DiagnosticsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [logText, setLogText] = useState('');
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const [models, setModels] = useState<ModelInfo[]>([]);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(Array.isArray(data) ? data : []);
        // Select default agent initially
        const defaultAgent = data.find((a: Agent) => a.isDefault);
        if (defaultAgent) setSelectedAgentId(defaultAgent.id);
      }
    } catch {
      // silently fail
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/models');
      if (res.ok) setModels(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAgents();
    fetchModels();
  }, [fetchAgents, fetchModels]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const selectedModel = selectedAgent ? models.find((m) => m.id === selectedAgent.model) : undefined;

  async function runTests(testIds: string[]) {
    setRunning(true);
    setResults([]);
    setLogText('Running tests...\n');
    setCopied(false);

    try {
      const res = await fetch('/api/admin/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgentId || undefined,
          tests: testIds,
          customPrompt: customPrompt.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLogText(`Error: ${data.error ?? `Request failed (${res.status})`}`);
        return;
      }

      const data: DiagnosticsResponse = await res.json();
      setResults(data.results);
      setLogText(formatFullLog(data.results, data.timestamp));
    } catch (err) {
      setLogText(`Error: ${err instanceof Error ? err.message : 'Request failed'}`);
    } finally {
      setRunning(false);
    }
  }

  function runAllSystemTests() {
    runTests(SYSTEM_TESTS.map((t) => t.id));
  }

  function runAllAgentTests() {
    if (!selectedAgentId) return;
    const ids = AGENT_TESTS.map((t) => t.id);
    if (customPrompt.trim()) ids.push('custom_prompt');
    runTests(ids);
  }

  function runFullSuite() {
    const ids = [
      ...SYSTEM_TESTS.map((t) => t.id),
      ...AGENT_TESTS.map((t) => t.id),
    ];
    if (customPrompt.trim()) ids.push('custom_prompt');
    runTests(ids);
  }

  function runSingleTest(testId: string) {
    runTests([testId]);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select all text in the log
      if (logRef.current) {
        const range = document.createRange();
        range.selectNodeContents(logRef.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-100">Diagnostics</h2>
        <p className="mt-1 text-sm text-gray-500">
          Run system health checks and test AI agents. Results appear in a copyable log below.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── System Tests ── */}
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-200">System Checks</h3>
            <button
              type="button"
              onClick={runAllSystemTests}
              disabled={running}
              className={BTN_SECONDARY}
            >
              {running ? 'Running...' : 'Run All'}
            </button>
          </div>
          <div className="space-y-2">
            {SYSTEM_TESTS.map((test) => {
              const result = results.find((r) => r.name.toLowerCase().includes(test.id.replace('_', ' ')));
              return (
                <div key={test.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-300">{test.label}</p>
                    <p className="text-xs text-gray-600">{test.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => runSingleTest(test.id)}
                    disabled={running}
                    className="shrink-0 rounded px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-100 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 transition-colors"
                  >
                    Run
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Agent Tests ── */}
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-200">Agent Tests</h3>
            <button
              type="button"
              onClick={runAllAgentTests}
              disabled={running || !selectedAgentId}
              className={BTN_SECONDARY}
            >
              {running ? 'Running...' : 'Run All'}
            </button>
          </div>

          {/* Agent selector */}
          <div className="mb-4">
            <label htmlFor="diag-agent" className="block text-xs font-medium text-gray-400 mb-1.5">
              Test Agent
            </label>
            <select
              id="diag-agent"
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              disabled={running}
              className={SELECT_CLASS + ' w-full'}
            >
              <option value="">Select an agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Selected model info */}
          {selectedModel && (
            <div className="mb-4 rounded-md border border-gray-700 bg-gray-800/60 p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-gray-200 font-medium">{selectedModel.name}</span>
                <span className="text-gray-500">{selectedModel.provider}</span>
              </div>
              <p className="text-gray-400">{selectedModel.description}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-gray-400">
                <span>In: ${selectedModel.inputPricePerM.toFixed(2)}/M</span>
                <span>Out: ${selectedModel.outputPricePerM.toFixed(2)}/M</span>
                <span>Context: {selectedModel.maxInputTokens >= 1_000_000 ? `${selectedModel.maxInputTokens / 1_000_000}M` : `${selectedModel.maxInputTokens / 1_000}K`}</span>
                <span>Max out: {selectedModel.maxOutputTokens >= 1_000_000 ? `${selectedModel.maxOutputTokens / 1_000_000}M` : `${Math.round(selectedModel.maxOutputTokens / 1_000)}K`}</span>
                <span>Speed: {selectedModel.speed}</span>
              </div>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {selectedModel.inputModalities.map((m: string) => (
                  <span key={m} className="rounded-full bg-blue-900/40 border border-blue-700/40 px-1.5 py-0.5 text-blue-300">{m}</span>
                ))}
                {selectedModel.nativeTools.map((t: string) => (
                  <span key={t} className="rounded-full bg-green-900/40 border border-green-700/40 px-1.5 py-0.5 text-green-300">{t.replace('_', ' ')}</span>
                ))}
              </div>
            </div>
          )}
          {selectedAgent && !selectedModel && (
            <div className="mb-4 rounded-md border border-gray-700 bg-gray-800/60 p-2 text-xs text-gray-500">
              Model: <code className="text-gray-400">{selectedAgent.model}</code> (not in registry)
            </div>
          )}

          {/* Custom prompt */}
          <div className="mb-4">
            <label htmlFor="diag-prompt" className="block text-xs font-medium text-gray-400 mb-1.5">
              Custom Test Prompt <span className="text-gray-600">(optional)</span>
            </label>
            <input
              id="diag-prompt"
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder='e.g. "Tell me about rum" or "What is a black hole?"'
              disabled={running}
              className={INPUT_CLASS}
            />
          </div>

          <div className="space-y-2">
            {AGENT_TESTS.map((test) => (
              <div key={test.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-300">{test.label}</p>
                  <p className="text-xs text-gray-600">{test.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => runSingleTest(test.id)}
                  disabled={running || (!selectedAgentId && test.id !== 'message_ingestion')}
                  className="shrink-0 rounded px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-100 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 transition-colors"
                >
                  Run
                </button>
              </div>
            ))}
            {customPrompt.trim() && (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-300">Custom Prompt</p>
                  <p className="text-xs text-gray-600 truncate">&quot;{customPrompt.trim()}&quot;</p>
                </div>
                <button
                  type="button"
                  onClick={() => runSingleTest('custom_prompt')}
                  disabled={running || !selectedAgentId}
                  className="shrink-0 rounded px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-100 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-40 transition-colors"
                >
                  Run
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Full Suite Button ── */}
      <div className="mb-6">
        <button
          type="button"
          onClick={runFullSuite}
          disabled={running}
          className={BTN_PRIMARY + ' w-full py-3 text-base'}
        >
          {running ? 'Running Tests...' : 'Run Full Test Suite'}
        </button>
      </div>

      {/* ── Log Output ── */}
      {logText && (
        <section className="rounded-lg border border-gray-800 bg-gray-900">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-300">Test Output</h3>
            <button
              type="button"
              onClick={handleCopy}
              className={BTN_SECONDARY + ' text-xs py-1.5 px-3'}
            >
              {copied ? 'Copied!' : 'Copy Log'}
            </button>
          </div>
          <pre
            ref={logRef}
            className="px-5 py-4 text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-[600px] overflow-y-auto leading-relaxed select-all"
          >
            {logText}
          </pre>
        </section>
      )}
    </div>
  );
}
