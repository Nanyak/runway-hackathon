'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DbSession } from '@/lib/db';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  uploading: { label: 'Uploading', color: 'bg-[#f0ede8] text-[#777169]' },
  transcribing: { label: 'Transcribing', color: 'bg-blue-50 text-blue-600' },
  detecting: { label: 'Detecting', color: 'bg-blue-50 text-blue-600' },
  awaiting_approval: { label: 'Needs approval', color: 'bg-yellow-50 text-yellow-700' },
  awaiting_storyboard_review: { label: 'Storyboard', color: 'bg-yellow-50 text-yellow-700' },
  generating_video: { label: 'Generating', color: 'bg-purple-50 text-purple-700' },
  generating: { label: 'Generating', color: 'bg-purple-50 text-purple-700' },
  awaiting_feedback: { label: 'Ready', color: 'bg-green-50 text-green-700' },
  awaiting_selection: { label: 'Pick a moment', color: 'bg-yellow-50 text-yellow-700' },
  complete: { label: 'Complete', color: 'bg-green-50 text-green-700' },
  error: { label: 'Error', color: 'bg-red-50 text-red-600' },
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
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionListItem({ session: s, title }: { session: DbSession; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openEdit = () => {
    setNameDraft(title);
    setEditing(true);
    setError(null);
    setConfirmDelete(false);
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next) {
      setError('Name cannot be empty');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${s.session_file_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${s.session_file_id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-1">
      <div
        className="group flex items-stretch gap-1 rounded-[14px] border border-[#e5e5e5] bg-white
          hover:border-black/20 hover:shadow-sm transition-all overflow-hidden"
        style={{ boxShadow: 'rgba(0,0,0,0.03) 0px 2px 4px' }}
      >
        {editing ? (
          <div className="flex flex-1 min-w-0 items-center gap-4 px-5 py-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-[10px] bg-[#f0ede8] flex items-center justify-center">
              <svg className="w-5 h-5 text-[#a59f97]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <input
                value={nameDraft}
                onChange={(ev) => setNameDraft(ev.target.value)}
                className="w-full rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-sm text-black
                  focus:outline-none focus:ring-2 focus:ring-black/10"
                maxLength={200}
                autoFocus
                disabled={saving}
                aria-label="Session name"
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') void saveName();
                  if (ev.key === 'Escape') setEditing(false);
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveName()}
                  disabled={saving}
                  className="rounded-lg bg-black px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="rounded-lg border border-[#e5e5e5] px-2.5 py-1 text-xs text-[#777169]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <Link
            href={`/session/${s.session_file_id}`}
            className="flex flex-1 min-w-0 items-center gap-4 px-5 py-4"
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-[10px] bg-[#f0ede8] flex items-center justify-center">
              <svg className="w-5 h-5 text-[#a59f97]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-black truncate group-hover:text-black/80 transition-colors">
                {title}
              </p>
              <p className="text-xs text-[#a59f97] mt-0.5">{formatDate(s.created_at)}</p>
            </div>
            <StatusBadge status={s.status} />
            <svg
              className="w-4 h-4 text-[#c4bfb8] group-hover:text-black/40 transition-colors flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}

        {!editing && (
          <div className="flex flex-col justify-center gap-1 pr-3 py-3 border-l border-[#f0ede8]">
            <button
              type="button"
              onClick={openEdit}
              className="rounded-lg p-2 text-[#a59f97] hover:bg-[#f5f3f1] hover:text-black transition-colors"
              aria-label="Rename session"
              title="Rename"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
            {confirmDelete ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={deleting}
                  className="rounded-lg px-2 py-1 text-[10px] font-medium bg-red-600 text-white
                    hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? '…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-2 py-1 text-[10px] text-[#777169] hover:bg-[#f5f3f1]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg p-2 text-[#a59f97] hover:bg-red-50 hover:text-red-600 transition-colors"
                aria-label="Delete session"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600 px-1">{error}</p>}
    </div>
  );
}
