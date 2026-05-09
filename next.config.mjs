/** @type {import('next').NextConfig} */
const config = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    // Mark server-side packages that should not be bundled by Next.js webpack
    serverComponentsExternalPackages: [
      '@remotion/bundler',
      '@remotion/renderer',
      '@remotion/studio',
      'remotion',
      'esbuild',
      '@rspack/core',
      '@rspack/binding',
      'fluent-ffmpeg',
      'ffmpeg-static',
      'ffprobe-static',
      'winston',
    ],
  },
  webpack: (webpackConfig, { isServer }) => {
    if (isServer) {
      const externals = [
        '@remotion/bundler',
        '@remotion/renderer',
        '@remotion/studio',
        '@rspack/core',
        '@rspack/binding',
        'esbuild',
      ];

      if (typeof webpackConfig.externals === 'function') {
        const original = webpackConfig.externals;
        webpackConfig.externals = (ctx, callback) => {
          if (externals.some(pkg => ctx.request?.startsWith(pkg))) {
            return callback(null, `commonjs ${ctx.request}`);
          }
          return original(ctx, callback);
        };
      } else if (Array.isArray(webpackConfig.externals)) {
        webpackConfig.externals.push(
          ...externals.map(pkg => new RegExp(`^${pkg.replace('/', '\\/')}(\\/.*)?$`))
        );
      }
    }
    return webpackConfig;
  },
};

export default config;
