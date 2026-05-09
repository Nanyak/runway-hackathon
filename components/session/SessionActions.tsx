'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  sessionId: string;
  fallbackLabel: string;
  displayName: string | null;
  onDisplayNameChange: (name: string | null) => void;
};

export default function SessionActions({
  sessionId,
  fallbackLabel,
  displayName,
  onDisplayNameChange,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const label = displayName?.trim() ? displayName.trim() : fallbackLabel;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
        setDeleteConfirm(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const startRename = () => {
    setDraft(label);
    setEditing(true);
    setDeleteConfirm(false);
    setError(null);
  };

  const saveRename = async () => {
    const next = draft.trim();
    if (!next) {
      setError('Name cannot be empty');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      onDisplayNameChange(next);
      setEditing(false);
      setOpen(false);
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
      const res = await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      router.push('/history');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="relative flex items-center gap-3" ref={menuRef}>
      <p className="text-sm text-[#777169] max-w-[200px] sm:max-w-xs truncate hidden sm:block" title={label}>
        {label}
      </p>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setEditing(false);
          setDeleteConfirm(false);
          setError(null);
        }}
        className="rounded-lg p-2 text-[#a59f97] hover:bg-[#f5f3f1] hover:text-black transition-colors"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Session menu"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
          />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-[#e5e5e5] bg-white py-1
            shadow-lg"
          style={{ boxShadow: 'rgba(0,0,0,0.08) 0px 4px 16px' }}
        >
          {editing ? (
            <div className="px-3 py-2 space-y-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded-lg border border-[#e5e5e5] px-2 py-1.5 text-sm text-black
                  focus:outline-none focus:ring-2 focus:ring-black/10"
                maxLength={200}
                autoFocus
                disabled={saving}
                aria-label="Session name"
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') void saveRename();
                  if (ev.key === 'Escape') setEditing(false);
                }}
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-xs text-[#777169] px-2 py-1"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveRename()}
                  disabled={saving}
                  className="text-xs font-medium bg-black text-white rounded-lg px-2.5 py-1 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={startRename}
                className="w-full text-left px-3 py-2 text-sm text-black hover:bg-[#f5f3f1]"
              >
                Rename session…
              </button>
              {deleteConfirm ? (
                <div className="px-3 py-2 space-y-2 border-t border-[#f0ede8]">
                  <p className="text-xs text-[#777169]">Delete this session and all files?</p>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(false)}
                      className="text-xs text-[#777169] px-2 py-1"
                      disabled={deleting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove()}
                      disabled={deleting}
                      className="text-xs font-medium bg-red-600 text-white rounded-lg px-2.5 py-1 disabled:opacity-50"
                    >
                      {deleting ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Delete session…
                </button>
              )}
            </>
          )}
          {error && <p className="px-3 pb-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
