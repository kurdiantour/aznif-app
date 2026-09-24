import { PlayerAvatar } from "@/components/player/PlayerAvatar";
import type { DominoParty } from "@/lib/dominoParty";
import {
  getHumanPlayerProfile,
  type HumanPlayerProfile,
} from "@/lib/profile";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Props = {
  party: DominoParty;
  currentUserId: string;
  cancelling: boolean;
  error: string | null;
  onCancel: () => void;
};

export function GamePartyChip({ party, currentUserId, ...props }: Props) {
  const teammate = party.members.find(
    (member) => member.userId !== currentUserId,
  );

  // A different teammate owns a fresh profile state and cancels the old request.
  return teammate ? (
    <TeammatePartyChip key={teammate.userId} teammate={teammate} {...props} />
  ) : null;
}

function TeammatePartyChip({
  teammate,
  cancelling,
  error,
  onCancel,
}: Omit<Props, "party" | "currentUserId"> & {
  teammate: DominoParty["members"][number];
}) {
  const [teammateProfile, setTeammateProfile] =
    useState<HumanPlayerProfile | null>(null);

  useEffect(() => {
    let mounted = true;

    getHumanPlayerProfile(teammate.userId)
      .then((profile) => {
        if (mounted) {
          setTeammateProfile(profile);
        }
      })
      .catch((profileError) => {
        console.warn(
          "[GamePartyChip] Unable to load teammate profile:",
          profileError,
        );

        if (mounted) {
          setTeammateProfile(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, [teammate.userId]);

  const teammateName =
    teammateProfile?.displayName ?? teammate.name;

  const displayName =
    teammateName.length > 10
      ? `${teammateName.slice(0, 10)}...`
      : teammateName;

  return (
    <View pointerEvents="box-none" style={styles.host}>
      <View style={styles.chip}>
        {teammateProfile ? (
          <PlayerAvatar
            avatarId={teammateProfile.avatarId}
            avatarUrl={teammateProfile.avatarUrl}
            size={34}
          />
        ) : (
          <View style={styles.avatarPlaceholder} />
        )}

        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.name}>
            {displayName}
          </Text>

          <Text style={styles.label}>هاوتیمی</Text>

          {error ? (
            <Text numberOfLines={1} style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>

        <Pressable
          accessibilityLabel="پاشگەزبوونەوە لە پارتی"
          disabled={cancelling}
          hitSlop={8}
          onPress={onCancel}
          style={({ pressed }) => [
            styles.cancel,
            pressed && styles.pressed,
          ]}
        >
          {cancelling ? (
            <ActivityIndicator
              color="#fff"
              size="small"
            />
          ) : (
            <Ionicons
              color="#fff"
              name="close"
              size={20}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: "center",
    justifyContent: "center",
  },

  chip: {
    maxWidth: 270,
    minWidth: 190,
    minHeight: 50,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(218,174,106,0.55)",
    backgroundColor: "rgba(48,29,20,0.96)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  avatarPlaceholder: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  copy: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },

  name: {
    color: "#fff4df",
    fontFamily: "SpedaBold",
    fontSize: 13,
    textAlign: "center",
  },

  label: {
    color: "#fcfaf7",
    fontFamily: "SpedaBold",
    fontSize: 10,
    textAlign: "center",
  },

  error: {
    color: "#ff9b94",
    fontFamily: "Speda",
    fontSize: 9,
    textAlign: "center",
  },

  cancel: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9b3d36",
  },

  pressed: {
    opacity: 0.72,
  },
});