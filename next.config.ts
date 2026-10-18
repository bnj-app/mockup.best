import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The WebGL editor runs entirely on the client, with no server work.
  // Static export serves plain files through nginx, matching deployment
  // without requiring a Node process.
  output: "export",
  // Write routes as photo/index.html rather than photo.html.
  // Without nginx try_files, requests for /photo found the directory
  // but no index and returned 403. Directory + index output works
  // without changing server configuration.
  trailingSlash: true,
  images: { unoptimized: true },
  // Multiple root layouts ((en)/(tr)) need app/global-not-found.tsx because one layout cannot provide the shared 404.
  experimental: { globalNotFound: true },
  // Prevent development from generating agent instruction files in this repository.
  agentRules: false,
};

export default nextConfig;
