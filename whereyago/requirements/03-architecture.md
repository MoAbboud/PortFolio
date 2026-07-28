# whereyago - Architecture

Internal document. Secrets are referred to by the environment variable that supplies them,
never by value.

## Components

whereyago is distributed. Three processes plus a set of third-party services.

```mermaid
flowchart LR
    subgraph device[User device]
        MOB[Mobile app<br/>React Native + Expo]
        SEC[(Secure store<br/>session token)]
        WEB[Embedded web view<br/>map canvas]
    end

    subgraph server[Server]
        API[HTTP API<br/>FastAPI]
        DB[(PostgreSQL)]
    end

    subgraph third[Third-party, keyless]
        TILES[Map tiles]
        GEO[Geocoding]
        WX[Weather]
        MAPS[Maps deep links]
    end

    MOB -->|JSON over HTTPS, bearer token| API
    MOB --> SEC
    MOB --> WEB
    API --> DB
    WEB --> TILES
    MOB -.-> GEO
    MOB -.-> WX
    MOB -.-> MAPS
```

| Component | Runs where | Responsibility |
| --- | --- | --- |
| Mobile app | User's phone | All presentation, session handling, deep links to the maps app |
| Embedded web view | Inside the mobile app | Draws the map and pins; kept in a web view so the map needs no paid native SDK |
| HTTP API | Server | Authentication, authorisation, all reads and writes of adventures |
| PostgreSQL | Server, alongside the API | The only durable store |
| Third-party services | Public internet | Tiles, geocoding, weather, directions handoff |

The browser prototype at `whereyago/index.html` is a fourth, standalone artefact. It talks
to no API and stores nothing on a server. It exists as a design reference and is not part
of the production system.

### Why the split is where it is

The device holds no data it cannot lose. Deleting and reinstalling the app costs the user
their session token and nothing else. Every durable fact lives in PostgreSQL behind the
API, which means the API is the only place authorisation has to be enforced.

## Backend layers

The dependency rule is one way. A layer may call the layer directly below it and nothing
else. Nothing below the API layer knows that HTTP exists.

```mermaid
flowchart TB
    A["api/v1 - routers<br/>request shape, status codes, auth dependency"]
    B["services - business rules<br/>ownership checks, composite writes"]
    C["repositories - persistence protocols and implementations"]
    D["models - SQLAlchemy tables"]
    E["schemas - Pydantic request and response contracts"]

    A --> B --> C --> D
    A -.uses.-> E
    B -.uses.-> E
```

Repositories are defined as protocols first and implemented second, so a service can be
tested against a fake without a database. Settings come from pydantic-settings; the values
behind `SECRET_KEY` and `POSTGRES_PASSWORD` have no defaults, so a misconfigured deployment
fails at startup instead of running insecurely.

## Cross-cutting concerns

| Concern | Where it lives | Behaviour |
| --- | --- | --- |
| Correlation id | Middleware | A correlation id is attached to every request and carried into every log line for that request |
| Structured logging | structlog | Events, not sentences |
| Error persistence | Database sink | Warnings and above are written to a log table, in their own transaction so they survive the request rollback that caused them |
| Unhandled exceptions | Global handler | Logged with the traceback, returned as a generic 500 with no internal detail |
| Password storage | Auth service | Argon2 hash. The plain password never leaves the request handler |
| Session | Auth service | Bearer token, verified per request by a dependency |

## Class diagram - backend

```mermaid
classDiagram
    direction LR

    class AuthService {
        +register(payload) User
        +authenticate(email, password) User
        +issue_token(user) str
    }

    class AdventureService {
        +create_adventure(owner_id, payload) Adventure
        +list_my_adventures(owner_id) Adventure[]
        +get_owned(adventure_id, owner_id) Adventure
        +list_discover() Adventure[]
        +delete_adventure(adventure_id, owner_id) None
    }

    class UserRepository {
        <<Protocol>>
        +get(id) User
        +get_by_username(username) User
        +get_by_email(email) User
        +add(user) User
    }

    class AdventureRepository {
        <<Protocol>>
        +add(adventure) Adventure
        +get(id) Adventure
        +list_by_owner(owner_id) Adventure[]
        +list_shared() Adventure[]
        +delete(adventure) None
    }

    class User {
        +id: int
        +email: str
        +username: str
        +display_name: str
        +hashed_password: str
        +created_at: datetime
    }

    class UserInfo {
        +user_id: int
        +address: str
        +phone: str
        +interests: list
    }

    class Adventure {
        +id: int
        +owner_id: int
        +title: str
        +summary: str
        +vibe: Vibe
        +city: str
        +date: date
        +is_shared: bool
    }

    class Stop {
        +id: int
        +adventure_id: int
        +position: int
        +name: str
        +type: StopType
        +time: str
        +note: str
        +lat: float
        +lon: float
        +event: json
    }

    class Weather {
        +adventure_id: int
        +code: int
        +temp_max: float
        +temp_min: float
        +description: str
    }

    class AdventureStats {
        +adventure_id: int
        +views: int
        +likes_count: int
        +comments_count: int
    }

    class Rating {
        +adventure_id: int
        +user_id: int
        +score: int
    }

    class Like {
        +adventure_id: int
        +user_id: int
    }

    class Comment {
        +adventure_id: int
        +user_id: int
        +body: str
    }

    class LogEntry {
        +level: str
        +message: str
        +error_type: str
        +traceback: str
        +correlation_id: str
    }

    AuthService --> UserRepository
    AdventureService --> AdventureRepository
    UserRepository ..> User
    AdventureRepository ..> Adventure

    User "1" --> "0..*" Adventure : owns
    User "1" --> "0..1" UserInfo
    Adventure "1" --> "0..*" Stop : ordered
    Adventure "1" --> "0..1" Weather
    Adventure "1" --> "0..1" AdventureStats
    Adventure "1" --> "0..*" Rating
    Adventure "1" --> "0..*" Like
    Adventure "1" --> "0..*" Comment
```

`Rating`, `Like` and `Comment` are tables with no endpoints and no screens yet. They exist
so the schema does not have to be migrated again when those features are built.

## Class diagram - mobile

```mermaid
classDiagram
    direction TB

    class ApiClient {
        +request(path, options) T
        -baseUrl: string
    }
    class AuthApi {
        +register(payload) User
        +login(credentials) Token
        +me(token) User
    }
    class AdventuresApi {
        +create(payload, token) Adventure
        +list(token) Adventure[]
        +discover() Adventure[]
        +get(id, token) Adventure
        +remove(id, token) void
    }
    class AuthContext {
        +user: User
        +token: string
        +signIn()
        +signOut()
    }
    class SecureTokenStore {
        +save(token)
        +read() string
        +clear()
    }
    class Geocoder {
        +cityToCoords(city) LatLon
    }
    class ThemeTokens {
        +colors
        +spacing
        +typography
    }
    class AdventureMap {
        +pins: Pin[]
        +onPinPress(id)
    }
    class DayCard
    class Screen
    class Button
    class Input

    AuthApi --> ApiClient
    AdventuresApi --> ApiClient
    AuthContext --> AuthApi
    AuthContext --> SecureTokenStore
    AdventureMap ..> Geocoder : when a stop has no coordinates
    DayCard ..> ThemeTokens
    Screen ..> ThemeTokens
    Button ..> ThemeTokens
    Input ..> ThemeTokens
```

Every network call in the app goes through the single `request` wrapper, so error mapping
and the bearer header live in exactly one place. The token is passed into each call by the
screen, which reads it from the auth context; there is no automatic retry yet. `ThemeTokens`
is the single re-skin point; no component is allowed to hard-code a colour.

## Screen flow

```mermaid
flowchart TB
    START([Launch]) --> HASTOKEN{Session token<br/>in secure store?}
    HASTOKEN -- no --> LOGIN[Login]
    LOGIN --> REG[Register]
    REG --> TABS
    LOGIN --> TABS
    HASTOKEN -- yes --> TABS[Tab shell]

    TABS --> HOME[Home]
    TABS --> FRIENDS[Friends - placeholder]
    TABS --> NEW[Log a day]
    TABS --> INBOX[Inbox - placeholder]
    TABS --> PROFILE[Profile]

    HOME --> SW{View switch}
    SW --> MAPV[Map]
    SW --> LISTV[List]
    SW --> VIDV[Videos - placeholder]

    MAPV --> DETAIL[Day detail]
    LISTV --> DETAIL
    PROFILE --> DETAIL
    NEW --> DETAIL
    DETAIL --> DIRECTIONS[[Maps app]]
```

## Key sequence - logging a day

```mermaid
sequenceDiagram
    actor U as Logger
    participant M as Mobile app
    participant A as API router
    participant S as AdventureService
    participant R as AdventureRepository
    participant DB as PostgreSQL

    U->>M: fill title, vibe, city, date, stops
    M->>A: POST /adventures with bearer token
    A->>A: resolve current user from token
    A->>S: create(owner_id, payload)
    S->>R: add(adventure with ordered stops)
    R->>DB: insert adventure, stops
    S->>R: create stats row, weather row if supplied
    R->>DB: insert stats, weather
    DB-->>R: ids
    R-->>S: adventure
    S-->>A: adventure
    A-->>M: 201 with stops, weather, stats
    M-->>U: day detail screen
```

## Key sequence - browsing and following a day

```mermaid
sequenceDiagram
    actor B as Browser
    participant M as Mobile app
    participant A as API router
    participant DB as PostgreSQL
    participant G as Geocoding service
    participant MAPS as Maps app

    B->>M: open Home, choose map view
    M->>A: GET /adventures/discover
    A->>DB: select shared adventures, newest first
    DB-->>A: rows with stops, weather and stats
    A-->>M: adventure list
    loop each adventure without coordinates
        M->>G: geocode(city)
        G-->>M: lat, lon
    end
    M-->>B: pins on the map
    B->>M: tap a pin
    M-->>B: day detail
    B->>M: tap directions on a stop
    M->>MAPS: deep link
```

## Rules this architecture is meant to protect

- Authorisation is decided in the service layer, never in a component. A router asks who
  the caller is; the service decides what they may touch.
- No secret is ever written in source. `SECRET_KEY`, `POSTGRES_PASSWORD` and the API base
  URL all come from the environment and have no defaults where a default would be unsafe.
- The mobile app is a client. If it were deleted entirely, no data would be lost.
- Every third-party call is optional. A failure downgrades the screen; it does not break it.
- Colours, spacing and type live in one tokens file, so re-skinning the app is one edit.
- Repositories are protocols. A service must be testable without a database running.
