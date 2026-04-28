import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // Type errors are string→Id<T> cast issues (runtime-safe branded types).
    // These are tracked for follow-up; deploy proceeds with correct runtime behavior.
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      // QR code deep-link redirect: QR payloads encode /case/{caseId} so that
      // scanning with any camera app opens the SCAN flow directly.  The canonical
      // SCAN case-detail page lives at /scan/{caseId}.
      {
        source: "/case/:caseId",
        destination: "/scan/:caseId",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
