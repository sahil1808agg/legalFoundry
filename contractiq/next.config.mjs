/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Stub browser-only modules that pdfjs-dist references on the server
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas:              false,
        'canvas/types/index': false,
      }
    }
    return config
  },
}

export default nextConfig
