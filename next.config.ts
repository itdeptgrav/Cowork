import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Pre-analyse these large packages for tree-shaking so the bundler can
    // omit unused exports without a full-module parse on every request.
    optimizePackageImports: [
      "@livekit/components-react",
      "@tiptap/react",
      "@tiptap/starter-kit",
    ],
  },
};

export default nextConfig;
