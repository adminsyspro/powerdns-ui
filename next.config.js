/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3', 'ldapjs'],
  images: {
    domains: ['localhost'],
  },
  webpack(config, { isServer, nextRuntime }) {
    // The edge compiler processes instrumentation.ts too, but its externals
    // handler only covers middleware/apiEdge layers — not the instrument layer.
    // As a result, Node.js-only transitive deps (crypto, fs, path, etc.) cause
    // "Module not found" errors in the edge bundle.  We add an explicit
    // externals function that silences them in the edge compilation; they will
    // never be called at runtime because of the NEXT_RUNTIME !== 'nodejs' guard.
    if (isServer && nextRuntime === 'edge') {
      const nodeBuiltins = new Set(require('module').builtinModules);
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        ({ request }, callback) => {
          if (nodeBuiltins.has(request) || nodeBuiltins.has(request.replace(/^node:/, ''))) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
