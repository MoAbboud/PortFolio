import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { adventuresApi } from "../../src/api/adventures";
import { AdventureMap, type MapPin } from "../../src/components/AdventureMap";
import { DayCard } from "../../src/components/DayCard";
import { geocodeCity } from "../../src/lib/geocode";
import { tokens } from "../../src/theme/tokens";
import type { Adventure, Vibe } from "../../src/types";

// Pin emoji per "kind of day". Tweak freely to taste.
const VIBE_PIN_EMOJI: Record<Vibe, string> = {
  chill: "🧘",
  foodie: "🍽️",
  family: "👨‍👩‍👧",
  adventure: "⛰️",
  night: "🍸",
  culture: "🏛️",
  outdoors: "🌳",
};

type HomeView = "map" | "list" | "videos";

function firstStopCoord(adventure: Adventure): { lat: number; lon: number } | null {
  for (const stop of adventure.stops) {
    if (typeof stop.lat === "number" && typeof stop.lon === "number") {
      return { lat: stop.lat, lon: stop.lon };
    }
  }
  return null;
}

export default function Home() {
  const router = useRouter();
  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<HomeView>("map");

  const load = useCallback(async () => {
    try {
      setAdventures(await adventuresApi.discover());
    } catch {
      // keep current list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));

  const open = useCallback(
    (adventure: Adventure) =>
      router.push({
        pathname: "/day/[id]",
        params: { id: String(adventure.id), data: JSON.stringify(adventure) },
      }),
    [router],
  );

  return (
    <View style={styles.bg}>
      <Segmented value={view} onChange={setView} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : view === "map" ? (
        <MapTab
          adventures={adventures}
          onOpenId={(id) => {
            const found = adventures.find((a) => a.id === id);
            if (found) open(found);
          }}
        />
      ) : view === "list" ? (
        <FlatList
          style={styles.bg}
          contentContainerStyle={{ padding: tokens.space(4) }}
          data={adventures}
          keyExtractor={(a) => String(a.id)}
          renderItem={({ item }) => <DayCard day={item} onPress={() => open(item)} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
            />
          }
          ListHeaderComponent={<Text style={styles.lead}>Adventures other people loved. Tap one, then go live it.</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No shared adventures yet.</Text>}
        />
      ) : (
        <VideosTab />
      )}
    </View>
  );
}

function MapTab({
  adventures,
  onOpenId,
}: {
  adventures: Adventure[];
  onOpenId: (id: number) => void;
}) {
  const [pins, setPins] = useState<MapPin[]>([]);
  const [locating, setLocating] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLocating(true);
      const result: MapPin[] = [];
      for (const adventure of adventures) {
        let coord = firstStopCoord(adventure);
        if (!coord && adventure.city) coord = await geocodeCity(adventure.city);
        if (coord) {
          result.push({
            id: adventure.id,
            lat: coord.lat,
            lon: coord.lon,
            emoji: VIBE_PIN_EMOJI[adventure.vibe] ?? "📍",
            title: adventure.title,
          });
        }
      }
      if (!cancelled) {
        setPins(result);
        setLocating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adventures]);

  return (
    <View style={styles.bg}>
      <AdventureMap pins={pins} onSelectId={onOpenId} />
      {locating ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Locating adventures…</Text>
        </View>
      ) : pins.length === 0 ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>No mappable adventures yet — add a city when logging.</Text>
        </View>
      ) : null}
    </View>
  );
}

function VideosTab() {
  return (
    <View style={styles.videoCenter}>
      <Ionicons name="videocam-outline" size={56} color={tokens.color.primary} />
      <Text style={styles.videoTitle}>Video guides</Text>
      <Text style={styles.videoBody}>
        A TikTok-style feed of adventure walkthroughs will live here when you&apos;re ready to go
        video-first.
      </Text>
    </View>
  );
}

function Segmented({ value, onChange }: { value: HomeView; onChange: (v: HomeView) => void }) {
  const items: { key: HomeView; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "map", label: "Map", icon: "map-outline" },
    { key: "list", label: "List", icon: "list-outline" },
    { key: "videos", label: "Videos", icon: "videocam-outline" },
  ];
  return (
    <View style={styles.segment}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.segItem, active && styles.segItemActive]}
          >
            <Ionicons
              name={item.icon}
              size={16}
              color={active ? tokens.color.primaryText : tokens.color.textMuted}
            />
            <Text style={[styles.segText, active && styles.segTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: tokens.color.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.background },
  lead: { color: tokens.color.textMuted, marginBottom: tokens.space(4) },
  empty: { color: tokens.color.textMuted, textAlign: "center", marginTop: tokens.space(10) },

  segment: {
    flexDirection: "row",
    gap: tokens.space(2),
    padding: tokens.space(3),
    backgroundColor: tokens.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
  segItem: {
    flex: 1,
    flexDirection: "row",
    gap: tokens.space(1.5),
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space(2),
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.color.surfaceAlt,
  },
  segItemActive: { backgroundColor: tokens.color.primary },
  segText: { fontWeight: "700", color: tokens.color.textMuted, fontSize: tokens.font.sm },
  segTextActive: { color: tokens.color.primaryText },

  overlay: {
    position: "absolute",
    top: tokens.space(3),
    alignSelf: "center",
    backgroundColor: "rgba(22,24,29,0.85)",
    paddingHorizontal: tokens.space(4),
    paddingVertical: tokens.space(2),
    borderRadius: tokens.radius.pill,
  },
  overlayText: { color: "#fff", fontSize: tokens.font.sm, fontWeight: "600" },

  videoCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space(3),
    paddingHorizontal: tokens.space(6),
    backgroundColor: tokens.color.background,
  },
  videoTitle: { fontSize: tokens.font.xl, fontWeight: "800", color: tokens.color.text },
  videoBody: { color: tokens.color.textMuted, textAlign: "center", lineHeight: 21 },
});
