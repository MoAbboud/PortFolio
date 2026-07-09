import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/auth/AuthContext";
import { tokens } from "../../src/theme/tokens";

export default function TabsLayout() {
  const { token, loading } = useAuth();
  const insets = useSafeAreaInsets();

  if (loading) return null;
  if (!token) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tokens.color.primary,
        tabBarInactiveTintColor: tokens.color.textMuted,
        // Lift the bar above the iPhone home-indicator by adding the safe-area inset.
        tabBarStyle: {
          height: 50 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 8,
        },
        headerTitleStyle: { fontWeight: "800" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: "Friends",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="new"
        options={{
          title: "Log an Adventure",
          tabBarLabel: () => null,
          tabBarIcon: () => (
            <View style={styles.plus}>
              <Ionicons name="add" size={30} color={tokens.color.primaryText} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  plus: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tokens.color.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
    shadowColor: tokens.color.primary,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
