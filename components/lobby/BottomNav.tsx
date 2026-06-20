import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type BottomNavKey = 'home' | 'leaderboard' | 'friends';

type BottomNavProps = {
  active?: BottomNavKey;
  onChange?: (key: BottomNavKey) => void;
};

const items = [
  {
    key: 'home',
    label: 'Home',
    icon: 'home',
    href: '/lobby',
  },
  {
    key: 'leaderboard',
    label: 'Leaderboard',
    icon: 'trophy',
    href: '/leaderboard',
  },
  {
    key: 'friends',
    label: 'Friends',
    icon: 'people',
    href: '/invite-friends',
  },
] as const;

export function BottomNav({ active: controlledActive, onChange }: BottomNavProps) {
  const pathname = usePathname();

  const routeActive: BottomNavKey = pathname.includes('leaderboard')
    ? 'leaderboard'
    : pathname.includes('invite')
      ? 'friends'
      : 'home';

  const active = controlledActive ?? routeActive;

  const handlePress = (key: BottomNavKey, href: typeof items[number]['href']) => {
    if (onChange) {
      onChange(key);
      return;
    }

    router.push(href);
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        {items.map((item) => {
          const isActive = active === item.key;

          return (
            <Pressable
              key={item.key}
              onPress={() => handlePress(item.key, item.href)}
              hitSlop={10}
              style={({ pressed }) => [
                styles.item,
                isActive && styles.activeItem,
                pressed && styles.pressedItem,
              ]}
            >
              <Ionicons
                name={item.icon}
                size={15}
                color={isActive ? '#ffffff' : 'rgba(255,255,255,0.52)'}
              />

              <Text
                style={[
                  styles.text,
                  isActive ? styles.activeText : styles.inactiveText,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 28,
    bottom: 18,
    alignItems: 'flex-start',
    zIndex: 999,
    elevation: 20,
  },

  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(180,120,255,0.18)',
    backgroundColor: 'rgba(12, 10, 30, 0.88)',
  },

  item: {
    height: 38,
    paddingHorizontal: 18,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },

  activeItem: {
    backgroundColor: 'rgba(150, 90, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(190,140,255,0.35)',
  },

  pressedItem: {
    opacity: 0.82,
  },

  text: {
    fontSize: 12,
    fontFamily: 'SpedaBold',
  },

  activeText: {
    color: '#ffffff',
  },

  inactiveText: {
    color: 'rgba(255,255,255,0.52)',
  },
});