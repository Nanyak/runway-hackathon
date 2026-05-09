import type { NextConfig } from "next";

const serverExternalPackages = [
  'fluent-ffmpeg',
  'ffmpeg-static',
  'ffprobe-static',
  'archiver',
  'winston',
];

const config: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  serverExternalPackages,
};

export default config;
