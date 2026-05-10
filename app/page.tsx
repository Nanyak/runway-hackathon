'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DropZone from '@/components/upload/DropZone';
import ConfigPanel from '@/components/upload/ConfigPanel';
import { SessionConfig } from '@/lib/types';
import { DEFAULT_STYLE_ANCHOR } from '@/lib/config/style-presets';
import { PRODUCT_VALUE_PROPOSITION } from '@/lib/config/runway-highlights';

const DEFAULT_CONFIG: SessionConfig = {
  maxMoments: 3,
  imageModel: 'gpt_image_2',
  videoModel: 'seedance2',
  orientation: 'vertical',
  styleAnchor: DEFAULT_STYLE_ANCHOR,
  speakerName: '',
  showName: '',
  sheetVariantCount: 2,
};

export default function HomePage() {
  const router = useRouter();
  const { status: authStatus } = useSession();
  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handleFileSelect(file: File) {
    setSelectedFile(file);
    setUploadError(null);
  }

  function handleUpload() {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('config', JSON.stringify(config));

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText) as { sessionId: string };
        router.push(`/session/${data.sessionId}`);
      } else {
        setUploading(false);
        let message = xhr.statusText || 'Unknown error';
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string };
          if (typeof body.error === 'string' && body.error.length > 0) {
            message = body.error;
          }
        } catch {
          /* use default message */
        }
        setUploadError(`Upload failed: ${message}`);
      }
    });

    xhr.addEventListener('error', () => {
      setUploading(false);
      setUploadError('Network error during upload. Please try again.');
    });

    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  }

  return (
    <main className="min-h-screen bg-[#fdfcfc] flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[600px] space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="font-serif text-5xl font-light tracking-tight text-black leading-tight">
            Turn podcasts into<br />viral clips
          </h1>
          <p className="text-[#777169] text-base leading-relaxed max-w-[520px] mx-auto">
            {PRODUCT_VALUE_PROPOSITION}
          </p>
        </div>

        <ol className="w-full max-w-[600px] mx-auto grid gap-3 sm:grid-cols-3 text-left text-sm">
          {[
            { n: '1', t: 'Find the beat', d: 'Whisper + Claude surface Shorts-worthy moments with hooks you can edit.' },
            { n: '2', t: 'Approve spend', d: 'Pick moments before we run Gen-4 Image, image-to-video, and optional refinements.' },
            { n: '3', t: 'Ship vertical MP4', d: 'Captions, overlay, and your moment audio — one download.' },
          ].map((step) => (
            <li
              key={step.n}
              className="rounded-[12px] border border-[#e5e5e5] bg-white px-4 py-3"
              style={{ boxShadow: 'rgba(0,0,0,0.04) 0px 2px 4px' }}
            >
              <span className="text-[10px] font-semibold text-[#a59f97] uppercase tracking-wider">Step {step.n}</span>
              <p className="font-medium text-black mt-1">{step.t}</p>
              <p className="text-xs text-[#777169] mt-1 leading-snug">{step.d}</p>
            </li>
          ))}
        </ol>

        {/* Upload zone — gated by auth */}
        {authStatus === 'loading' ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-black border-t-transparent animate-spin" />
          </div>
        ) : authStatus === 'unauthenticated' ? (
          <div className="flex flex-col items-center gap-4 py-10 rounded-[16px] border border-[#e5e5e5] bg-white"
            style={{ boxShadow: 'rgba(0,0,0,0.04) 0px 2px 4px' }}
          >
            <h2 className="text-lg font-semibold text-black">Sign in to get started</h2>
            <a
              href="/login"
              className="px-6 py-2.5 rounded-[9999px] bg-black text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Sign in
            </a>
          </div>
        ) : (
          <>
            <DropZone onFileSelect={handleFileSelect} />

            {/* Config */}
            <ConfigPanel config={config} onChange={setConfig} />

            {/* Upload progress */}
            {uploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[#777169]">Uploading…</span>
                  <span className="text-black font-medium">{uploadProgress}%</span>
                </div>
                <div className="h-1 bg-[#e5e5e5] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {uploadError && (
              <p className="text-sm text-red-500">{uploadError}</p>
            )}

            {/* CTA */}
            <button
              type="button"
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="w-full py-3.5 rounded-[9999px] bg-black text-[#fdfcfc] text-sm font-medium
                disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {uploading ? 'Uploading…' : 'Generate Viral Clips'}
            </button>
          </>
        )}

        <p className="text-center text-xs text-[#a59f97]">
          Supports MP3, WAV, M4A · Up to 2 GB · Generations use{' '}
          <a
            href="https://docs.dev.runwayml.com/"
            className="underline underline-offset-2 hover:text-black"
            target="_blank"
            rel="noopener noreferrer"
          >
            Runway API
          </a>{' '}
          (Gen-4 Image, Gen-4.5, Aleph)
        </p>
      </div>
    </main>
  );
}
