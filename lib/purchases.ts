import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

// These keys will be provided by the environment or configuration later.
const API_KEYS = {
  apple: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY || "",
  google: process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY || "",
};

let isInitialized = false;

/**
 * Initializes the RevenueCat SDK.
 * Should be called early in the app lifecycle (e.g., inside _layout.tsx or App.tsx).
 */
export async function initializePurchases(userId?: string) {
  if (isInitialized) return;

  try {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);

    if (Platform.OS === "ios") {
      if (API_KEYS.apple) {
        Purchases.configure({ apiKey: API_KEYS.apple, appUserID: userId });
        isInitialized = true;
      } else {
        console.warn("RevenueCat Apple API key is missing.");
      }
    } else if (Platform.OS === "android") {
      if (API_KEYS.google) {
        Purchases.configure({ apiKey: API_KEYS.google, appUserID: userId });
        isInitialized = true;
      } else {
        console.warn("RevenueCat Google API key is missing.");
      }
    }
  } catch (error) {
    console.error("Failed to initialize RevenueCat:", error);
  }
}

/**
 * Updates the user ID in RevenueCat after login/logout.
 */
export async function identifyPurchasesUser(userId: string) {
  if (!isInitialized) return;
  try {
    const { customerInfo, created } = await Purchases.logIn(userId);
    return { customerInfo, created };
  } catch (error) {
    console.error("Failed to identify user in RevenueCat:", error);
    throw error;
  }
}

export async function logoutPurchasesUser() {
  if (!isInitialized) return;
  try {
    await Purchases.logOut();
  } catch (error) {
    console.error("Failed to logout user from RevenueCat:", error);
    throw error;
  }
}

export default {
  initialize: initializePurchases,
  identify: identifyPurchasesUser,
  logout: logoutPurchasesUser,
};
