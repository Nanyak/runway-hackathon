'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });

    setLoading(false);
    if (res?.error) {
      setError('Invalid email or password');
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  function fillDemo() {
    setEmail('demo@example.com');
    setPassword('password123');
  }

  return (
    <main className="min-h-screen bg-[#fdfcfc] flex items-center justify-center px-4">
      <div className="w-full max-w-[420px] space-y-6">
        {/* Logo / title */}
        <div className="text-center space-y-1">
          <h1 className="font-serif text-3xl font-light tracking-tight text-black">
            Welcome back
          </h1>
          <p className="text-sm text-[#777169]">Sign in to your account</p>
        </div>

        {/* Demo callout */}
        <button
          type="button"
          onClick={fillDemo}
          className="w-full rounded-[12px] border border-dashed border-[#d4cfc8] bg-[#f9f8f6] px-4 py-3 text-left hover:border-[#b0a89e] transition-colors group"
        >
          <p className="text-[10px] font-semibold text-[#a59f97] uppercase tracking-wider mb-1">
            Quick demo access
          </p>
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-black font-medium">demo@example.com</span>
            <span className="text-xs text-[#a59f97]">password123</span>
          </div>
          <p className="text-xs text-[#a59f97] mt-1 group-hover:text-[#777169] transition-colors">
            Click to auto-fill →
          </p>
        </button>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
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
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-[#a59f97]">
          No account?{' '}
          <Link href="/register" className="text-black font-medium underline underline-offset-2 hover:opacity-70 transition-opacity">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
