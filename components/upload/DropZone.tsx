'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
}

const ACCEPTED_AUDIO_TYPES = [
  'audio/mp3',
  'audio/wav',
  'audio/m4a',
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
];

function estimateDuration(file: File): string {
  const sizeInMB = file.size / (1024 * 1024);
  const estimatedMinutes = Math.round(sizeInMB);
  if (estimatedMinutes < 1) return '< 1 min';
  if (estimatedMinutes === 1) return '~1 min';
  return `~${estimatedMinutes} min`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DropZone({ onFileSelect }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateAndSelect(file: File) {
    setError(null);
    const isAudio =
      ACCEPTED_AUDIO_TYPES.includes(file.type) ||
      /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);

    if (!isAudio) {
      setError('Please select an audio file (MP3, WAV, M4A, etc.)');
      return;
    }

    setSelectedFile(file);
    onFileSelect(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSelect(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) validateAndSelect(file);
  }

  return (
    <div className="w-full">
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative cursor-pointer rounded-[16px] border-2 border-dashed p-12 text-center transition-colors
          ${isDragging
            ? 'border-black bg-[#f5f3f1]'
            : 'border-[#e5e5e5] bg-white hover:bg-[#f5f3f1] hover:border-[#a59f97]'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          onChange={handleChange}
          className="hidden"
        />

        {selectedFile ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-black flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M9 18V5l12-2v13"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <div>
              <p className="font-medium text-black text-sm">{selectedFile.name}</p>
              <p className="text-[#777169] text-xs mt-1">
                {formatFileSize(selectedFile.size)} · {estimateDuration(selectedFile)} estimated
              </p>
            </div>
            <p className="text-[#a59f97] text-xs">Click to change file</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full border border-[#e5e5e5] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#777169" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <div>
              <p className="font-medium text-black text-sm">Drop your podcast here</p>
              <p className="text-[#777169] text-sm mt-1">or click to browse</p>
            </div>
            <p className="text-[#a59f97] text-xs">MP3, WAV, M4A · up to 2 GB</p>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
