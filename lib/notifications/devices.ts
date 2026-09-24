import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "../supabase";
import { obtainToken } from "./platform";

const installationKey = "aznif.push.installation.v1";
let serialized: Promise<unknown> = Promise.resolve();
let paused = false;
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = serialized.then(operation, operation);
  serialized = result.catch(() => {});
  return result;
}
async function installation() {
  const stored = await AsyncStorage.getItem(installationKey);
  if (stored) return JSON.parse(stored) as { id: string; secret: string };
  const value = { id: Crypto.randomUUID(), secret: Crypto.randomUUID() };
  await AsyncStorage.setItem(installationKey, JSON.stringify(value));
  return value;
}
export function resumeDeviceRegistration() { paused = false; }
export function registerPushDevice(userId: string, requestPermission = false) {
  return serialize(async () => {
    if (paused || Platform.OS === "web") return "web";
    const result = await obtainToken(requestPermission);
    if (result.permission === "development_build_required") return result.permission;
    const { data } = await supabase.auth.getSession();
    if (paused || data.session?.user.id !== userId) return result.permission;
    const proof = await installation();
    if (!result.token) {
      const { error } = await supabase.rpc("push_unregister_device", { p_installation: proof.id, p_secret: proof.secret });
      if (error) throw error;
      return result.permission;
    }
    const { error } = await supabase.rpc("push_register_device", {
      p_installation: proof.id, p_secret: proof.secret, p_token: result.token, p_platform: Platform.OS,
      p_environment: Constants.expoConfig?.extra?.pushEnvironment ?? "production",
    });
    if (error) throw error;
    return result.permission;
  });
}
export function unregisterPushDevice() {
  paused = true;
  return serialize(async () => {
    if (Platform.OS === "web") return;
    const stored = await AsyncStorage.getItem(installationKey);
    if (!stored) return;
    const proof = JSON.parse(stored) as { id: string; secret: string };
    const { error } = await supabase.rpc("push_unregister_device", { p_installation: proof.id, p_secret: proof.secret });
    if (error) throw error;
  });
}
