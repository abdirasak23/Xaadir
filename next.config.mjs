/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hide the Next.js development badge from the app UI.
  devIndicators: false,
  // Serve local and remote image sources directly on Workers. Cloudflare
  // Images optimization requires an account Images binding, which this app
  // does not currently configure.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
