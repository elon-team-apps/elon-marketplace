/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // This allows the production build to finish even with errors
    ignoreBuildErrors: true,
  },
  eslint: {
    // This prevents ESLint from stopping the build
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
