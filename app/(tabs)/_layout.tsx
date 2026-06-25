import { Slot } from "expo-router";
import { useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import {
  SendChipPopup,
  SendChipPopupContext,
} from "@/components/friends/send-chip-popup";
import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import {
  InsufficientGemsPopup,
  PurchaseConfirmationPopup,
  ShopPopupContext,
} from "@/components/shop/InsufficientGemsPopup";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import type { Friend } from "@/lib/friends";

export default function TabsLayout() {
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [sendChipFriend, setSendChipFriend] = useState<Friend | null>(null);
  const [sendChipSuccessHandler, setSendChipSuccessHandler] = useState<
    (() => void) | undefined
  >(undefined);
  const [showInsufficientGemsPopup, setShowInsufficientGemsPopup] =
    useState(false);
  const [purchaseConfirmation, setPurchaseConfirmation] = useState<{
    price: number;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;

  return (
    <ShopPopupContext.Provider
      value={{
        showInsufficientGems: () => setShowInsufficientGemsPopup(true),
        showPurchaseConfirmation: setPurchaseConfirmation,
      }}
    >
      <SendChipPopupContext.Provider
        value={{
          showSendChipPopup: (friend, onTransferSuccess) => {
            setSendChipFriend(friend);
            setSendChipSuccessHandler(() => onTransferSuccess);
          },
        }}
      >
        <View style={styles.container}>
          <LobbyHeader
            onProfileDrawerVisibilityChange={setIsProfileDrawerOpen}
          />

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

          {!isProfileDrawerOpen ? <BottomNav /> : null}

          <InsufficientGemsPopup
            visible={showInsufficientGemsPopup}
            onClose={() => setShowInsufficientGemsPopup(false)}
          />
          <PurchaseConfirmationPopup
            confirmation={purchaseConfirmation}
            onClose={() => setPurchaseConfirmation(null)}
          />
          <SendChipPopup
            friend={sendChipFriend}
            visible={!!sendChipFriend}
            onClose={() => setSendChipFriend(null)}
            onTransferSuccess={sendChipSuccessHandler}
          />
        </View>
      </SendChipPopupContext.Provider>
    </ShopPopupContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: "#090b1d",
  },

  content: {
    flex: 1,
  },
});
