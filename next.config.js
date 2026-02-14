const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force Next.js to treat this repository as tracing root.
  // This avoids warnings when parent directories also contain lockfiles.
  outputFileTracingRoot: path.resolve(__dirname),
};

module.exports = nextConfig
