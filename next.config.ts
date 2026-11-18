import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // Reuse a visited page for 30s so switching back skips the server
    // round trip; the pages keep their own data fresh on the client.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
