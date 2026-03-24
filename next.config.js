/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  images: {
    domains: ['localhost'],
  },
};

module.exports = nextConfig;
