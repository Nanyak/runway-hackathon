import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PodcastClips — Viral Moments Generator',
  description: 'Turn your podcast into viral short-form videos for TikTok, Reels, and Shorts',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-[#fdfcfc] text-black min-h-screen">{children}</body>
    </html>
  );
}
