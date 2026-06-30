/**
 * Shared domain types. These mirror the backend's Pydantic schemas so the API
 * client is fully typed end-to-end.
 */

export type Vibe =
  | "chill"
  | "foodie"
  | "family"
  | "adventure"
  | "night"
  | "culture"
  | "outdoors";

export type StopType =
  | "restaurant"
  | "cafe"
  | "event"
  | "attraction"
  | "outdoors"
  | "shop"
  | "bar"
  | "other";

export interface Stop {
  id?: number;
  position?: number;
  name: string;
  type: StopType;
  time?: string | null;
  note?: string | null;
  lat?: number | null;
  lon?: number | null;
  event?: Record<string, unknown> | null;
}

export interface Day {
  id: number;
  owner_id: number;
  title: string;
  summary?: string | null;
  vibe: Vibe;
  city?: string | null;
  date?: string | null;
  weather?: Record<string, unknown> | null;
  is_shared: boolean;
  stops: Stop[];
}

export interface DayCreate {
  title: string;
  summary?: string | null;
  vibe: Vibe;
  city?: string | null;
  date?: string | null;
  weather?: Record<string, unknown> | null;
  stops: Array<Omit<Stop, "id" | "position">>;
}

export interface User {
  id: number;
  email: string;
  username: string;
  display_name?: string | null;
}

export const VIBES: { key: Vibe; label: string; emoji: string }[] = [
  { key: "chill", label: "Chill", emoji: "🌿" },
  { key: "foodie", label: "Foodie", emoji: "🍜" },
  { key: "family", label: "Family", emoji: "👨‍👩‍👧" },
  { key: "adventure", label: "Adventure", emoji: "🏔️" },
  { key: "night", label: "Night Out", emoji: "🌃" },
  { key: "culture", label: "Culture", emoji: "🎭" },
  { key: "outdoors", label: "Outdoors", emoji: "🌅" },
];

export const STOP_TYPES: { key: StopType; label: string }[] = [
  { key: "restaurant", label: "Restaurant" },
  { key: "cafe", label: "Café / Brunch" },
  { key: "event", label: "Event / Show" },
  { key: "attraction", label: "Attraction" },
  { key: "outdoors", label: "Outdoors / Park" },
  { key: "shop", label: "Shopping" },
  { key: "bar", label: "Bar / Nightlife" },
  { key: "other", label: "Other" },
];
