/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // pdfjs-dist needs canvas on server — provide a no-op shim
      config.resolve.alias.canvas = false
    }
    return config
  },
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
}

export default nextConfig
