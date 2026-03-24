/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3', 'ldapjs'],
  images: {
    domains: ['localhost'],
  },
};

module.exports = nextConfig;
