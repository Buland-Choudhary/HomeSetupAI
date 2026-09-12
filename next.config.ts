import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Shown in the app so it's easy to tell whether a phone is running the latest deploy.
    NEXT_PUBLIC_BUILD_LABEL: new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }),
  },
};

export default nextConfig;
