const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const config = getDefaultConfig(__dirname)
const supabaseCjsPath = path.resolve(
  __dirname,
  "node_modules",
  "@supabase",
  "supabase-js",
  "dist",
  "index.cjs",
)

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const supabaseFunctionsPath = escapeRegex(
  path.resolve(__dirname, "supabase", "functions"),
)

const existingBlockList = config.resolver.blockList

const blockListItems = Array.isArray(existingBlockList)
  ? existingBlockList
  : existingBlockList
    ? [existingBlockList]
    : []

config.resolver.blockList = [
  ...blockListItems,
  new RegExp(`${supabaseFunctionsPath}[/\\\\].*`),
]

const defaultResolveRequest = config.resolver.resolveRequest

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== "web" && moduleName === "@supabase/supabase-js") {
    return {
      filePath: supabaseCjsPath,
      type: "sourceFile",
    }
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform)
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
