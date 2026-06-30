import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tokens } from "../theme/tokens";

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
}

/** Background + safe-area padded container used by every screen. */
export function Screen({ children, scroll = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: tokens.space(4),
    paddingBottom: insets.bottom + tokens.space(4),
    paddingHorizontal: tokens.space(4),
  };

  if (scroll) {
    return (
      <ScrollView style={styles.bg} contentContainerStyle={padding} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.bg, padding]}>{children}</View>;
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: tokens.color.background },
});
