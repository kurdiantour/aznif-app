import { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

type SettingsDrawerProps = {
  visible: boolean;
  onClose: () => void;
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(282, SCREEN_WIDTH * 0.76);

export function SettingsDrawer({ visible, onClose }: SettingsDrawerProps) {
  const slideX = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }

    slideX.setValue(DRAWER_WIDTH);
    fade.setValue(0);

    Animated.parallel([
      Animated.timing(slideX, {
        toValue: 0,
        duration: 190,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, slideX, fade]);

  function closeDrawer() {
    Animated.parallel([
      Animated.timing(slideX, {
        toValue: DRAWER_WIDTH,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  }

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={styles.backdropPressable} onPress={closeDrawer} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            transform: [{ translateX: slideX }],
          },
        ]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          bounces={false}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.title}>Settings</Text>

          <Text style={styles.subtitle}>Customize your game experience</Text>

          <View style={styles.divider} />

          <View style={styles.section}>
            <SettingSwitch label="Sound Effects" value />

            <SettingRow label="Language" value="English" />
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function SettingSwitch({ label, value }: { label: string; value: boolean }) {
  return (
    <View style={styles.settingItem}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch value={value} />
    </View>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <Pressable style={styles.settingItem}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    elevation: 999,
    alignItems: 'flex-end',
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },

  backdropPressable: {
    flex: 1,
  },

  drawer: {
    height: '100%',
    backgroundColor: '#070613',
    borderLeftWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.28)',
    paddingHorizontal: 14,
    elevation: 1000,
  },

  scrollContent: {
    paddingTop: 26,
    paddingBottom: 34,
  },

  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
  },

  subtitle: {
    marginTop: 5,
    color: '#a99bd8',
    fontSize: 12,
    fontWeight: '700',
  },

  divider: {
    marginTop: 16,
    height: 1,
    backgroundColor: 'rgba(167, 139, 250, 0.14)',
  },

  section: {
    marginTop: 16,
  },

  settingItem: {
    minHeight: 44,
    borderRadius: 11,
    marginBottom: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(13, 9, 31, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  settingLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },

  settingValue: {
    color: '#a99bd8',
    fontSize: 12,
    fontWeight: '800',
  },
});