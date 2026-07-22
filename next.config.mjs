/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow server actions to call Arc API
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;