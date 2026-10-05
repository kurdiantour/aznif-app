import { Redirect, Slot, usePathname } from "expo-router";
import { useState } from "react";
import {
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SendChipPopup,
  SendChipPopupContext,
} from "@/components/friends/send-chip-popup";
import {
  AvatarPreviewContext,
  AvatarPreviewPopup,
  type AvatarPreviewData,
} from "@/components/player/avatar-preview-popup";
import { GlobalLeaderboardConsent } from "@/components/leaderboard/GlobalLeaderboardConsent";
import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import {
  PurchaseConfirmationPopup,
  ShopPopupContext,
} from "@/components/shop/InsufficientGemsPopup";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { useAuthState } from "@/lib/auth-state";
import type { Friend } from "@/lib/friends";
import { ENABLE_SHOP_FEATURES } from "@/lib/platformFeatures";

export default function TabsLayout() {
  const { userId, authReady } = useAuthState();
  const pathname = usePathname();

  const [sendChipFriend, setSendChipFriend] =
    useState<Friend | null>(null);

  const [
    sendChipSuccessHandler,
    setSendChipSuccessHandler,
  ] = useState<(() => void) | undefined>(undefined);

  const [purchaseConfirmation, setPurchaseConfirmation] =
    useState<{
      price: number;
      onConfirm: () => void | Promise<void>;
    } | null>(null);

  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isTablet = Math.min(width, height) >= 600;

  const [avatarPreviewData, setAvatarPreviewData] =
    useState<AvatarPreviewData | null>(null);

  if (!authReady) {
    return <View style={styles.container} />;
  }

  const isGuestAllowedRoute =
    pathname.includes("/play") ||
    pathname.includes("/lobby");

  if (!userId && !isGuestAllowedRoute) {
    return <Redirect href="/login" />;
  }

  return (
    <ShopPopupContext.Provider
      value={{
        showPurchaseConfirmation: (confirmation) => {
          if (ENABLE_SHOP_FEATURES) {
            setPurchaseConfirmation(confirmation);
          }
        },
      }}
    >
      <SendChipPopupContext.Provider
        value={{
          showSendChipPopup: (
            friend,
            onTransferSuccess,
          ) => {
            setSendChipFriend(friend);
            setSendChipSuccessHandler(
              () => onTransferSuccess,
            );
          },
        }}
      >
        <AvatarPreviewContext.Provider
          value={{
            showPreview: (avatar) =>
              setAvatarPreviewData(avatar),
          }}
        >
          <View
            style={[
              styles.container,
              {
                paddingTop: Math.max(14, insets.top),
                paddingBottom: Math.max(18, insets.bottom),
              },
            ]}
          >
            <LobbyHeader />

            <View
              style={[
                styles.content,
                {
                  paddingHorizontal: isTablet
                    ? TABLET_HORIZONTAL_INSET
                    : MOBILE_HORIZONTAL_INSET,
                },
              ]}
            >
              <Slot />
            </View>

            <BottomNav requireAuth={!userId} inFlow />

            <GlobalLeaderboardConsent />

            {ENABLE_SHOP_FEATURES ? (
              <PurchaseConfirmationPopup
                confirmation={purchaseConfirmation}
                onClose={() =>
                  setPurchaseConfirmation(null)
                }
              />
            ) : null}

            <SendChipPopup
              friend={sendChipFriend}
              visible={!!sendChipFriend}
              onClose={() =>
                setSendChipFriend(null)
              }
              onTransferSuccess={
                sendChipSuccessHandler
              }
            />

            <AvatarPreviewPopup
              avatar={avatarPreviewData}
              onClose={() =>
                setAvatarPreviewData(null)
              }
            />
          </View>
        </AvatarPreviewContext.Provider>
      </SendChipPopupContext.Provider>
    </ShopPopupContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#090b1d",
  },

  content: {
    flex: 1,
    marginTop: 10,
    marginBottom: 12,
  },
});
