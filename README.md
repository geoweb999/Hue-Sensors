# Hue Temperature Dashboard

A real-time web application that monitors and visualizes temperature, light levels, and motion data from Philips Hue motion sensors.

![Dashboard Preview](https://img.shields.io/badge/Node.js-18+-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## Overview

This dashboard continuously polls your Philips Hue Bridge to collect environmental data from Hue motion sensors. It displays current conditions and historical trends through interactive graphs, making it easy to monitor temperature patterns and occupancy in different rooms of your home.

### Key Features

- **Real-time Monitoring**: Continuously polls Hue Bridge at configurable intervals (default: 10 seconds)
- **Temperature Tracking**: Displays temperature in Fahrenheit with complete historical data
- **Motion Detection**: Visual indicators showing current motion status and when motion was last detected
- **Light Level Monitoring**: Displays ambient light levels in lux
- **Lights Dashboard**: View and control all Hue lights — toggle power, adjust brightness, pick colors, and set color temperature
- **Interactive Graphs**: Auto-scaling temperature charts with motion events highlighted as green dots
- **Smart Data Sampling**: Automatic sampling strategies (hourly/15-min/all) optimize performance for large datasets
- **Time Range Controls**: Quick-select buttons for viewing 1-hour, 1-day, 7-day, 30-day, or auto-selected ranges
- **Horizontal Scrolling**: Charts expand horizontally for comfortable data viewing with scroll support
- **Dark Mode**: Light/dark theme toggle with persistent preference across pages
- **Configurable Settings**: Admin panel to adjust poll rate and y-axis scaling
- **Persistent Data**: All data stored in SQLite database - survives application restarts
- **Mobile Responsive**: Optimized layout for iPhone, iPad, and desktop — charts fit the screen on mobile devices

## Architecture

### Backend (Node.js + Express)

```
src/
├── config.js          # Environment configuration and validation
├── database.js        # SQLite database operations and persistence
├── dataStore.js       # In-memory cache + database integration
├── hueClient.js       # Philips Hue Bridge API integration
└── api/
    └── routes.js      # REST API endpoints for frontend
```

**Key Components:**

- **Hue Client**: Connects to Hue Bridge via HTTPS, fetches sensor data, and matches temperature/motion/light sensors from the same physical device
- **Database Layer**: SQLite database with better-sqlite3 for persistent storage of all readings
- **Data Store**: Maintains in-memory cache of all readings for fast access, writes to database on each poll
- **API Layer**: Provides REST endpoints for room lists, detailed historical data, and database statistics
- **Polling Service**: Background service that queries Hue Bridge at configured intervals

### Frontend (Vanilla HTML/CSS/JavaScript)

```
public/
├── index.html         # Temperature dashboard page
├── lights.html        # Lights control dashboard page
├── css/
│   └── styles.css     # Responsive styling, dark mode, modal components
└── js/
    ├── app.js         # Temperature dashboard logic, Chart.js integration
    ├── lights.js      # Lights dashboard logic, color conversion, live control
    └── theme.js       # Light/dark mode toggle with localStorage persistence
```

**Key Components:**

- **Temperature Dashboard**: Grid layout displaying room cards with current readings, Chart.js graphs, and time range selectors
- **Lights Dashboard**: Room-grouped light cards with color swatches, click-to-control modal with power toggle, brightness slider, color picker, and color temperature slider
- **Dark Mode**: Toggle button with sun/moon icons, persists via localStorage, CSS uses `[data-theme="dark"]` selectors
- **Settings Modal**: Admin interface for configuring poll rate and y-axis scaling
- **Time Range Controls**: Per-room buttons to select data range (Auto/30d/7d/1d/1h)
- **Smart Sampling**: Automatic data decimation based on time range for optimal performance
- **Auto-refresh**: Temperature page polls every 10s (configurable), lights page polls every 5s
- **LocalStorage**: Persists user settings (poll rate, y-axis scaling, time range, theme) across sessions
- **Mobile Optimized**: Responsive header, single-column cards, touch-friendly buttons, canvas replacement to prevent Chart.js width overflow

## Installation & Setup

### Prerequisites

- Node.js 18.0 or higher
- Philips Hue Bridge with motion sensors
- Hue Bridge IP address and API token

### Getting Your Hue API Token

1. Find your Hue Bridge IP address (check your router or use the Hue app)
2. Create an API user:
   ```bash
   # Press the link button on your Hue Bridge, then run:
   curl -X POST http://<BRIDGE_IP>/api -d '{"devicetype":"hue_temperature_tracker"}'
   ```
3. Copy the username/token from the response

### Installation Steps

1. **Clone or download the project**
   ```bash
   cd /Users/studio/hue
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Edit the `.env` file with your Hue Bridge details:
   ```env
   HUE_BRIDGE_IP=10.0.18.144
   HUE_API_TOKEN=your-api-token-here
   POLL_INTERVAL=10000
   SERVER_PORT=3000
   NODE_ENV=development

   # Database configuration
   DB_PATH=./data/hue-sensors.db
   ```

4. **Start the application**
   ```bash
   npm start
   ```

5. **Access the dashboard**

   - Temperature: `http://localhost:3000`
   - Lights: `http://localhost:3000/lights.html`

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HUE_BRIDGE_IP` | IP address of your Hue Bridge | Required |
| `HUE_API_TOKEN` | API username/token for authentication | Required |
| `POLL_INTERVAL` | How often to poll the bridge (milliseconds) | 10000 (10s) |
| `SERVER_PORT` | Port for the web server | 3000 |
| `NODE_ENV` | Environment mode | development |
| `DB_PATH` | Path to SQLite database file | ./data/hue-sensors.db |

### Runtime Settings

**Global Settings** - Click the gear icon (⚙️) in the upper right to access:

- **Poll Rate**: Adjust how frequently the bridge is polled (1-300 seconds)
- **Y-Axis Scaling**:
  - Auto-scaling: Charts automatically adjust to temperature range
  - Manual: Set fixed upper and lower bounds in °F

**Per-Room Time Range Controls** - Buttons on each room card:

- **Auto**: Intelligent sampling based on data age (default)
  - > 7 days: Shows 30 days, hourly samples
  - 1-7 days: Shows 7 days, 15-minute samples
  - < 1 day: Shows all data
- **30 Days**: Last 30 days with hourly sampling
- **7 Days**: Last 7 days with 15-minute sampling
- **1 Day**: Last 24 hours with all data points
- **1 Hour**: Last 60 minutes with all data points

All settings are saved to browser localStorage and persist across sessions.

### Time Range Controls & Data Sampling

The dashboard automatically optimizes graph performance when you have accumulated weeks of data:

**How It Works:**

1. **Auto Mode (Default)**: The system analyzes your oldest data point and intelligently chooses the best sampling strategy:
   - If oldest data is **> 7 days old**: Display last 30 days with 1 reading per hour
   - If oldest data is **1-7 days old**: Display last 7 days with 1 reading per 15 minutes
   - If oldest data is **< 1 day old**: Display all available data points

2. **Manual Override**: Use the time range buttons on each room card to manually select:
   - **30 Days**: Shows last 30 days, sampled hourly (720 data points max)
   - **7 Days**: Shows last 7 days, sampled every 15 minutes (672 data points max)
   - **1 Day**: Shows last 24 hours, all data points (~8,640 points max at 10s polling)
   - **1 Hour**: Shows last 60 minutes, all data points (~360 points at 10s polling)

3. **Horizontal Scrolling** (Desktop): Charts automatically expand horizontally (minimum 8 pixels per data point) with native scrollbar support for comfortable navigation through dense datasets. On mobile, charts fit the screen width automatically.

**Performance Benefits:**

- **Before**: Rendering weeks of data (50,000+ points) caused slow page loads and sluggish interactions
- **After**: Smart sampling reduces rendering to 500-8,000 points while preserving data trends
- Graphs load instantly, scroll smoothly, and remain responsive even with months of historical data

**Data Integrity:**

- Sampling only affects visualization - all raw data remains stored in the database
- You can always view more granular data by selecting a shorter time range
- Export features (if implemented) will include all unsampled data

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms` | GET | List all rooms with current readings |
| `/api/rooms/:roomId` | GET | Detailed room data with full history |
| `/api/lights` | GET | All lights grouped by room with state/color info |
| `/api/lights/:id/state` | PUT | Control a light (on, bri, hue, sat, xy, ct, effect, alert, transitiontime) |
| `/api/health` | GET | Health check and last poll timestamp |
| `/api/stats` | GET | Database statistics (total readings, size, data range) |

## Data Flow

```
┌─────────────────────────────────────────┐
│ Hue Bridge (every 10s)                  │
│  ├─ Temperature sensors                 │
│  ├─ Motion sensors (presence)           │
│  └─ Light sensors (lux)                 │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ Backend Polling Service                 │
│  ├─ Matches sensors by device ID        │
│  ├─ Converts units (C→F, lightlevel→lux)│
│  └─ Stores in dataStore                 │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ Data Store (Dual Layer)                 │
│  ├─ In-Memory Cache (fast access)       │
│  └─ SQLite Database (persistence)       │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ REST API                                │
│  └─ Serves data to frontend             │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│ Frontend Dashboards                     │
│  ├─ Temperature: updates every 10s      │
│  │   ├─ Renders temperature graphs      │
│  │   └─ Shows motion/lux indicators     │
│  └─ Lights: updates every 5s            │
│      ├─ Shows light states and colors   │
│      └─ Sends control commands (PUT)    │
└─────────────────────────────────────────┘

On Server Restart:
SQLite Database → Data Store → Graphs populated with historical data
```

## Temperature Graph Features

- **Smart Data Sampling**: Automatic sampling strategies optimize display of large datasets
  - **Auto mode**: Intelligently selects sampling based on data age
    - > 7 days of data: Shows 30 days with hourly samples
    - 1-7 days of data: Shows 7 days with 15-minute samples
    - < 1 day of data: Shows all data points
  - **Manual control**: Quick-select buttons for 30-day, 7-day, 1-day, 1-hour, or auto ranges
- **Horizontal Scrolling** (Desktop): Charts expand horizontally (8px per data point) with native scrollbar support
- **Mobile Fit**: On screens ≤768px, charts fit within the viewport — canvas element is replaced on each render to prevent Chart.js width leaks
- **Auto-scaling X-axis**: Automatically adjusts time labels based on data range
- **Smart Time Labels**:
  - < 12 hours: Shows time only (10:30 AM)
  - 12 hours - 3 days: Shows date + time (Jan 10, 10:30 AM)
  - > 3 days: Shows date only (Jan 10)
- **Motion Indicators**: Green dots on graph when motion was detected during that reading
- **Adaptive Point Sizes**: Points scale down as data accumulates for better visibility
- **Performance Optimized**:
  - Smart sampling reduces rendering load for weeks of data
  - Decimation enabled for datasets > 1000 points
  - Animation disabled for large datasets
  - Smooth rendering even with weeks of historical data

## Development

### Project Structure

```
hue/
├── package.json           # Dependencies and scripts
├── .env                   # Environment configuration (not in git)
├── .gitignore            # Git ignore rules
├── server.js             # Express server entry point
├── CLAUDE.md             # Architecture reference for AI sessions
├── data/
│   └── hue-sensors.db    # SQLite database (auto-created)
├── src/                  # Backend source code
│   ├── config.js         # Environment configuration loader
│   ├── database.js       # SQLite schema and CRUD operations
│   ├── dataStore.js      # In-memory cache + database sync
│   ├── hueClient.js      # Hue Bridge HTTPS client
│   └── api/
│       └── routes.js     # REST API endpoints
└── public/               # Frontend static files
    ├── index.html        # Temperature dashboard
    ├── lights.html       # Lights control dashboard
    ├── css/
    │   └── styles.css    # All styles + dark mode + responsive
    └── js/
        ├── app.js        # Temperature dashboard logic
        ├── lights.js     # Lights dashboard logic
        └── theme.js      # Dark/light theme toggle
```

### Development Mode

The application includes a `dev` script using Node's `--watch` flag for auto-restart:

```bash
npm run dev
```

### Data Persistence & Storage

The application uses a dual-layer storage system:

**In-Memory Cache:**
- All readings kept in memory for fast access
- A typical room generates ~360 readings/hour = ~8.6K readings/day
- Memory usage: ~50 bytes per reading, so 10 rooms for a week ≈ 30MB in RAM

**SQLite Database:**
- All readings automatically persisted to disk
- Data survives application restarts
- Database file grows ~1-2 MB per week for 10 rooms
- Located at `./data/hue-sensors.db` by default
- Uses WAL mode for better performance

**Benefits:**
- Historical data preserved across restarts
- Fast in-memory access for real-time queries
- Automatic backup capability (just copy the .db file)
- Can run indefinitely without data loss

### Database Schema

The SQLite database uses three main tables:

**rooms** - Stores room metadata
- `room_id` (TEXT, PRIMARY KEY)
- `room_name` (TEXT)
- `created_at`, `updated_at` (INTEGER timestamps)

**readings** - Stores all sensor readings
- `id` (INTEGER, AUTO INCREMENT)
- `room_id` (TEXT, FOREIGN KEY)
- `timestamp` (INTEGER)
- `temperature` (REAL in Celsius)
- `lux` (INTEGER, light level)
- `motion_detected` (INTEGER, 0/1 boolean)
- `last_motion_timestamp` (TEXT)
- Indexed on `(room_id, timestamp)` for fast queries

**metadata** - Stores application metadata
- `key` (TEXT, PRIMARY KEY)
- `value` (TEXT)

## Troubleshooting

### "No temperature sensors found"

- Verify your Hue Bridge IP is correct
- Check that your API token is valid
- Ensure you have Hue motion sensors (which include temperature sensors)
- Test API access: `curl -k https://<BRIDGE_IP>/api/<TOKEN>/sensors`

### Graphs not displaying

- Check browser console for errors (F12)
- Verify Chart.js CDN is accessible
- Clear browser cache and localStorage

### Settings not persisting

- Check browser localStorage is enabled
- Settings are stored per-browser; they won't sync across devices

### Time showing incorrectly

The app converts UTC timestamps from Hue Bridge to local time. If times appear wrong, check your system timezone settings.

## Future Development Opportunities

### Data Persistence ✅ (Implemented)

- **SQLite Database**: ✅ All readings persisted to disk, survives restarts
- **Data Export**: CSV/JSON export functionality for offline analysis (TODO)
- **Historical Queries**: ✅ Query by date range supported in database layer
- **Automatic Backups**: Scheduled database backups (TODO)
- **Advanced Storage**: Migrate to PostgreSQL, MongoDB, or InfluxDB for multi-user deployments (TODO)

### Advanced Analytics

- **Temperature Alerts**: Email/push notifications when temperature exceeds thresholds
- **Pattern Recognition**: Detect heating/cooling cycles, seasonal trends
- **Energy Insights**: Correlate temperature with motion to optimize HVAC
- **Humidity Tracking**: Add support for Hue humidity sensors (if available)
- **Comparative Analysis**: Compare temperature across rooms or time periods

### Enhanced Visualizations

- **Horizontal Scrolling**: ✅ Charts expand with scrollbar support for viewing large datasets
- **Time Range Selection**: ✅ Quick-select buttons for different data ranges
- **Multiple Chart Types**: Add bar charts, heat maps, or day/night comparison views (TODO)
- **Zoom & Pan**: Interactive chart controls for detailed analysis (TODO)
- **Annotations**: Add notes/markers for events (e.g., "furnace serviced") (TODO)
- **Dashboard Layouts**: Customizable grid layouts, full-screen mode (TODO)
- **Dark Mode**: ✅ Theme switcher with persistent preference

### Integration & Automation

- **Home Assistant Integration**: MQTT or REST API bridge
- **IFTTT Support**: Trigger actions based on temperature/motion events
- **Smart Thermostat Integration**: Coordinate with Nest, Ecobee, etc.
- **Weather Correlation**: Compare indoor temps with outdoor weather data
- **Webhook Support**: POST data to external services

### Multi-User Features

- **Authentication**: User accounts with secure login
- **Multi-Home Support**: Monitor multiple Hue systems
- **Shared Dashboards**: Read-only links for family members
- **Role-Based Access**: Admin vs. viewer permissions

### Mobile Experience

- **Progressive Web App**: Offline capability, home screen install
- **Native Apps**: iOS/Android apps with push notifications
- **Widget Support**: Lock screen/home screen widgets

### Advanced Configuration

- **Per-Room Settings**: Different poll rates or alert thresholds per room
- **Data Retention Policies**: Configure how long to keep historical data
- **Multi-Bridge Support**: Monitor sensors across multiple Hue Bridges
- **Custom Sensor Names**: Override default names from Hue

### Performance & Scalability

- **Smart Data Sampling**: ✅ Hourly/15-minute/all sampling based on data age
- **Time Range Controls**: ✅ Quick-select buttons for different time ranges
- **Horizontal Scrolling**: ✅ Charts expand for comfortable viewing of large datasets
- **WebSocket Updates**: Real-time updates without polling frontend (TODO)
- **Server-Sent Events**: Push updates to clients efficiently (TODO)
- **Clustering**: Horizontal scaling for high-traffic deployments (TODO)
- **Caching Layer**: Redis for faster data retrieval (TODO)

### Developer Tools

- **API Documentation**: OpenAPI/Swagger documentation
- **Webhook Debugging**: Test endpoint for webhook development
- **Mock Mode**: Run without physical Hue Bridge for development
- **Docker Support**: Containerization for easy deployment

## Contributing

Contributions are welcome! Areas for improvement:
- Unit tests (backend and frontend)
- Integration tests with mock Hue Bridge
- Accessibility improvements (ARIA labels, keyboard navigation)
- Internationalization (temperature units, date formats)
- Documentation improvements

## License

MIT License - feel free to use this project for personal or commercial purposes.

## Acknowledgments

- Built with [Express](https://expressjs.com/)
- Charts powered by [Chart.js](https://www.chartjs.org/)
- Temperature data from [Philips Hue](https://www.philips-hue.com/) motion sensors

---

**Version**: 1.2.0
**Last Updated**: February 2026

## Changelog

### Version 1.2.0 (February 2026)
- **Lights Dashboard**: New page to view and control all Hue lights organized by room
  - Click any light to open a control modal with power toggle, brightness slider, color picker, and color temperature slider
  - Live control — changes sent immediately via debounced PUT calls (no save button)
  - Color swatches show actual light color using CIE xy → RGB conversion
  - Supports Extended color, Color temperature, Dimmable, and On/Off light types
- **Dark Mode**: Light/dark theme toggle button on both pages with sun/moon icons
  - Persists to localStorage, shared across Temperature and Lights pages
  - Comprehensive dark styling for all components, modals, and controls
- **1 Hour Time Range**: New quick-select button for viewing the last 60 minutes
- **Per-Room Time Ranges**: Fixed bug where clicking a time range button changed all rooms — now each room independently tracks its selected range
- **Mobile Responsive Improvements**:
  - Charts now fit the screen on mobile (canvas element replaced on each render to prevent Chart.js width leaks)
  - Header layout wraps properly on narrow screens — title + buttons on row 1, nav on row 2
  - Compact header padding, smaller buttons, touch-friendly time range controls
  - Single-column card layout on screens ≤768px
- **Version Display**: Footer shows v2.1 on both pages

### Version 1.1.0 (February 2026)
- Added smart data sampling for optimal performance with large datasets
- Implemented time range controls (Auto/30d/7d/1d) on room cards
- Added horizontal scrolling support for charts
- Improved graph rendering performance for weeks of accumulated data
- Updated footer to reflect SQLite persistence

### Version 1.0.0 (January 2026)
- Initial release with SQLite database persistence
- Real-time temperature, motion, and light monitoring
- Interactive Chart.js graphs with motion indicators
- Admin settings modal for poll rate and y-axis configuration
- Responsive design for desktop, tablet, and mobile
