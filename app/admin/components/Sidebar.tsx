'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

const NAV_LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/agents', label: 'Agents' },
  { href: '/admin/workflows', label: 'Workflows' },
  { href: '/admin/channels', label: 'Channels' },
  { href: '/admin/conversations', label: 'Conversations' },
  { href: '/admin/knowledge', label: 'Knowledge' },
  { href: '/admin/memories', label: 'User Memories' },
  { href: '/admin/diagnostics', label: 'Diagnostics' },
] as const;

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin';
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-64 min-h-screen bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800">
        <h1 className="text-lg font-bold text-amber-500 tracking-wide">Mutumbot</h1>
        <p className="text-xs text-gray-500 mt-0.5">Admin Dashboard</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={
              isActive(href)
                ? 'flex items-center px-3 py-2 rounded-md text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'flex items-center px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors'
            }
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-800">
        {user.name && (
          <p className="text-xs text-gray-500 truncate mb-3">{user.name}</p>
        )}
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
