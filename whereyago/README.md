# whereyago

whereyago is a day logger for people who are bad at planning days out. Someone who had a
good day records it stop by stop, and someone who cannot decide what to do browses those
real days and copies one. The unit of content is a whole day, an ordered list of stops,
rather than a single place.

## What is in this folder

- `mobile/` is the app people use. It is built with React Native and Expo and talks to the
  backend over HTTP.
- `backend/` is the API and database, built with FastAPI and PostgreSQL and run with Docker.
- `requirements/` is the written specification: what the app is, how it is used, the
  architecture, the data model, and the task list. Start there if you are new to the project.
- `index.html` is an earlier browser-only prototype. It runs from the single file with no
  account and no server, and it is kept as a design reference rather than a working product.

## Status

The backend works as a vertical slice. You can register, log in, and create, list, read and
delete adventures against PostgreSQL, with tests, linting and strict type checking passing.
The mobile app has login and registration, a five-tab layout, a form that logs a real
adventure, a profile that lists your own, and a Home screen that can show the shared feed as
a map or a list.

The main missing piece is sharing. There is no endpoint yet to mark a day public, so the
feed is empty in practice. Likes, comments and ratings have database tables but no endpoints
or screens. See `requirements/00-plan.md` for the current gap and `requirements/05-tasks.md`
for the ordered task list.

## Running it

The backend and the app run separately, and each folder has its own README with the details.
The short version:

Backend. From `backend/`, copy `.env.example` to `.env` and fill in the secret and the
database password, then run `docker compose up`. The API serves on port 8000, and Adminer, a
web database browser, on port 8080.

Mobile. From `mobile/`, copy `.env.example` to `.env` and point `EXPO_PUBLIC_API_URL` at your
computer's address on the local network, then run `npx expo start` and open the app in Expo
Go on your phone. A phone cannot reach the backend at `localhost`, so that address matters;
`mobile/README.md` explains it.

## External services

The project stays free by using services that need no API key. Map tiles come from
OpenStreetMap, weather and geocoding from Open-Meteo, and directions and reviews are deep
links into whatever maps app the phone already has. Native Apple or Google maps, and Google
reviews shown inside the app, would need a billed API key, so they are avoided on purpose.

## Kinds of day

A day is tagged with one vibe: chill, foodie, family, adventure, night, culture or outdoors.
On the map each vibe gets its own pin.
