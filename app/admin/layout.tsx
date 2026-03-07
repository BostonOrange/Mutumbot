import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Sidebar from './components/Sidebar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect('/api/auth/signin');
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar user={session.user} />
      <main className="flex-1 p-8">
        {children}
      </main>
    </div>
  );
}
