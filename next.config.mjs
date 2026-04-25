/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // experimental.typedRoutes is a future re-enable: nice strictness once
  // the route surface stabilizes after Day 14, but it adds friction
  // during the scaffold phase when routes are added several times a day.
};

export default nextConfig;
