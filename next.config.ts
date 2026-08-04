import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /* Any device loading this dev server over the LAN rather than localhost —
     the iOS shell, a phone browser, a second machine — must be listed here.
     Next blocks every `/_next/*` dev resource from an unlisted host: the page
     still server-renders, so it *looks* fine, but no client chunk loads and
     React never hydrates. Every control ends up inert (the classic symptom is
     a button that simply does nothing when tapped). Dev-only; production
     serves its own origin. */
  allowedDevOrigins: ["192.168.1.68"],
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
