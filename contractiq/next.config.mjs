/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // pdfjs-dist (used client-side only) references canvas — stub it on the server
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      }
    }
    return config
  },
  experimental: {
    serverComponentsExternalPackages: ['pdf2json'],
  },
}

export default nextConfig
