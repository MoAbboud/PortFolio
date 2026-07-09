/**
 * Free, keyless geocoding via Open-Meteo. Used to place an adventure on the map
 * by its city when its stops have no coordinates. Results are cached in memory.
 */
interface Coord {
  lat: number;
  lon: number;
}

const cache = new Map<string, Coord | null>();

export async function geocodeCity(city: string): Promise<Coord | null> {
  const key = city.trim().toLowerCase();
  if (!key) return null;

  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
    const response = await fetch(url);
    const json = (await response.json()) as {
      results?: { latitude: number; longitude: number }[];
    };
    const first = json.results?.[0];
    const coord: Coord | null = first ? { lat: first.latitude, lon: first.longitude } : null;
    cache.set(key, coord);
    return coord;
  } catch {
    cache.set(key, null);
    return null;
  }
}
