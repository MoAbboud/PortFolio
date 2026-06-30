import { Pressable, StyleSheet, Text, View } from "react-native";

import { tokens } from "../theme/tokens";
import { VIBES, type Adventure } from "../types";

function vibeEmoji(vibe: string): string {
  return VIBES.find((v) => v.key === vibe)?.emoji ?? "📍";
}

export function DayCard({ day, onPress }: { day: Adventure; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <Text style={styles.title}>{day.title}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.badge}>
          {vibeEmoji(day.vibe)} {day.vibe}
        </Text>
        {day.city ? <Text style={styles.muted}>📍 {day.city}</Text> : null}
      </View>
      {day.summary ? (
        <Text style={styles.summary} numberOfLines={2}>
          {day.summary}
        </Text>
      ) : null}
      <Text style={styles.muted}>
        {day.stops.length} {day.stops.length === 1 ? "stop" : "stops"}
        {day.is_shared ? "  ·  shared" : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space(4),
    marginBottom: tokens.space(3),
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  pressed: { opacity: 0.8 },
  title: { fontSize: tokens.font.lg, fontWeight: "700", color: tokens.color.text },
  metaRow: { flexDirection: "row", alignItems: "center", gap: tokens.space(2), marginTop: tokens.space(1.5) },
  badge: {
    fontSize: tokens.font.xs,
    fontWeight: "700",
    color: tokens.color.primary,
    backgroundColor: tokens.color.surfaceAlt,
    paddingHorizontal: tokens.space(2),
    paddingVertical: tokens.space(1),
    borderRadius: tokens.radius.pill,
    textTransform: "capitalize",
  },
  summary: { color: tokens.color.text, marginTop: tokens.space(2), lineHeight: 20 },
  muted: { color: tokens.color.textMuted, fontSize: tokens.font.sm, marginTop: tokens.space(2) },
});
