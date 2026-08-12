import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// Copy pdfjs worker to public/ so the browser can load it from the same origin.
// Must run before Next.js starts (module-level, not inside nextConfig).
try {
  const src  = join(process.cwd(), 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
  const dest = join(process.cwd(), 'public/pdf.worker.min.mjs')
  if (!existsSync(dest)) {
    mkdirSync(join(process.cwd(), 'public'), { recursive: true })
    copyFileSync(src, dest)
  }
} catch (e) {
  console.warn('Could not copy pdfjs worker:', e.message)
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // pdfjs-dist references canvas on the server — stub it out
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
