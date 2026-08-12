/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      }
    }
    return config
  },
  experimental: {
    // Keep these as native node_modules — do not bundle through webpack.
    // Netlify Functions includes all package.json dependencies at runtime.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
}

export default nextConfig
