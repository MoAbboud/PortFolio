# roamer

A map of lost animals. An owner drops a pin where their pet was last seen and adds what
would be on the flyer; a finder opens the map, sees who nearby is missing an animal, and
calls. Owners confirm by email, and the site keeps asking whether the animal is still
missing, so the verified badge means the listing is current, not just real.

It will start as a demo: made-up listings, every flow working, nothing reaching a real
person.

**Status: stage 0 of 9.** The scaffold runs and is tested. There is no map yet. The plan, the
user journeys and the reasoning behind each decision are in [requirements/](requirements/).

## Run it

Docker, from PowerShell:

    cd roamer
    docker compose up -d --build
    Invoke-RestMethod http://localhost:8010/health
    docker compose exec web python -m pytest -q -rs

The database is published on 5434 and the app on 8010, so roamer runs beside mailman and
herder, which take 5432 and 8000.

Python, FastAPI, PostgreSQL with the `cube` and `earthdistance` extensions for distance
queries, and, from stage 1, server-rendered pages with Leaflet and OpenStreetMap. No API
keys.
