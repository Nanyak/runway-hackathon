import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';
import NavBar from '@/components/NavBar';

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
      <body className="bg-[#fdfcfc] text-black min-h-screen">
        <Providers>
          <NavBar />
          <div className="pt-12">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
