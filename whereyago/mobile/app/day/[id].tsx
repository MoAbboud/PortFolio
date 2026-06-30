import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";

import { adventuresApi } from "../../src/api/adventures";
import { ApiError } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { Button } from "../../src/components/Button";
import { tokens } from "../../src/theme/tokens";
import { VIBES, type Adventure } from "../../src/types";

function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export default function DayDetail() {
  const router = useRouter();
  const { token, user } = useAuth();
  const params = useLocalSearchParams<{ id: string; data?: string }>();
  const [deleting, setDeleting] = useState(false);

  const day = useMemo<Adventure | null>(() => {
    if (!params.data) return null;
    try {
      return JSON.parse(params.data) as Adventure;
    } catch {
      return null;
    }
  }, [params.data]);

  if (!day) {
    return (
      <View style={styles.center}>
        <Text style={{ color: tokens.color.textMuted }}>Couldn&apos;t load this day.</Text>
      </View>
    );
  }

  const owned = user != null && user.id === day.owner_id;
  const vibe = VIBES.find((v) => v.key === day.vibe);
  const cityHint = day.city ?? "";

  async function remove() {
    if (!token || !day) return;
    setDeleting(true);
    try {
      await adventuresApi.remove(day.id, token);
      router.back();
    } catch (error) {
      Alert.alert("Couldn't delete", error instanceof ApiError ? error.message : "Something went wrong.");
      setDeleting(false);
    }
  }

  return (
    <ScrollView style={styles.bg} contentContainerStyle={{ padding: tokens.space(4) }}>
      <Stack.Screen options={{ title: day.title }} />

      <Text style={styles.title}>{day.title}</Text>
      <Text style={styles.meta}>
        {vibe ? `${vibe.emoji} ${vibe.label}` : day.vibe}
        {day.city ? `  ·  ${day.city}` : ""}
      </Text>
      {day.summary ? <Text style={styles.summary}>{day.summary}</Text> : null}

      <Text style={styles.section}>Itinerary</Text>
      {day.stops.map((stop, index) => (
        <View key={stop.id ?? index} style={styles.stop}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{index + 1}</Text>
          </View>
          <View style={styles.stopBody}>
            <Text style={styles.stopName}>{stop.name}</Text>
            <Text style={styles.stopMeta}>
              {stop.type}
              {stop.time ? `  ·  ${stop.time}` : ""}
            </Text>
            {stop.note ? <Text style={styles.note}>{stop.note}</Text> : null}
            <View style={styles.links}>
              <Text style={styles.link} onPress={() => void Linking.openURL(mapsUrl(`${stop.name} ${cityHint}`))}>
                ★ Reviews
              </Text>
              <Text style={styles.link} onPress={() => void Linking.openURL(mapsUrl(`${stop.name} ${cityHint}`))}>
                📍 Open in Maps
              </Text>
            </View>
          </View>
        </View>
      ))}

      {owned ? (
        <View style={{ marginTop: tokens.space(6) }}>
          <Button title="Delete this day" variant="danger" onPress={remove} loading={deleting} />
        </View>
      ) : null}
      <View style={{ height: tokens.space(8) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: tokens.color.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.background },
  title: { fontSize: tokens.font.xxl, fontWeight: "800", color: tokens.color.text },
  meta: { color: tokens.color.textMuted, marginTop: tokens.space(1), textTransform: "capitalize" },
  summary: { color: tokens.color.text, marginTop: tokens.space(3), lineHeight: 21 },
  section: { fontSize: tokens.font.lg, fontWeight: "700", color: tokens.color.text, marginTop: tokens.space(6), marginBottom: tokens.space(3) },
  stop: { flexDirection: "row", gap: tokens.space(3), marginBottom: tokens.space(4) },
  badge: {
    width: 30,
    height: 30,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: tokens.color.primaryText, fontWeight: "700" },
  stopBody: { flex: 1 },
  stopName: { fontSize: tokens.font.md, fontWeight: "700", color: tokens.color.text },
  stopMeta: { color: tokens.color.textMuted, marginTop: 2, textTransform: "capitalize" },
  note: { color: tokens.color.text, marginTop: tokens.space(1) },
  links: { flexDirection: "row", gap: tokens.space(4), marginTop: tokens.space(2) },
  link: { color: tokens.color.primary, fontWeight: "600" },
});
