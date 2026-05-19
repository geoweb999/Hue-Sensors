import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

class HueDatabase {
  constructor(dbPath) {
    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.dbPath = dbPath;

    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    // Prepared statements will be initialized after tables are created
    this.stmts = null;
  }

  initialize() {
    console.log('Initializing database schema...');

    // Create rooms table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        room_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create readings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        temperature REAL NOT NULL,
        lux INTEGER,
        motion_detected INTEGER NOT NULL,
        last_motion_timestamp TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(room_id)
      )
    `);

    // Create index for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_room_timestamp
      ON readings(room_id, timestamp)
    `);

    // Create metadata table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Create persistent scene loops table (server-owned room animation playlists)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scene_loops (
        group_id TEXT PRIMARY KEY,
        is_running INTEGER NOT NULL DEFAULT 0,
        dwell_ms INTEGER NOT NULL DEFAULT 8000,
        loop_mode TEXT NOT NULL DEFAULT 'sequential',
        current_index INTEGER NOT NULL DEFAULT 0,
        playlist_json TEXT NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create persistent dynamic scene metadata table (shared across clients)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dynamic_scenes (
        scene_id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        name TEXT NOT NULL,
        palette_json TEXT NOT NULL,
        speed REAL NOT NULL DEFAULT 0.5,
        choreography_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Store schema version
    const versionStmt = this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    versionStmt.run('schema_version', '1.0');

    console.log('Database initialized successfully');

    // Now that tables exist, prepare statements for reuse
    this.prepareStatements();
  }

  prepareStatements() {
    // Prepared statements for better performance
    this.stmts = {
      insertRoom: this.db.prepare(`
        INSERT OR REPLACE INTO rooms (room_id, room_name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `),

      insertReading: this.db.prepare(`
        INSERT INTO readings (room_id, timestamp, temperature, lux, motion_detected, last_motion_timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `),

      getAllReadings: this.db.prepare(`
        SELECT * FROM readings ORDER BY timestamp ASC
      `),

      getReadingsByRoom: this.db.prepare(`
        SELECT * FROM readings
        WHERE room_id = ?
        ORDER BY timestamp ASC
      `),

      getReadingsSince: this.db.prepare(`
        SELECT * FROM readings
        WHERE timestamp > ?
        ORDER BY timestamp ASC
      `),

      getRoomList: this.db.prepare(`
        SELECT DISTINCT room_id, room_name
        FROM rooms
        ORDER BY room_name
      `),

      getRowCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM readings
      `),

      getOldestReading: this.db.prepare(`
        SELECT timestamp FROM readings
        ORDER BY timestamp ASC LIMIT 1
      `),

      getNewestReading: this.db.prepare(`
        SELECT timestamp FROM readings
        ORDER BY timestamp DESC LIMIT 1
      `),

      deleteOldReadings: this.db.prepare(`
        DELETE FROM readings WHERE timestamp < ?
      `),

      upsertSceneLoop: this.db.prepare(`
        INSERT INTO scene_loops (
          group_id, is_running, dwell_ms, loop_mode, current_index, playlist_json, last_error, created_at, updated_at
        ) VALUES (
          @group_id, @is_running, @dwell_ms, @loop_mode, @current_index, @playlist_json, @last_error, @created_at, @updated_at
        )
        ON CONFLICT(group_id) DO UPDATE SET
          is_running = excluded.is_running,
          dwell_ms = excluded.dwell_ms,
          loop_mode = excluded.loop_mode,
          current_index = excluded.current_index,
          playlist_json = excluded.playlist_json,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `),

      getSceneLoopByGroup: this.db.prepare(`
        SELECT * FROM scene_loops WHERE group_id = ?
      `),

      getRunningSceneLoops: this.db.prepare(`
        SELECT * FROM scene_loops WHERE is_running = 1
      `),

      deleteSceneLoopByGroup: this.db.prepare(`
        DELETE FROM scene_loops WHERE group_id = ?
      `),

      upsertDynamicScene: this.db.prepare(`
        INSERT INTO dynamic_scenes (
          scene_id, group_id, name, palette_json, speed, choreography_json, created_at, updated_at
        ) VALUES (
          @scene_id, @group_id, @name, @palette_json, @speed, @choreography_json, @created_at, @updated_at
        )
        ON CONFLICT(scene_id) DO UPDATE SET
          group_id = excluded.group_id,
          name = excluded.name,
          palette_json = excluded.palette_json,
          speed = excluded.speed,
          choreography_json = excluded.choreography_json,
          updated_at = excluded.updated_at
      `),

      getDynamicScenesByGroup: this.db.prepare(`
        SELECT * FROM dynamic_scenes
        WHERE group_id = ?
        ORDER BY LOWER(name) ASC, scene_id ASC
      `),

      getDynamicSceneById: this.db.prepare(`
        SELECT * FROM dynamic_scenes WHERE scene_id = ?
      `),

      deleteDynamicSceneById: this.db.prepare(`
        DELETE FROM dynamic_scenes WHERE scene_id = ?
      `)
    };
  }

  // Insert or update room
  upsertRoom(roomId, roomName) {
    const now = Date.now();
    this.stmts.insertRoom.run(roomId, roomName, now, now);
  }

  // Insert a single reading
  insertReading(roomId, roomName, timestamp, temperature, lux, motionDetected, lastMotion) {
    // Ensure room exists first
    this.upsertRoom(roomId, roomName);

    // Insert reading
    this.stmts.insertReading.run(
      roomId,
      timestamp,
      temperature,
      lux,
      motionDetected ? 1 : 0,
      lastMotion
    );
  }

  // Batch insert readings (much faster for large datasets)
  insertReadingsBatch(readings) {
    const insertMany = this.db.transaction((readings) => {
      for (const reading of readings) {
        this.insertReading(
          reading.roomId,
          reading.roomName,
          reading.timestamp,
          reading.temperature,
          reading.lux,
          reading.motionDetected,
          reading.lastMotion
        );
      }
    });

    insertMany(readings);
  }

  // Get all readings
  getAllReadings() {
    return this.stmts.getAllReadings.all();
  }

  // Get readings for a specific room
  getReadingsByRoom(roomId) {
    return this.stmts.getReadingsByRoom.all(roomId);
  }

  // Get readings since a timestamp
  getReadingsSince(timestamp) {
    return this.stmts.getReadingsSince.all(timestamp);
  }

  // Get list of rooms
  getRoomList() {
    return this.stmts.getRoomList.all();
  }

  // Get total number of readings
  getRowCount() {
    const result = this.stmts.getRowCount.get();
    return result.count;
  }

  // Get oldest reading timestamp
  getOldestReading() {
    const result = this.stmts.getOldestReading.get();
    return result ? result.timestamp : null;
  }

  // Get newest reading timestamp
  getNewestReading() {
    const result = this.stmts.getNewestReading.get();
    return result ? result.timestamp : null;
  }

  // Get readings in a time range
  getReadingsInRange(roomId, startTime, endTime) {
    if (roomId) {
      const stmt = this.db.prepare(`
        SELECT * FROM readings
        WHERE room_id = ? AND timestamp BETWEEN ? AND ?
        ORDER BY timestamp ASC
      `);
      return stmt.all(roomId, startTime, endTime);
    } else {
      const stmt = this.db.prepare(`
        SELECT * FROM readings
        WHERE timestamp BETWEEN ? AND ?
        ORDER BY timestamp ASC
      `);
      return stmt.all(startTime, endTime);
    }
  }

  // Prune old readings (optional cleanup)
  pruneOldReadings(daysToKeep) {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const info = this.stmts.deleteOldReadings.run(cutoffTime);
    console.log(`Pruned ${info.changes} old readings`);
    return info.changes;
  }

  // Get database statistics
  getStats() {
    const totalReadings = this.getRowCount();
    const oldestReading = this.getOldestReading();
    const newestReading = this.getNewestReading();
    const rooms = this.getRoomList();

    let dbSize = 0;
    try {
      dbSize = fs.statSync(this.dbPath).size;
    } catch (error) {
      console.error('Error getting database size:', error);
    }

    return {
      totalReadings,
      oldestReading,
      newestReading,
      roomCount: rooms.length,
      rooms,
      dbSizeBytes: dbSize,
      dbSizeMB: (dbSize / 1024 / 1024).toFixed(2)
    };
  }

  parseSceneLoopRow(row) {
    if (!row) return null;
    let playlist = [];
    try {
      const parsed = JSON.parse(row.playlist_json || '[]');
      if (Array.isArray(parsed)) playlist = parsed;
    } catch {
      playlist = [];
    }
    return {
      groupId: String(row.group_id),
      isRunning: Number(row.is_running) === 1,
      dwellMs: Number(row.dwell_ms) || 8000,
      mode: String(row.loop_mode || 'sequential'),
      currentIndex: Number(row.current_index) || 0,
      playlist,
      lastError: row.last_error || null,
      createdAt: Number(row.created_at) || null,
      updatedAt: Number(row.updated_at) || null
    };
  }

  upsertSceneLoop(loop) {
    const now = Date.now();
    const existing = this.stmts.getSceneLoopByGroup.get(String(loop.groupId));
    this.stmts.upsertSceneLoop.run({
      group_id: String(loop.groupId),
      is_running: loop.isRunning ? 1 : 0,
      dwell_ms: Number(loop.dwellMs) || 8000,
      loop_mode: String(loop.mode || 'sequential'),
      current_index: Number(loop.currentIndex) || 0,
      playlist_json: JSON.stringify(Array.isArray(loop.playlist) ? loop.playlist : []),
      last_error: loop.lastError || null,
      created_at: existing ? existing.created_at : now,
      updated_at: now
    });
    return this.getSceneLoopByGroup(loop.groupId);
  }

  getSceneLoopByGroup(groupId) {
    const row = this.stmts.getSceneLoopByGroup.get(String(groupId));
    return this.parseSceneLoopRow(row);
  }

  getRunningSceneLoops() {
    const rows = this.stmts.getRunningSceneLoops.all();
    return rows.map((row) => this.parseSceneLoopRow(row)).filter(Boolean);
  }

  deleteSceneLoopByGroup(groupId) {
    return this.stmts.deleteSceneLoopByGroup.run(String(groupId)).changes;
  }

  parseDynamicSceneRow(row) {
    if (!row) return null;
    let palette = [];
    let choreography = null;
    try {
      const parsedPalette = JSON.parse(row.palette_json || '[]');
      if (Array.isArray(parsedPalette)) palette = parsedPalette;
    } catch {
      palette = [];
    }
    try {
      const parsedChoreography = JSON.parse(row.choreography_json || 'null');
      if (parsedChoreography && typeof parsedChoreography === 'object') choreography = parsedChoreography;
    } catch {
      choreography = null;
    }
    return {
      sceneId: String(row.scene_id),
      groupId: String(row.group_id),
      name: String(row.name || ''),
      palette,
      speed: Number(row.speed) || 0.5,
      choreography,
      createdAt: Number(row.created_at) || null,
      updatedAt: Number(row.updated_at) || null
    };
  }

  upsertDynamicScene(scene) {
    const now = Date.now();
    const existing = this.stmts.getDynamicSceneById.get(String(scene.sceneId));
    this.stmts.upsertDynamicScene.run({
      scene_id: String(scene.sceneId),
      group_id: String(scene.groupId),
      name: String(scene.name || '').trim() || `Dynamic ${scene.sceneId}`,
      palette_json: JSON.stringify(Array.isArray(scene.palette) ? scene.palette : []),
      speed: Number(scene.speed) || 0.5,
      choreography_json: scene.choreography ? JSON.stringify(scene.choreography) : null,
      created_at: existing ? existing.created_at : now,
      updated_at: now
    });
    return this.getDynamicSceneById(scene.sceneId);
  }

  getDynamicScenesByGroup(groupId) {
    return this.stmts.getDynamicScenesByGroup
      .all(String(groupId))
      .map((row) => this.parseDynamicSceneRow(row))
      .filter(Boolean);
  }

  getDynamicSceneById(sceneId) {
    const row = this.stmts.getDynamicSceneById.get(String(sceneId));
    return this.parseDynamicSceneRow(row);
  }

  deleteDynamicSceneById(sceneId) {
    return this.stmts.deleteDynamicSceneById.run(String(sceneId)).changes;
  }

  // Vacuum database to reclaim space
  vacuum() {
    console.log('Vacuuming database...');
    this.db.exec('VACUUM');
    console.log('Vacuum complete');
  }

  // Backup database
  backup(backupPath) {
    console.log(`Backing up database to ${backupPath}...`);
    const backupDir = path.dirname(backupPath);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    this.db.backup(backupPath);
    console.log('Backup complete');
  }

  // Close database connection
  close() {
    console.log('Closing database connection...');
    this.db.close();
  }
}

// Export singleton instance
let dbInstance = null;

export function initializeDatabase(dbPath) {
  if (!dbInstance) {
    dbInstance = new HueDatabase(dbPath);
    dbInstance.initialize();
  }
  return dbInstance;
}

export function getDatabase() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbInstance;
}

export { HueDatabase };
