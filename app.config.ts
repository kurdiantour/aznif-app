import type { ConfigContext, ExpoConfig } from "expo/config";
import fs from "node:fs";
import path from "node:path";
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleFile = process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync(path.resolve("google-services.json")) ? "./google-services.json" : undefined);
  if (process.env.EAS_BUILD_PLATFORM === "android" && !googleFile) {
    throw new Error("Android push requires GOOGLE_SERVICES_JSON (EAS file environment variable) or google-services.json for com.aznif.app.");
  }
  if (googleFile && fs.existsSync(googleFile)) {
    const google = JSON.parse(fs.readFileSync(googleFile, "utf8"));
    if (!google.client?.some((client: { client_info?: { android_client_info?: { package_name?: string } } }) =>
      client.client_info?.android_client_info?.package_name === config.android?.package)) {
      throw new Error("Firebase google-services.json does not contain com.aznif.app.");
    }
  }
  return { ...config, name: config.name ?? "Aznif", slug: config.slug ?? "domino-app",
    android: { ...config.android, ...(googleFile ? { googleServicesFile: googleFile } : {}) },
    extra: { ...config.extra, pushEnvironment: process.env.EXPO_PUBLIC_PUSH_ENVIRONMENT === "development" ? "development" : "production" } };
};
