/**
 * Database Module
 *
 * Handles connection to Neon DB (serverless Postgres) for persistent storage.
 * Works with both Vercel serverless functions and the Gateway bot.
 */

import { neon, neonConfig } from '@neondatabase/serverless';

// Enable connection pooling for better performance
neonConfig.fetchConnectionCache = true;

// Get the database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('DATABASE_URL not set - falling back to in-memory storage');
}

// Create the SQL client
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

/**
 * Check if database is available
 */
export function isDatabaseAvailable(): boolean {
  return sql !== null;
}

/**
 * Initialize database tables (run once on startup)
 */
export async function initializeDatabase(): Promise<void> {
  if (!sql) {
    console.warn('Database not available - skipping initialization');
    return;
  }

  try {
    // Create tributes table
    await sql`
      CREATE TABLE IF NOT EXISTS tributes (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        guild_id VARCHAR(255) NOT NULL,
        image_url TEXT,
        score INTEGER DEFAULT 1,
        friday_key DATE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create index for faster queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_tributes_friday_guild
      ON tributes(friday_key, guild_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_tributes_user
      ON tributes(user_id)
    `;

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Record a tribute post to the database
 */
export async function dbRecordTribute(
  userId: string,
  username: string,
  guildId: string,
  fridayKey: string,
  score: number,
  imageUrl?: string
): Promise<void> {
  if (!sql) return;

  try {
    await sql`
      INSERT INTO tributes (user_id, username, guild_id, image_url, score, friday_key)
      VALUES (${userId}, ${username}, ${guildId}, ${imageUrl || null}, ${score}, ${fridayKey})
    `;
  } catch (error) {
    console.error('Failed to record tribute:', error);
    throw error;
  }
}

/**
 * Get Friday posts for a specific guild
 */
export async function dbGetFridayPosts(
  fridayKey: string,
  guildId: string
): Promise<Array<{
  userId: string;
  username: string;
  guildId: string;
  imageUrl: string | null;
  timestamp: string;
  score: number;
}>> {
  if (!sql) return [];

  try {
    const results = await sql`
      SELECT user_id, username, guild_id, image_url, created_at, score
      FROM tributes
      WHERE friday_key = ${fridayKey} AND guild_id = ${guildId}
      ORDER BY created_at ASC
    `;

    return results.map(row => ({
      userId: row.user_id as string,
      username: row.username as string,
      guildId: row.guild_id as string,
      imageUrl: row.image_url as string | null,
      timestamp: (row.created_at as Date).toISOString(),
      score: row.score as number,
    }));
  } catch (error) {
    console.error('Failed to get Friday posts:', error);
    return [];
  }
}

/**
 * Get all-time stats for a user (public tributes only)
 */
export async function dbGetAllTimeStats(
  userId: string
): Promise<{ count: number; score: number }> {
  if (!sql) return { count: 0, score: 0 };

  try {
    const results = await sql`
      SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
      FROM tributes
      WHERE user_id = ${userId} AND guild_id != 'dm'
    `;

    return {
      count: Number(results[0]?.count || 0),
      score: Number(results[0]?.score || 0),
    };
  } catch (error) {
    console.error('Failed to get all-time stats:', error);
    return { count: 0, score: 0 };
  }
}

/**
 * Get daily stats for a user
 */
export async function dbGetDailyStats(
  userId: string,
  dateKey: string
): Promise<{ count: number; score: number }> {
  if (!sql) return { count: 0, score: 0 };

  try {
    const results = await sql`
      SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
      FROM tributes
      WHERE user_id = ${userId}
        AND guild_id != 'dm'
        AND DATE(created_at) = ${dateKey}
    `;

    return {
      count: Number(results[0]?.count || 0),
      score: Number(results[0]?.score || 0),
    };
  } catch (error) {
    console.error('Failed to get daily stats:', error);
    return { count: 0, score: 0 };
  }
}

/**
 * Get Friday stats for a user (all Fridays combined)
 */
export async function dbGetFridayStats(
  userId: string
): Promise<{ count: number; score: number }> {
  if (!sql) return { count: 0, score: 0 };

  try {
    const results = await sql`
      SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
      FROM tributes
      WHERE user_id = ${userId}
        AND guild_id != 'dm'
        AND EXTRACT(DOW FROM created_at) = 5
    `;

    return {
      count: Number(results[0]?.count || 0),
      score: Number(results[0]?.score || 0),
    };
  } catch (error) {
    console.error('Failed to get Friday stats:', error);
    return { count: 0, score: 0 };
  }
}

/**
 * Get private devotion stats for a user (DM tributes)
 */
export async function dbGetPrivateStats(
  userId: string
): Promise<{ count: number; score: number }> {
  if (!sql) return { count: 0, score: 0 };

  try {
    const results = await sql`
      SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
      FROM tributes
      WHERE user_id = ${userId} AND guild_id = 'dm'
    `;

    return {
      count: Number(results[0]?.count || 0),
      score: Number(results[0]?.score || 0),
    };
  } catch (error) {
    console.error('Failed to get private stats:', error);
    return { count: 0, score: 0 };
  }
}

/**
 * Get all-time leaderboard
 */
export async function dbGetAllTimeLeaderboard(): Promise<Array<{
  userId: string;
  count: number;
  score: number;
}>> {
  if (!sql) return [];

  try {
    const results = await sql`
      SELECT user_id, COUNT(*) as count, SUM(score) as score
      FROM tributes
      WHERE guild_id != 'dm'
      GROUP BY user_id
      ORDER BY score DESC
      LIMIT 50
    `;

    return results.map(row => ({
      userId: row.user_id as string,
      count: Number(row.count),
      score: Number(row.score),
    }));
  } catch (error) {
    console.error('Failed to get all-time leaderboard:', error);
    return [];
  }
}

/**
 * Get daily leaderboard
 */
export async function dbGetDailyLeaderboard(
  dateKey: string
): Promise<Array<{
  userId: string;
  count: number;
  score: number;
}>> {
  if (!sql) return [];

  try {
    const results = await sql`
      SELECT user_id, COUNT(*) as count, SUM(score) as score
      FROM tributes
      WHERE guild_id != 'dm' AND DATE(created_at) = ${dateKey}
      GROUP BY user_id
      ORDER BY score DESC
      LIMIT 20
    `;

    return results.map(row => ({
      userId: row.user_id as string,
      count: Number(row.count),
      score: Number(row.score),
    }));
  } catch (error) {
    console.error('Failed to get daily leaderboard:', error);
    return [];
  }
}

/**
 * Get Friday leaderboard (all Fridays combined)
 */
export async function dbGetFridayLeaderboard(): Promise<Array<{
  userId: string;
  count: number;
  score: number;
}>> {
  if (!sql) return [];

  try {
    const results = await sql`
      SELECT user_id, COUNT(*) as count, SUM(score) as score
      FROM tributes
      WHERE guild_id != 'dm' AND EXTRACT(DOW FROM created_at) = 5
      GROUP BY user_id
      ORDER BY score DESC
      LIMIT 20
    `;

    return results.map(row => ({
      userId: row.user_id as string,
      count: Number(row.count),
      score: Number(row.score),
    }));
  } catch (error) {
    console.error('Failed to get Friday leaderboard:', error);
    return [];
  }
}

/**
 * Check if user has offered tribute for a specific Friday
 */
export async function dbHasUserOfferedTribute(
  userId: string,
  guildId: string,
  fridayKey: string
): Promise<boolean> {
  if (!sql) return false;

  try {
    const results = await sql`
      SELECT 1 FROM tributes
      WHERE user_id = ${userId} AND guild_id = ${guildId} AND friday_key = ${fridayKey}
      LIMIT 1
    `;

    return results.length > 0;
  } catch (error) {
    console.error('Failed to check user tribute:', error);
    return false;
  }
}
