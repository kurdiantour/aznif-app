const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Exclude supabase/functions from being bundled (they are Deno-based, not client code)
config.resolver.blockList = [
  ...(config.resolver.blockList || []),
  /supabase\/functions/,
];

module.exports = config;
