# [Project Rooftop](https://flightsquawk.azurewebsites.net/)

Project Rooftop is a flight tracking web application that aggregates, caches, and visualizes live aircraft transponder data. It provides a real-time tactical radar display for local aircraft traffic alongside search and monitoring interfaces for military flights and emergency transponder squawk codes.

## Tech Stack

The application is structured as a monorepo consisting of decoupled backend and frontend packages.

### Backend
- **Runtime Environment:** Node.js (ES Modules)
- **Web Framework:** Express 5
- **Database:** MongoDB via Mongoose
- **Data Fetching:** Axios (with gzip compression enabled for payload size reduction)
- **Web Server:** Node.js HTTP server serving both the API routes and built frontend assets

### Frontend
- **Framework:** React 19
- **Build Tool / Bundler:** Vite 8
- **Routing:** React Router 7
- **Visualization:** WebGL (using raw GLSL fragment and vertex shaders for the radar sweep rendering)
- **Styling:** Vanilla CSS

### External Data
- **Data Source:** ADSB.lol API v2

---

## How It Works

The system operates via a pull-based caching model to keep external API requests within reasonable thresholds while serving real-time updates to client browsers.

```
                  +--------------------------+
                  |    ADSB.lol API v2       |
                  +-------------+------------+
                                |
                   HTTP GET     | Poll Interval:
                   (JSON/gzip)  | 30s (mil), 60s (civ/radar)
                                v
                  +--------------------------+
                  |      Express Backend     |
                  |                          |
                  |  +--------------------+  |
                  |  |  In-Memory Cache   |  |
                  |  +---------+----------+  |
                  |            |             |
                  |            v             |
                  |  +--------------------+  |      Write (New/Update)
                  |  |  Data Transformer  +------------------------+
                  |  +---------+----------+  |                        |
                  +------------|-------------+                        v
                               |                             +--------+---------+
                               | API Response                |     MongoDB      |
                               v (Transformed JSON)          | (Emergency Logs) |
                  +------------+-------------+               +------------------+
                  |     React Frontend       |
                  |                          |
                  |  +--------------------+  |
                  |  |    WebGL Scope     |  |
                  |  +--------------------+  |
                  +--------------------------+
```

### 1. Backend Polling and Caching
To minimize load on the upstream API and ensure low latency for client requests, the backend maintains an in-memory cache of transponder data. It runs background timers to poll ADSB.lol endpoints at set intervals:
- **Military Feeds:** Polled every 30 seconds from `/v2/mil`.
- **Emergency Feeds:** Polled every 60 seconds from `/v2/sqk/7500,7600,7700`.
- **Local Radar Feeds:** Polled every 60 seconds from `/v2/lat/{lat}/lon/{lon}/dist/{dist}`. Polling is lazy-initialized, beginning only when the first client requests radar data for a specific location.

### 2. Data Transformation
Raw JSON payloads returned from the transponder API contain detailed telemetry and status bitfields. The backend parses and maps these payload objects into simplified models prior to caching or client transmission:
- **Database Flags Evaluation:** Uses bitwise operations (`dbFlags & 1`) to classify military versus civilian aircraft.
- **Transponder Squawk Categorization:** Checks transponder codes against specific emergency channels:
  - `7500`: Unlawful interference / hijacking
  - `7600`: Radio communication failure
  - `7700`: General emergency
- **Telemetry Formatting:** Converts barometric altitude, coordinates, and signal strength (RSSI) into standardized, human-readable strings.

### 3. Database Persistence
When emergency transponder squawk codes (`7500`, `7600`, or `7700`) are captured in the emergency feed, the backend persists them to MongoDB.
- **Deduplication:** The backend queries the database for existing logs matching the aircraft's ICAO hex code and squawk code within the last 30 minutes. If found, it updates the `lastSeenAt` timestamp. Otherwise, it inserts a new record.
- **TTL Deletion:** A Time-To-Live index automatically purges historical records after 180 days (6 months) to control database size.

### 4. Client Presentation and WebGL Rendering
The React frontend query endpoints exposed by the backend to drive the tactical display:
- **Local Radar Screen:** Coordinates returned from the HTML5 Geolocation API are sent to the backend. The frontend positions aircraft blips as absolute-positioned DOM nodes overlaying a WebGL canvas. A custom fragment shader renders a sweeping, green phosphor radar scope effect complete with persistence decay (trailing glow) based on the elapsed render loop time.
- **Adaptive Range Scaling:** The radar view automatically adjusts its range radius (clamped between 5 and 250 nautical miles) based on target density. If the screen is crowded, the radius decreases; if contacts are scarce, the radius expands.
- **Incident Lists & Search:** Dedicated interfaces display active and historical incident records. Clients can filter and search across live in-memory caches and historical database records via search inputs.
