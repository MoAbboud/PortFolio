# 📍 whereyago — Days worth copying

A day-logger for people who **can't plan a trip** — so they don't have to. Extroverts and planners log the great day they actually had (stop by stop), and everyone else browses real itineraries — with the map, the route, the weather, the reviews and the events — then goes and lives them.

> *"Someone already planned your perfect day. Go live it."*

## ✨ What Is This?

Two sides, one app:

- **Loggers** record a day they had: Walmart → the zoo → that BBQ place → ice cream. Each stop gets a time, a type, a note, and gets pinned on a map.
- **Planners-who-can't-plan** open **Discover**, filter by the *kind* of day they want (Chill, Foodie, Family, Adventure, Night Out, Culture, Outdoors), pick one, and hit **Recreate this day**.

Every day shows:
- 🗺️ **An interactive map + route** through all the stops
- 🌤️ **The weather** that day (real data)
- ⭐ **Google reviews** for each restaurant/place (one tap)
- 🎟️ **Event details** for shows/concerts
- 🧭 **One-tap directions** through the entire day

## 🎯 Features

- **Discover feed** — sample inspiring days, filterable by vibe
- **Day detail** — full timeline, map with numbered pins + dashed route, weather card, per-stop Reviews/Map links, event cards, "Get directions for the whole day"
- **Log a Day builder** — add stops in order, auto-locate them on the map, live weather forecast, reorder/remove, save
- **My Days** — your logged days (saved in your browser), with **Share to Discover** and delete
- **Recreate this day** — clones any day into your planner to make it your own
- **Mobile friendly**, single file, zero build step

## 🆓 No API keys, no backend, no cost

Everything runs on free, keyless, browser-friendly services — so it deploys to any static host for **$0**:

| Need | Service used | Key required? |
|------|--------------|---------------|
| Maps + route lines | **Leaflet + OpenStreetMap** | ❌ No |
| Weather (real) | **Open-Meteo** | ❌ No |
| Place lookup / pin a stop | **Nominatim (OSM)** | ❌ No |
| Reviews & directions | **Google Maps deep-links** | ❌ No |

> **About Google Maps & "real" Google reviews:** showing Google's *own* review text/photos *inside* the app requires the Google Places API (an API key **and** a billing account). To keep this free, whereyago links straight to the place on Google Maps instead — one tap, same reviews, no key. Same story for native Apple Maps and ticketed-event APIs (Ticketmaster/Eventbrite). See the roadmap below for the paid upgrade path.

## 🚀 Quick Start

1. Open **`index.html`** in any browser.
2. **Discover** → browse sample days, filter by vibe, open one.
3. **Log a Day** → name it, set the date + city, add stops (they auto-pin), save.
4. **My Days** → your saved days; share one to Discover or delete it.

That's it — no install, no accounts.

## 💾 Data Storage

Your logged days are stored in your browser's **localStorage** (key: `whereyago_mydays`):
- No backend, no database, works offline after first load
- Persists between sessions; each browser/device is independent
- The **Discover** feed = built-in sample days + any of *your* days you tap "Share to Discover" on (also local)

**To back up:** DevTools (F12) → Application → Local Storage → copy the `whereyago_mydays` value.

## 📦 Deployment

Same as the rest of the portfolio — it's just static files:
- **Render / Netlify / Vercel / GitHub Pages** — drop the `whereyago/` folder, no build command, publish directory `.`
- **Local** — just open `index.html`

## 🛣️ Roadmap — going from demo to product

When you're ready to make Discover a *real shared community* (not just local), here's the upgrade path, cheapest first:

1. **Shared feed (backend)** — a tiny Firebase/Supabase project so days logged by one person show up for everyone. Free tiers cover early usage.
2. **Real Google reviews + ratings inline** — Google **Places API** (key + billing; has a monthly free credit). Swap the deep-links for live ratings, photos, hours, price level.
3. **Real event listings** — **Ticketmaster Discovery API** / **Eventbrite API** to auto-fill concerts, games, theatre with dates, prices and ticket links.
4. **Autocomplete for place names** — Google Places Autocomplete or the free **Photon** geocoder, so stops resolve perfectly as you type.
5. **Accounts + saving across devices** — sign-in, follow loggers, like/save days.
6. **"Plan it for me"** — generate a fresh day from a vibe + city + budget (this is where an LLM fits naturally).
7. **Native app** — wrap as a PWA or React Native; add Apple Maps on iOS.

## 🧭 What kinds of days?

🌿 Chill · 🍜 Foodie · 👨‍👩‍👧 Family · 🏔️ Adventure · 🌃 Night Out · 🎭 Culture · 🌅 Outdoors

Sample data is set in Kansas City, MO — change the stops to anywhere; the maps, weather and reviews all follow the coordinates.

---

Made with 📍 for people who'd rather *go* than *plan*.
