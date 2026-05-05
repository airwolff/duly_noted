// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@duly-noted/db', '@duly-noted/shared'],
  webpack: (config) => {
    // verbatimModuleSyntax + moduleResolution: bundler → all relative imports
    // use the `.js` suffix even though sources are `.ts`/`.tsx`. Map them.
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
