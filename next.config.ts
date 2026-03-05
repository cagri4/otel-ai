import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Disable Turbopack for production builds — Turbopack doesn't support
  // CSS package exports with "style" condition (used by shadcn and tw-animate-css).
  // Webpack handles these CSS imports correctly.
  experimental: {},
};

export default withNextIntl(nextConfig);
