const configuredServerActionOrigins =
  process.env.SERVER_ACTION_ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) || [];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // Keep cross-platform release builds within the Docker builder's memory budget.
    cpus: 2,
    serverActions: {
      bodySizeLimit: '10mb',
      allowedOrigins: [
        'fortuna.delishad.com',
        '192.168.1.2:3000',
        ...configuredServerActionOrigins,
        'localhost:3001',
        '127.0.0.1:3001',
        '192.168.1.130:3001',
        '100.80.199.58:3001',
      ],
    },
  },
  webpack: (config) => {
    config.externals = [...(config.externals || []), 'canvas', 'jsdom'];
    return config;
  },
};

export default nextConfig;
