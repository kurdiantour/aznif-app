import { useEffect, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";

// SemVer comparison
// returns 1 if v1 > v2, -1 if v1 < v2, 0 if v1 === v2
export function compareVersions(v1: string, v2: string): number {
  const p1 = v1.split(".").map(Number);
  const p2 = v2.split(".").map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export type UpdateStatus = "none" | "optional" | "force";

export function useAppUpdate() {
  const [status, setStatus] = useState<UpdateStatus>("none");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkVersion() {
      try {
        const currentVersion = Constants.expoConfig?.version ?? "1.0.0";
        const platform = Platform.OS === "ios" ? "ios" : "android";

        const { data, error } = await supabase
          .from("app_versions")
          .select("latest_version, min_required_version")
          .eq("platform", platform)
          .maybeSingle();

        if (error || !data) {
          console.warn("[AppUpdate] Failed to fetch version config:", error);
          setStatus("none");
          return;
        }

        const { latest_version, min_required_version } = data;

        if (compareVersions(currentVersion, min_required_version) < 0) {
          setStatus("force");
        } else if (compareVersions(currentVersion, latest_version) < 0) {
          setStatus("optional");
        } else {
          setStatus("none");
        }
      } catch (err) {
        console.warn("[AppUpdate] Unexpected error checking version:", err);
        setStatus("none");
      } finally {
        setLoading(false);
      }
    }

    checkVersion();
  }, []);

  return { status, loading, setStatus };
}
