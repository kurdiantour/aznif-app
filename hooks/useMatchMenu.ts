import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

export function useMatchMenu() {
  const [showMatchMenu, setShowMatchMenu] = useState(false);
  const [isMatchMenuOpen, setIsMatchMenuOpen] = useState(false);

  const matchMenuTranslateX = useRef(new Animated.Value(420)).current;

  useEffect(() => {
    if (!showMatchMenu) return;

    Animated.timing(matchMenuTranslateX, {
      toValue: isMatchMenuOpen ? 0 : 420,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !isMatchMenuOpen) setShowMatchMenu(false);
    });
  }, [isMatchMenuOpen, matchMenuTranslateX, showMatchMenu]);

  const openMatchMenu = () => {
    matchMenuTranslateX.setValue(420);
    setShowMatchMenu(true);
    setIsMatchMenuOpen(true);
  };

  const closeMatchMenu = () => {
    setIsMatchMenuOpen(false);
  };

  return {
    showMatchMenu,
    matchMenuTranslateX,
    openMatchMenu,
    closeMatchMenu,
  };
}