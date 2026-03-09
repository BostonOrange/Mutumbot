'use client';

import { useState, useCallback, useEffect } from 'react';
import PlaygroundChat from '../components/PlaygroundChat';
import PlaygroundSidebar from '../components/PlaygroundSidebar';

function generateSessionId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function PlaygroundPage() {
  const [agentId, setAgentId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [sessionId, setSessionId] = useState('');
  // Incrementing key forces PlaygroundChat to remount on session reset
  const [chatKey, setChatKey] = useState(0);

  // Generate session ID on client only to avoid hydration mismatch
  useEffect(() => {
    setSessionId(generateSessionId());
  }, []);

  const handleNewSession = useCallback(async () => {
    // Best-effort cleanup of the current session's side effects
    try {
      await fetch('/api/admin/playground/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch { /* best effort */ }

    setSessionId(generateSessionId());
    setChatKey((k) => k + 1);
  }, [sessionId]);

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-8">
      <PlaygroundSidebar
        agentId={agentId}
        workflowId={workflowId}
        sessionId={sessionId}
        onAgentChange={setAgentId}
        onWorkflowChange={setWorkflowId}
        onNewSession={handleNewSession}
      />
      <div className="flex-1 flex flex-col bg-gray-950 min-w-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-lg font-bold text-gray-100">Playground</h2>
          <p className="text-xs text-gray-500">
            Chat with any agent using the full AI pipeline.
          </p>
        </div>
        {/* Chat area */}
        <div className="flex-1 min-h-0">
          <PlaygroundChat
            key={chatKey}
            agentId={agentId}
            workflowId={workflowId}
            sessionId={sessionId}
          />
        </div>
      </div>
    </div>
  );
}
