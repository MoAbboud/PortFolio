import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { Screen } from "../../src/components/Screen";
import { tokens } from "../../src/theme/tokens";

export default function Friends() {
  return (
    <Screen>
      <View style={styles.center}>
        <Ionicons name="people-outline" size={56} color={tokens.color.primary} />
        <Text style={styles.title}>Friends</Text>
        <Text style={styles.body}>
          Follow friends and see the adventures they log. Friend connections are coming soon — this
          is where they&apos;ll live.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space(3),
    paddingHorizontal: tokens.space(6),
  },
  title: { fontSize: tokens.font.xl, fontWeight: "800", color: tokens.color.text },
  body: { color: tokens.color.textMuted, textAlign: "center", lineHeight: 21 },
});
