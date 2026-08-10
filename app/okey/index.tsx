import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { BottomNav } from "@/components/lobby/BottomNav";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import {
  MOBILE_HORIZONTAL_INSET,
  TABLET_HORIZONTAL_INSET,
} from "@/constants/layout";
import { useProfile } from "@/lib/profile";

type OkeyPlayMode = "fun" | "aznif";

type ModeCardContent = {
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  colors: readonly [string, string];
};

type ModeCardProps = {
  mode: OkeyPlayMode;
  isTablet: boolean;
  onPress: () => void;
};

const MODE_CARD_WIDTH = 200;
const MODE_CARD_HEIGHT = 250;

function getModeContent(
  mode: OkeyPlayMode,
): ModeCardContent {
  switch (mode) {
    case "fun":
      return {
        title: "یاریی ڕێزبەندی",
        description:
          "یاریی سەرگەرمییە، بەبێ مەترسی ئەزنیف.",
        icon: "gamepad-variant-outline",
        colors: [
          "rgba(34,197,94,0.92)",
          "rgba(14,116,144,0.82)",
        ],
      };

    case "aznif":
      return {
        title: "یاریی ئەزنیف",
        description:
          "بە ئەزنیف بچۆ ژوورەوە و لەگەڵ یاریزانانی ڕاستەقینە یاری بکە.",
        icon: "cash-multiple",
        colors: [
          "rgba(245,158,11,0.94)",
          "rgba(127,29,29,0.84)",
        ],
      };
  }
}

function ModeCard({
  mode,
  isTablet,
  onPress,
}: ModeCardProps) {
  const content = getModeContent(mode);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeCard,
        isTablet && styles.modeCardTablet,
        pressed && styles.modeCardPressed,
      ]}
    >
      <LinearGradient
        colors={content.colors}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.modeCardShade} />

      <View
        style={[
          styles.modeIconShell,
          isTablet && styles.modeIconShellTablet,
        ]}
      >
        <MaterialCommunityIcons
          name={content.icon}
          size={isTablet ? 38 : 30}
          color="#fff7d6"
        />
      </View>

      <View style={styles.modeTextSection}>
        <Text
          style={[
            styles.modeTitle,
            isTablet && styles.modeTitleTablet,
          ]}
        >
          {content.title}
        </Text>

        <Text
          style={[
            styles.modeDescription,
            isTablet &&
              styles.modeDescriptionTablet,
          ]}
        >
          {content.description}
        </Text>
      </View>
    </Pressable>
  );
}

export default function OkeyLobbyScreen() {
  const { profile } = useProfile();
  const { width, height } =
    useWindowDimensions();

  const isTablet =
    Math.min(width, height) >= 600;

  return (
    <View style={styles.shell}>
      <LobbyHeader />

      {__DEV__ ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Okey local preview"
          onPress={() => router.push("/okey/preview")}
          style={styles.previewButton}
        >
          <MaterialCommunityIcons name="test-tube" size={18} color="#fff7d6" />
          <Text style={styles.previewButtonText}>Okey Preview</Text>
        </Pressable>
      ) : null}

      <View
        style={[
          styles.shellContent,
          {
            paddingHorizontal: isTablet
              ? TABLET_HORIZONTAL_INSET
              : MOBILE_HORIZONTAL_INSET,
          },
        ]}
      >
        <View style={styles.screen}>
          <View style={styles.content}>
            <View
              style={[
                styles.modeSection,
                isTablet &&
                  styles.modeSectionTablet,
              ]}
            >
              <View
                style={[
                  styles.modeRow,
                  isTablet &&
                    styles.modeRowTablet,
                ]}
              >
                <ModeCard
                  mode="fun"
                  isTablet={isTablet}
                  onPress={() =>
                    router.push("/okey/fun")
                  }
                />

                <ModeCard
                  mode="aznif"
                  isTablet={isTablet}
                  onPress={() =>
                    router.push("/okey/aznif")
                  }
                />
              </View>
            </View>
          </View>
        </View>
      </View>

      <BottomNav requireAuth={!profile} />
    </View>
  );
}

const styles = StyleSheet.create({
  previewButton: {
    position: "absolute",
    top: 18,
    right: 18,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,247,214,0.28)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  previewButtonText: {
    color: "#fff7d6",
    fontSize: 12,
    fontFamily: "RobotoMedium",
  },
  shell: {
    flex: 1,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: "#090b1d",
  },

  shellContent: {
    flex: 1,
    paddingBottom: 74,
  },

  screen: {
    flex: 1,
  },

  content: {
    flex: 1,
    justifyContent: "center",
  },

  modeSection: {
    height: MODE_CARD_HEIGHT,
    justifyContent: "center",
  },

  modeSectionTablet: {
    height: 300,
  },

  modeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },

  modeRowTablet: {
    gap: 18,
  },

  modeCard: {
    width: MODE_CARD_WIDTH,
    height: MODE_CARD_HEIGHT,
    padding: 16,
    overflow: "hidden",
    borderRadius: 12,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.16)",
    justifyContent: "space-between",
  },

  modeCardTablet: {
    width: 240,
    height: 300,
    padding: 22,
    borderRadius: 18,
  },

  modeCardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },

  modeCardShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.24)",
  },

  modeIconShell: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor:
      "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },

  modeIconShellTablet: {
    width: 72,
    height: 72,
    borderRadius: 18,
  },

  modeTextSection: {
    width: "100%",
    alignItems: "center",
  },

  modeTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  modeTitleTablet: {
    fontSize: 19,
  },

  modeDescription: {
    marginTop: 16,
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "SpedaBold",
    textAlign: "center",
    writingDirection: "rtl",
  },

  modeDescriptionTablet: {
    marginTop: 20,
    fontSize: 16,
    lineHeight: 25,
  },
});
