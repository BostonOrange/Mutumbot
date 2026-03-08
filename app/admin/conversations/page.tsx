'use client';

// Usage: /admin/conversations
// Browse conversation history and memory for each channel/thread.
// Shows rolling summaries and recent messages from the thread_items table.

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelInfo {
  thread_id: string;
  guild_name: string | null;
  channel_name: string | null;
  dm_username: string | null;
  summary: string | null;
  summary_updated_at: string | null;
  item_count: number;
  updated_at: string | null;
}

interface ThreadItem {
  id: string;
  type: string;
  role: string;
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
}

interface ThreadDetail {
  items: ThreadItem[];
  summary: string | null;
  summaryUpdatedAt: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function channelDisplayName(ch: ChannelInfo): string {
  const isDm = ch.thread_id.includes(':dm:');
  if (isDm) return `DM: ${ch.dm_username ?? ch.thread_id.split(':')[2]}`;
  if (ch.channel_name) return `#${ch.channel_name}`;
  return ch.thread_id.split(':')[2] ?? ch.thread_id;
}

// ─── Channel list card ───────────────────────────────────────────────────────

function ChannelCard({
  channel,
  isSelected,
  onClick,
}: {
  channel: ChannelInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-4 transition-colors ${
        isSelected
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">
            {channelDisplayName(channel)}
          </p>
          {channel.guild_name && (
            <p className="text-xs text-gray-500 mt-0.5">{channel.guild_name}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {channel.item_count}
        </span>
      </div>
      {channel.updated_at && (
        <p className="text-xs text-gray-600 mt-1">Active {formatRelativeTime(channel.updated_at)}</p>
      )}
      {channel.summary && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2">{channel.summary}</p>
      )}
    </button>
  );
}

// ─── Conversation detail panel ───────────────────────────────────────────────

function ConversationDetail({
  channel,
  detail,
  loading,
}: {
  channel: ChannelInfo;
  detail: ThreadDetail | null;
  loading: boolean;
}) {
  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-100">
          {channelDisplayName(channel)}
        </h3>
        {channel.guild_name && (
          <p className="text-sm text-gray-500">{channel.guild_name}</p>
        )}
        <p className="text-xs text-gray-600 font-mono mt-1">{channel.thread_id}</p>
      </div>

      {loading && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-10 text-center">
          <p className="text-sm text-gray-500">Loading conversation...</p>
        </div>
      )}

      {!loading && detail && (
        <div className="space-y-6">
          {/* Summary */}
          {detail.summary && (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-300">Rolling Summary</h4>
                {detail.summaryUpdatedAt && (
                  <span className="text-xs text-gray-600">
                    Updated {formatRelativeTime(detail.summaryUpdatedAt)}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 whitespace-pre-wrap leading-relaxed">
                {detail.summary}
              </p>
            </div>
          )}

          {/* Messages */}
          <div className="rounded-lg border border-gray-800 bg-gray-900">
            <div className="px-5 py-3 border-b border-gray-800">
              <h4 className="text-sm font-semibold text-gray-300">
                Recent Messages
                <span className="ml-2 text-xs font-normal text-gray-600">
                  {detail.items.length} shown (newest first)
                </span>
              </h4>
            </div>

            {detail.items.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-gray-500">No messages stored yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800/50 max-h-[600px] overflow-y-auto">
                {detail.items.map((item) => (
                  <div key={item.id} className="px-5 py-3">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span
                        className={`text-sm font-medium ${
                          item.role === 'assistant' ? 'text-amber-400' : 'text-blue-400'
                        }`}
                      >
                        {item.author_name ?? (item.role === 'assistant' ? 'Bot' : 'User')}
                      </span>
                      <span className="text-xs text-gray-600">
                        {formatTimestamp(item.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
                      {item.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConversationsPage() {
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/channels');
      if (!res.ok) throw new Error('Failed to load channels');
      const data = await res.json();
      setChannels(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  async function selectChannel(threadId: string) {
    setSelectedThreadId(threadId);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/admin/channels/${encodeURIComponent(threadId)}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
      }
    } catch {
      // silently fail
    } finally {
      setDetailLoading(false);
    }
  }

  const selectedChannel = channels.find((c) => c.thread_id === selectedThreadId);

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-100">Conversations</h2>
        <p className="mt-1 text-sm text-gray-500">
          Browse conversation history and memory for each channel. Select a channel to view its
          rolling summary and recent messages.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-10 text-center">
          <p className="text-sm text-gray-500">Loading channels...</p>
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Channel list */}
          <div className="w-72 shrink-0 max-h-[calc(100vh-200px)] overflow-y-auto">
            {channels.length === 0 ? (
              <p className="text-sm text-gray-500 p-4">No channels found.</p>
            ) : (
              <>
                {channels.some((c) => !c.thread_id.includes(':dm:')) && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-1 mb-2">
                      Server Channels
                    </p>
                    <div className="space-y-2">
                      {channels
                        .filter((c) => !c.thread_id.includes(':dm:'))
                        .map((ch) => (
                          <ChannelCard
                            key={ch.thread_id}
                            channel={ch}
                            isSelected={ch.thread_id === selectedThreadId}
                            onClick={() => selectChannel(ch.thread_id)}
                          />
                        ))}
                    </div>
                  </div>
                )}
                {channels.some((c) => c.thread_id.includes(':dm:')) && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 px-1 mb-2">
                      Direct Messages
                    </p>
                    <div className="space-y-2">
                      {channels
                        .filter((c) => c.thread_id.includes(':dm:'))
                        .map((ch) => (
                          <ChannelCard
                            key={ch.thread_id}
                            channel={ch}
                            isSelected={ch.thread_id === selectedThreadId}
                            onClick={() => selectChannel(ch.thread_id)}
                          />
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1 min-w-0">
            {!selectedChannel ? (
              <div className="rounded-lg border border-dashed border-gray-700 px-8 py-16 text-center">
                <p className="text-sm font-medium text-gray-400">Select a channel</p>
                <p className="mt-1 text-xs text-gray-600">
                  Click a channel on the left to view its conversation history and memory.
                </p>
              </div>
            ) : (
              <ConversationDetail
                channel={selectedChannel}
                detail={detail}
                loading={detailLoading}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
