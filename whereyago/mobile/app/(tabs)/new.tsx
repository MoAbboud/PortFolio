import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ApiError } from "../../src/api/client";
import { daysApi } from "../../src/api/days";
import { useAuth } from "../../src/auth/AuthContext";
import { Button } from "../../src/components/Button";
import { Input } from "../../src/components/Input";
import { Screen } from "../../src/components/Screen";
import { tokens } from "../../src/theme/tokens";
import { STOP_TYPES, VIBES, type Stop, type StopType, type Vibe } from "../../src/types";

type DraftStop = Omit<Stop, "id" | "position">;

export default function NewDay() {
  const router = useRouter();
  const { token } = useAuth();

  const [title, setTitle] = useState("");
  const [city, setCity] = useState("");
  const [vibe, setVibe] = useState<Vibe>("chill");
  const [stops, setStops] = useState<DraftStop[]>([]);
  const [saving, setSaving] = useState(false);

  // Draft for the next stop.
  const [stopName, setStopName] = useState("");
  const [stopType, setStopType] = useState<StopType>("restaurant");
  const [stopTime, setStopTime] = useState("");

  function addStop() {
    if (!stopName.trim()) {
      Alert.alert("Name the stop first");
      return;
    }
    setStops((prev) => [...prev, { name: stopName.trim(), type: stopType, time: stopTime.trim() || null }]);
    setStopName("");
    setStopTime("");
    setStopType("restaurant");
  }

  function removeStop(index: number) {
    setStops((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    if (!token) return;
    if (!title.trim()) {
      Alert.alert("Name your day first");
      return;
    }
    if (stops.length === 0) {
      Alert.alert("Add at least one stop");
      return;
    }
    setSaving(true);
    try {
      await daysApi.create(
        {
          title: title.trim(),
          city: city.trim() || null,
          vibe,
          summary: stops.slice(0, 3).map((s) => s.name).join(" → "),
          stops,
        },
        token,
      );
      Alert.alert("Saved!", "Your day is now in My Days.");
      router.replace("/(tabs)/days");
    } catch (error) {
      Alert.alert("Couldn't save", error instanceof ApiError ? error.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll>
      <Input label="Name this day" value={title} onChangeText={setTitle} placeholder="Best lazy Sunday in KC" />
      <Input label="City / area" value={city} onChangeText={setCity} placeholder="Kansas City, MO" />

      <Text style={styles.label}>What kind of day?</Text>
      <View style={styles.chipWrap}>
        {VIBES.map((v) => (
          <Chip key={v.key} label={`${v.emoji} ${v.label}`} active={vibe === v.key} onPress={() => setVibe(v.key)} />
        ))}
      </View>

      <View style={styles.divider} />

      <Text style={styles.section}>Add a stop</Text>
      <Input label="Place name" value={stopName} onChangeText={setStopName} placeholder="Kansas City Zoo" />
      <Text style={styles.label}>Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
        {STOP_TYPES.map((t) => (
          <Chip key={t.key} label={t.label} active={stopType === t.key} onPress={() => setStopType(t.key)} />
        ))}
      </ScrollView>
      <Input label="Time (HH:MM, optional)" value={stopTime} onChangeText={setStopTime} placeholder="10:00" />
      <Button title="Add stop" variant="ghost" onPress={addStop} />

      {stops.length > 0 ? (
        <View style={styles.list}>
          {stops.map((s, i) => (
            <View key={`${s.name}-${i}`} style={styles.stopRow}>
              <Text style={styles.stopText}>
                {i + 1}. {s.name}
                {s.time ? `  ·  ${s.time}` : ""}
              </Text>
              <Pressable onPress={() => removeStop(i)}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.divider} />
      <Button title="Save day" onPress={save} loading={saving} />
      <View style={{ height: tokens.space(8) }} />
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: tokens.font.sm, fontWeight: "600", color: tokens.color.text, marginBottom: tokens.space(2) },
  section: { fontSize: tokens.font.lg, fontWeight: "700", color: tokens.color.text, marginBottom: tokens.space(3) },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space(2), marginBottom: tokens.space(2) },
  typeRow: { gap: tokens.space(2), paddingVertical: tokens.space(1), marginBottom: tokens.space(3) },
  chip: {
    paddingHorizontal: tokens.space(3),
    paddingVertical: tokens.space(2),
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: tokens.color.surface,
  },
  chipActive: { backgroundColor: tokens.color.primary, borderColor: tokens.color.primary },
  chipText: { color: tokens.color.text, fontSize: tokens.font.sm, fontWeight: "600" },
  chipTextActive: { color: tokens.color.primaryText },
  divider: { height: 1, backgroundColor: tokens.color.border, marginVertical: tokens.space(5) },
  list: { marginTop: tokens.space(3), gap: tokens.space(2) },
  stopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.md,
    padding: tokens.space(3),
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  stopText: { color: tokens.color.text, flex: 1 },
  remove: { color: tokens.color.danger, fontWeight: "600" },
});
