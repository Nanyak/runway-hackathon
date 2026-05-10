import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { listUserSessions, formatSessionListLabel } from '@/lib/db';
import { SessionListItem } from '@/components/history/SessionListItem';

export default async function HistoryPage() {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) redirect('/login?callbackUrl=/history');

  const userId = (authSession.user as { id?: string }).id ?? '';
  const sessions = await listUserSessions(userId);

  return (
    <main className="min-h-screen bg-[#fdfcfc] px-4 py-12">
      <div className="max-w-[680px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl font-light tracking-tight text-black">Your sessions</h1>
            <p className="text-sm text-[#a59f97] mt-1">
              {sessions.length === 0
                ? 'No sessions yet'
                : `${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-[9999px] bg-black text-white text-sm font-medium
              px-4 py-2 hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New session
          </Link>
        </div>

        {/* List */}
        {sessions.length === 0 ? (
          <div className="text-center py-20 space-y-3">
            <div className="w-16 h-16 mx-auto rounded-full bg-[#f0ede8] flex items-center justify-center">
              <svg className="w-7 h-7 text-[#c4bfb8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <p className="text-[#777169] text-sm">Upload a podcast to get started</p>
            <Link href="/" className="inline-block text-sm font-medium text-black underline underline-offset-2">
              Go to upload →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <SessionListItem key={s.id} session={s} title={formatSessionListLabel(s)} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
