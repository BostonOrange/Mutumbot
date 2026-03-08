'use client';

// Usage:
//   <PlaygroundChat agentId="abc" workflowId="xyz" sessionId="sess-1" />
//
// Consumes an SSE stream from POST /api/admin/playground/chat.
// Events:
//   event: token  data: { text: string }          — append to streaming bubble
//   event: done   data: { content: string, runId } — finalise message
//   event: error  data: { error: string }          — surface error in bubble

import { useState, useRef, useEffect, useCallback, KeyboardEvent, ChangeEvent } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaygroundChatProps {
  agentId: string;
  workflowId: string;
  sessionId: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ─── Shared style tokens (mirrors diagnostics page) ──────────────────────────

const INPUT_CLASS =
  'w-full resize-none rounded-md bg-gray-800 border border-gray-700 text-gray-100 px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors leading-relaxed overflow-hidden';

const BTN_SEND =
  'shrink-0 rounded-md bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors self-end';

const TEXTAREA_MIN_HEIGHT = 40; // px — single row
const TEXTAREA_MAX_HEIGHT = 150; // px

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlaygroundChat({ agentId, workflowId, sessionId }: PlaygroundChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Auto-scroll to bottom whenever messages or streaming text change ────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setStreaming(true);
    setStreamingText('');

    // Reset textarea height after clearing input
    if (textareaRef.current) {
      textareaRef.current.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/admin/playground/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ agentId, workflowId, sessionId, message: text }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let eventType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (!raw) continue;

            const data = JSON.parse(raw);

            if (eventType === 'token') {
              accumulated += data.text;
              setStreamingText(accumulated);
            } else if (eventType === 'error') {
              throw new Error(data.error);
            } else if (eventType === 'done') {
              // Backend sends the canonical full content on done
              accumulated = data.content ?? accumulated;
            }
          } else if (line === '') {
            // Blank line resets event type per SSE spec
            eventType = '';
          }
        }
      }

      // Commit the streamed response as a proper message
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: accumulated,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }
  }, [input, streaming, agentId, workflowId, sessionId]);

  // ── Keyboard handler: Enter sends, Shift+Enter inserts newline ─────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
    },
    [],
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Messages ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-600">Send a message to start chatting with the agent.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[75%] space-y-1 ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div
                className={
                  msg.role === 'user'
                    ? 'rounded-2xl rounded-tr-sm px-4 py-2.5 bg-amber-600/20 border border-amber-500/30 text-gray-100 text-sm whitespace-pre-wrap break-words'
                    : 'rounded-2xl rounded-tl-sm px-4 py-2.5 bg-gray-800 border border-gray-700 text-gray-200 text-sm whitespace-pre-wrap break-words'
                }
              >
                {msg.content}
              </div>
              <span className="text-xs text-gray-600 px-1">{formatTimestamp(msg.timestamp)}</span>
            </div>
          </div>
        ))}

        {/* ── Streaming bubble ──────────────────────────────────────────────── */}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[75%] space-y-1 flex flex-col items-start">
              <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-gray-800 border border-gray-700 text-gray-200 text-sm whitespace-pre-wrap break-words">
                {streamingText || (
                  <span className="flex items-center gap-1.5">
                    <span className="animate-pulse text-gray-500">Thinking</span>
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ────────────────────────────────────────────────────── */}
      <div className="border-t border-gray-800 px-4 py-3 flex flex-row gap-3 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
          rows={1}
          aria-label="Chat input"
          className={INPUT_CLASS}
          style={{ minHeight: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT }}
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={streaming || !input.trim()}
          aria-label="Send message"
          className={BTN_SEND}
        >
          Send
        </button>
      </div>
    </div>
  );
}
