const createExpoWebpackConfigAsync = require('@expo/webpack-config');
const path = require('path');

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);

  // Alias the storage-js package to its ESM build so Webpack can resolve it correctly
  config.resolve = config.resolve || {};
  config.resolve.alias = {
    ...(config.resolve.alias || {}),
    '@supabase/storage-js': path.resolve(__dirname, 'node_modules/@supabase/storage-js/dist/index.mjs'),
  };

  return config;
};
