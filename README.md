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
- **Interactive Graphs**: Auto-scaling temperature charts with motion events highlighted as green dots
- **Configurable Settings**: Admin panel to adjust poll rate and y-axis scaling
- **Persistent Data**: All data stored in SQLite database - survives application restarts
- **Responsive Design**: Works on desktop, tablet, and mobile devices

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
├── index.html         # Main dashboard interface
├── css/
│   └── styles.css     # Responsive styling with modal components
└── js/
    └── app.js         # Frontend logic, Chart.js integration, settings management
```

**Key Components:**

- **Dashboard UI**: Grid layout displaying room cards with current readings
- **Chart.js Integration**: Line graphs showing temperature over time with motion events
- **Settings Modal**: Admin interface for configuring poll rate and y-axis scaling
- **Auto-refresh**: Polls backend API every 10 seconds (or configured interval)
- **LocalStorage**: Persists user settings across sessions

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

   Open your browser to: `http://localhost:3000`

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

Click the gear icon (⚙️) in the upper right to access:

- **Poll Rate**: Adjust how frequently the bridge is polled (1-300 seconds)
- **Y-Axis Scaling**:
  - Auto-scaling: Charts automatically adjust to temperature range
  - Manual: Set fixed upper and lower bounds in °F

Settings are saved to browser localStorage and persist across sessions.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms` | GET | List all rooms with current readings |
| `/api/rooms/:roomId` | GET | Detailed room data with full history |
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
│ Frontend Dashboard                      │
│  ├─ Fetches updates every 10s           │
│  ├─ Renders temperature graphs          │
│  └─ Shows motion/lux indicators         │
└─────────────────────────────────────────┘

On Server Restart:
SQLite Database → Data Store → Graphs populated with historical data
```

## Temperature Graph Features

- **Auto-scaling X-axis**: Displays all data from startup, automatically adjusting time labels
- **Smart Time Labels**:
  - < 12 hours: Shows time only (10:30 AM)
  - 12 hours - 3 days: Shows date + time (Jan 10, 10:30 AM)
  - > 3 days: Shows date only (Jan 10)
- **Motion Indicators**: Green dots on graph when motion was detected during that reading
- **Adaptive Point Sizes**: Points scale down as data accumulates for better visibility
- **Performance Optimized**:
  - Decimation enabled for datasets > 1000 points
  - Animation disabled for large datasets
  - Smooth rendering even with days of data

## Development

### Project Structure

```
hue/
├── package.json           # Dependencies and scripts
├── .env                   # Environment configuration (not in git)
├── .gitignore            # Git ignore rules
├── server.js             # Express server entry point
├── src/                  # Backend source code
│   ├── config.js
│   ├── dataStore.js
│   ├── hueClient.js
│   └── api/routes.js
└── public/               # Frontend static files
    ├── index.html
    ├── css/styles.css
    └── js/app.js
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

- **Multiple Chart Types**: Add bar charts, heat maps, or day/night comparison views
- **Zoom & Pan**: Interactive chart controls for detailed analysis
- **Annotations**: Add notes/markers for events (e.g., "furnace serviced")
- **Dashboard Layouts**: Customizable grid layouts, full-screen mode
- **Dark Mode**: Theme switcher for night viewing

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

- **WebSocket Updates**: Real-time updates without polling frontend
- **Server-Sent Events**: Push updates to clients efficiently
- **Clustering**: Horizontal scaling for high-traffic deployments
- **Caching Layer**: Redis for faster data retrieval

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

**Version**: 1.0.0
**Last Updated**: January 2026
