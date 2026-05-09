import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { listUserSessions, DbSession } from '@/lib/db';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploading:           { label: 'Uploading',        color: 'bg-[#f0ede8] text-[#777169]' },
  transcribing:        { label: 'Transcribing',      color: 'bg-blue-50 text-blue-600' },
  detecting:           { label: 'Detecting',         color: 'bg-blue-50 text-blue-600' },
  awaiting_approval:   { label: 'Needs approval',    color: 'bg-yellow-50 text-yellow-700' },
  generating:          { label: 'Generating',        color: 'bg-purple-50 text-purple-700' },
  awaiting_selection:  { label: 'Pick a moment',     color: 'bg-yellow-50 text-yellow-700' },
  complete:            { label: 'Complete',           color: 'bg-green-50 text-green-700' },
  error:               { label: 'Error',              color: 'bg-red-50 text-red-600' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABELS[status] ?? { label: status, color: 'bg-[#f0ede8] text-[#777169]' };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function SessionCard({ s }: { s: DbSession }) {
  const title = s.show_name
    ? `${s.show_name}${s.speaker_name ? ` · ${s.speaker_name}` : ''}`
    : s.speaker_name || s.title;

  return (
    <Link
      href={`/session/${s.session_file_id}`}
      className="group flex items-center gap-4 rounded-[14px] border border-[#e5e5e5] bg-white px-5 py-4
        hover:border-black/20 hover:shadow-sm transition-all"
      style={{ boxShadow: 'rgba(0,0,0,0.03) 0px 2px 4px' }}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-10 h-10 rounded-[10px] bg-[#f0ede8] flex items-center justify-center">
        <svg className="w-5 h-5 text-[#a59f97]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-black truncate group-hover:text-black/80 transition-colors">
          {title}
        </p>
        <p className="text-xs text-[#a59f97] mt-0.5">{formatDate(s.created_at)}</p>
      </div>

      {/* Status */}
      <StatusBadge status={s.status} />

      {/* Arrow */}
      <svg className="w-4 h-4 text-[#c4bfb8] group-hover:text-black/40 transition-colors flex-shrink-0"
        fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export default async function HistoryPage() {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) redirect('/login?callbackUrl=/history');

  const userId = (authSession.user as { id?: string }).id ?? '';
  const sessions = listUserSessions(userId);

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
              <SessionCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
