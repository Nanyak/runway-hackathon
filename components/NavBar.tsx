'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export default function NavBar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();

  // Don't render on auth pages
  if (pathname === '/login' || pathname === '/register') return null;
  if (status === 'loading') return null;

  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-[#f0ede8] bg-[#fdfcfc]/90 backdrop-blur-sm">
      <div className="max-w-[1200px] mx-auto px-4 h-12 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="font-serif text-base font-light tracking-tight text-black hover:opacity-70 transition-opacity">
          PodcastClips
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {session?.user ? (
            <>
              <Link
                href="/history"
                className="text-sm text-[#777169] hover:text-black transition-colors"
              >
                History
              </Link>
              <span className="text-[#e5e5e5] text-sm">|</span>
              <span className="text-sm text-[#777169] max-w-[140px] truncate hidden sm:block">
                {session.user.name ?? session.user.email}
              </span>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-sm text-[#a59f97] hover:text-black transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm text-[#777169] hover:text-black transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="text-sm font-medium bg-black text-white rounded-[9999px] px-3.5 py-1.5
                  hover:opacity-90 transition-opacity"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
