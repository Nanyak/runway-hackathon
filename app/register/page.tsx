'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password }),
    });

    if (!res.ok) {
      const body = await res.json() as { error?: string };
      setError(body.error ?? 'Registration failed');
      setLoading(false);
      return;
    }

    // Auto sign-in after register
    const signInRes = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });

    setLoading(false);
    if (signInRes?.error) {
      setError('Account created but sign-in failed. Please log in manually.');
    } else {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <main className="min-h-screen bg-[#fdfcfc] flex items-center justify-center px-4">
      <div className="w-full max-w-[420px] space-y-6">
        <div className="text-center space-y-1">
          <h1 className="font-serif text-3xl font-light tracking-tight text-black">
            Create account
          </h1>
          <p className="text-sm text-[#777169]">Start turning podcasts into viral clips</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="name" className="text-xs font-medium text-[#777169] uppercase tracking-wider">
              Your name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-[10px] border border-[#e5e5e5] bg-white px-4 py-3 text-sm text-black placeholder-[#c4bfb8]
                focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black/30 transition"
              placeholder="Jane Smith"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-xs font-medium text-[#777169] uppercase tracking-wider">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[10px] border border-[#e5e5e5] bg-white px-4 py-3 text-sm text-black placeholder-[#c4bfb8]
                focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black/30 transition"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-xs font-medium text-[#777169] uppercase tracking-wider">
              Password
              <span className="ml-1 normal-case font-normal">(min 8 chars)</span>
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[10px] border border-[#e5e5e5] bg-white px-4 py-3 text-sm text-black placeholder-[#c4bfb8]
                focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-black/30 transition"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-[8px] px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-[9999px] bg-black text-[#fdfcfc] text-sm font-medium
              disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-[#a59f97]">
          Already have an account?{' '}
          <Link href="/login" className="text-black font-medium underline underline-offset-2 hover:opacity-70 transition-opacity">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
