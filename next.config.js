/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('discord.js');
    }
    return config;
  },
  serverExternalPackages: ['postgres'],
};

module.exports = nextConfig;
