/**
 * Database Module
 *
 * Persistent storage using PostgreSQL (via postgresjs).
 * This is the ONLY source of truth - no in-memory fallback.
 * Stores rich tribute data for AI context and memory.
 *
 * Also initializes ChatKit-style tables for:
 * - threads: Session state and rolling summary
 * - thread_items: First-class transcript storage
 * - runs: Idempotency and debugging
 */

import postgres from 'postgres';
import { initializeThreadTables } from './services/threads';
import { initializeAgentTables } from './services/agents';

// Get the database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('CRITICAL: DATABASE_URL not set - database features will not work!');
}

let dbInitialized = false;

// Create the SQL client with connection pooling
export const sql = DATABASE_URL ? postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
}) : null;

/**
 * Check if database is available
 */
export function isDatabaseAvailable(): boolean {
  return sql !== null;
}

/**
 * Ensure database is available, throw if not
 */
export function requireDatabase() {
  if (!sql) {
    throw new Error('Database not configured. Set DATABASE_URL environment variable.');
  }
  return sql;
}

/**
 * Close database connections gracefully
 */
export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.end();
  }
}

/**
 * Initialize database tables (run once on startup)
 */
export async function initializeDatabase(): Promise<void> {
  if (dbInitialized) return;
  const db = requireDatabase();

  try {
    // Create tributes table with rich data for AI context
    await db`
      CREATE TABLE IF NOT EXISTS tributes (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        username VARCHAR(255) NOT NULL,
        guild_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255),
        is_dm BOOLEAN DEFAULT FALSE,
        image_url TEXT,
        category VARCHAR(50) DEFAULT 'OTHER',
        drink_name VARCHAR(255),
        description TEXT,
        ai_response TEXT,
        score INTEGER DEFAULT 1,
        friday_key DATE NOT NULL,
        is_friday BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create indexes for fast queries
    await db`CREATE INDEX IF NOT EXISTS idx_tributes_user ON tributes(user_id)`;
    await db`CREATE INDEX IF NOT EXISTS idx_tributes_guild ON tributes(guild_id)`;
    await db`CREATE INDEX IF NOT EXISTS idx_tributes_channel ON tributes(channel_id)`;
    await db`CREATE INDEX IF NOT EXISTS idx_tributes_friday ON tributes(friday_key)`;
    await db`CREATE INDEX IF NOT EXISTS idx_tributes_created ON tributes(created_at DESC)`;
    await db`CREATE INDEX IF NOT EXISTS idx_tributes_category ON tributes(category)`;

    // Create discord_messages_recent table for conversation context
    // Short-lived message history for building LLM context
    await db`
      CREATE TABLE IF NOT EXISTS discord_messages_recent (
        message_id VARCHAR(255) PRIMARY KEY,
        channel_id VARCHAR(255) NOT NULL,
        guild_id VARCHAR(255),
        author_id VARCHAR(255) NOT NULL,
        author_name VARCHAR(255) NOT NULL,
        is_bot BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL,
        ingested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        content TEXT,
        mentions_bot BOOLEAN DEFAULT FALSE,
        reply_to_message_id VARCHAR(255),
        has_image BOOLEAN DEFAULT FALSE,
        has_attachments BOOLEAN DEFAULT FALSE,
        attachments JSONB DEFAULT '[]',
        is_deleted BOOLEAN DEFAULT FALSE,
        edited_at TIMESTAMP WITH TIME ZONE
      )
    `;

    // Create indexes for efficient context queries
    // Primary index: fetch last N messages in a channel ordered by time
    await db`CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON discord_messages_recent(channel_id, created_at DESC)`;
    // For finding last bot exchange (when bot was mentioned)
    await db`CREATE INDEX IF NOT EXISTS idx_messages_channel_bot ON discord_messages_recent(channel_id, mentions_bot, created_at DESC)`;
    // For cleanup by age
    await db`CREATE INDEX IF NOT EXISTS idx_messages_ingested ON discord_messages_recent(ingested_at)`;

    console.log('Database tables initialized successfully');

    // Initialize ChatKit-style tables (threads, thread_items, runs)
    await initializeThreadTables();

    // Initialize Agent Builder tables (agents, workflows)
    await initializeAgentTables();

    dbInitialized = true;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// ============ TRIBUTE TYPES ============

export interface TributeRecord {
  id?: number;
  userId: string;
  username: string;
  guildId: string;
  channelId?: string;
  isDm: boolean;
  imageUrl?: string;
  category: 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER';
  drinkName?: string;
  description?: string;
  aiResponse?: string;
  score: number;
  fridayKey: string;
  isFriday: boolean;
  createdAt?: string;
}

export interface UserStats {
  count: number;
  score: number;
}

export interface DetailedUserStats {
  userId: string;
  username: string;
  allTime: UserStats;
  fridays: UserStats;
  today: UserStats;
  private: UserStats;
  public: UserStats;
  byCategory: {
    tiki: UserStats;
    cocktail: UserStats;
    beerWine: UserStats;
    other: UserStats;
  };
  lastTribute?: {
    date: string;
    category: string;
    drinkName?: string;
  };
}

export interface LeaderboardEntry {
  userId: string;
  username?: string;
  count: number;
  score: number;
}

// ============ TRIBUTE RECORDING ============

/**
 * Record a tribute to the database
 */
export async function recordTribute(tribute: Omit<TributeRecord, 'id' | 'createdAt'>): Promise<number> {
  const db = requireDatabase();

  try {
    const result = await db`
      INSERT INTO tributes (
        user_id, username, guild_id, channel_id, is_dm,
        image_url, category, drink_name, description, ai_response,
        score, friday_key, is_friday
      )
      VALUES (
        ${tribute.userId}, ${tribute.username}, ${tribute.guildId},
        ${tribute.channelId || null}, ${tribute.isDm},
        ${tribute.imageUrl || null}, ${tribute.category},
        ${tribute.drinkName || null}, ${tribute.description || null},
        ${tribute.aiResponse || null}, ${tribute.score},
        ${tribute.fridayKey}, ${tribute.isFriday}
      )
      RETURNING id
    `;
    return result[0]?.id as number;
  } catch (error) {
    console.error('Failed to record tribute:', error);
    throw error;
  }
}

// ============ USER STATS ============

/**
 * Get comprehensive stats for a user
 */
export async function getUserStats(userId: string, guildId?: string): Promise<DetailedUserStats> {
  const db = requireDatabase();
  const today = new Date().toISOString().split('T')[0];

  try {
    const [allTimeResult, fridayResult, todayResult, privateResult, categoryResult, lastTributeResult] = await Promise.all([
      // Get all-time public stats
      db`
        SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
        FROM tributes WHERE user_id = ${userId} AND is_dm = FALSE
        ${guildId ? db`AND guild_id = ${guildId}` : db``}
      `,
      // Get Friday stats
      db`
        SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
        FROM tributes WHERE user_id = ${userId} AND is_friday = TRUE AND is_dm = FALSE
        ${guildId ? db`AND guild_id = ${guildId}` : db``}
      `,
      // Get today's stats
      db`
        SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
        FROM tributes WHERE user_id = ${userId} AND DATE(created_at) = ${today} AND is_dm = FALSE
        ${guildId ? db`AND guild_id = ${guildId}` : db``}
      `,
      // Get private (DM) stats
      db`
        SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
        FROM tributes WHERE user_id = ${userId} AND is_dm = TRUE
      `,
      // Get stats by category
      db`
        SELECT category, COUNT(*) as count, COALESCE(SUM(score), 0) as score
        FROM tributes WHERE user_id = ${userId}
        ${guildId ? db`AND guild_id = ${guildId}` : db``}
        GROUP BY category
      `,
      // Get last tribute
      db`
        SELECT created_at, category, drink_name, username
        FROM tributes WHERE user_id = ${userId}
        ${guildId ? db`AND guild_id = ${guildId}` : db``}
        ORDER BY created_at DESC LIMIT 1
      `,
    ]);

    const categoryStats = {
      tiki: { count: 0, score: 0 },
      cocktail: { count: 0, score: 0 },
      beerWine: { count: 0, score: 0 },
      other: { count: 0, score: 0 },
    };

    for (const row of categoryResult) {
      const cat = (row.category as string).toLowerCase();
      if (cat === 'tiki') categoryStats.tiki = { count: Number(row.count), score: Number(row.score) };
      else if (cat === 'cocktail') categoryStats.cocktail = { count: Number(row.count), score: Number(row.score) };
      else if (cat === 'beer_wine') categoryStats.beerWine = { count: Number(row.count), score: Number(row.score) };
      else categoryStats.other = { count: Number(row.count), score: Number(row.score) };
    }

    return {
      userId,
      username: lastTributeResult[0]?.username as string || 'Unknown',
      allTime: { count: Number(allTimeResult[0]?.count || 0), score: Number(allTimeResult[0]?.score || 0) },
      fridays: { count: Number(fridayResult[0]?.count || 0), score: Number(fridayResult[0]?.score || 0) },
      today: { count: Number(todayResult[0]?.count || 0), score: Number(todayResult[0]?.score || 0) },
      private: { count: Number(privateResult[0]?.count || 0), score: Number(privateResult[0]?.score || 0) },
      public: { count: Number(allTimeResult[0]?.count || 0), score: Number(allTimeResult[0]?.score || 0) },
      byCategory: categoryStats,
      lastTribute: lastTributeResult[0] ? {
        date: (lastTributeResult[0].created_at as Date).toISOString(),
        category: lastTributeResult[0].category as string,
        drinkName: lastTributeResult[0].drink_name as string | undefined,
      } : undefined,
    };
  } catch (error) {
    console.error('Failed to get user stats:', error);
    throw error;
  }
}

/**
 * Get simple all-time stats for a user
 */
export async function getAllTimeStats(userId: string, guildId?: string): Promise<UserStats> {
  const db = requireDatabase();

  const result = await db`
    SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
    FROM tributes WHERE user_id = ${userId} AND is_dm = FALSE
    ${guildId ? db`AND guild_id = ${guildId}` : db``}
  `;

  return {
    count: Number(result[0]?.count || 0),
    score: Number(result[0]?.score || 0),
  };
}

/**
 * Get Friday stats for a user
 */
export async function getFridayStats(userId: string, guildId?: string): Promise<UserStats> {
  const db = requireDatabase();

  const result = await db`
    SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
    FROM tributes WHERE user_id = ${userId} AND is_friday = TRUE AND is_dm = FALSE
    ${guildId ? db`AND guild_id = ${guildId}` : db``}
  `;

  return {
    count: Number(result[0]?.count || 0),
    score: Number(result[0]?.score || 0),
  };
}

/**
 * Get today's stats for a user
 */
export async function getDailyStats(userId: string, guildId?: string): Promise<UserStats> {
  const db = requireDatabase();
  const today = new Date().toISOString().split('T')[0];

  const result = await db`
    SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
    FROM tributes WHERE user_id = ${userId} AND DATE(created_at) = ${today} AND is_dm = FALSE
    ${guildId ? db`AND guild_id = ${guildId}` : db``}
  `;

  return {
    count: Number(result[0]?.count || 0),
    score: Number(result[0]?.score || 0),
  };
}

/**
 * Get private devotion stats for a user
 */
export async function getPrivateStats(userId: string): Promise<UserStats> {
  const db = requireDatabase();

  const result = await db`
    SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score
    FROM tributes WHERE user_id = ${userId} AND is_dm = TRUE
  `;

  return {
    count: Number(result[0]?.count || 0),
    score: Number(result[0]?.score || 0),
  };
}

// ============ LEADERBOARDS ============

/**
 * Get all-time leaderboard
 */
export async function getAllTimeLeaderboard(limit: number = 50, guildId?: string): Promise<LeaderboardEntry[]> {
  const db = requireDatabase();

  const result = await db`
    SELECT user_id, MAX(username) as username, COUNT(*) as count, SUM(score) as score
    FROM tributes WHERE is_dm = FALSE
    ${guildId ? db`AND guild_id = ${guildId}` : db``}
    GROUP BY user_id
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    userId: row.user_id as string,
    username: row.username as string,
    count: Number(row.count),
    score: Number(row.score),
  }));
}

/**
 * Get today's leaderboard
 */
export async function getDailyLeaderboard(limit: number = 20, guildId?: string): Promise<LeaderboardEntry[]> {
  const db = requireDatabase();
  const today = new Date().toISOString().split('T')[0];

  const result = await db`
    SELECT user_id, MAX(username) as username, COUNT(*) as count, SUM(score) as score
    FROM tributes WHERE is_dm = FALSE AND DATE(created_at) = ${today}
    ${guildId ? db`AND guild_id = ${guildId}` : db``}
    GROUP BY user_id
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    userId: row.user_id as string,
    username: row.username as string,
    count: Number(row.count),
    score: Number(row.score),
  }));
}

/**
 * Get Friday leaderboard (all Fridays)
 */
export async function getFridayLeaderboard(limit: number = 20, guildId?: string): Promise<LeaderboardEntry[]> {
  const db = requireDatabase();

  const result = await db`
    SELECT user_id, MAX(username) as username, COUNT(*) as count, SUM(score) as score
    FROM tributes WHERE is_dm = FALSE AND is_friday = TRUE
    ${guildId ? db`AND guild_id = ${guildId}` : db``}
    GROUP BY user_id
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    userId: row.user_id as string,
    username: row.username as string,
    count: Number(row.count),
    score: Number(row.score),
  }));
}

// ============ FRIDAY STATUS ============

export interface FridayPost {
  userId: string;
  username: string;
  guildId: string;
  channelId?: string;
  imageUrl?: string;
  category: string;
  drinkName?: string;
  score: number;
  timestamp: string;
}

export interface FridayStatus {
  date: string;
  hasTributePost: boolean;
  posts: FridayPost[];
  totalScore: number;
}

/**
 * Get current Friday key (most recent Friday)
 */
export function getCurrentFridayKey(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToSubtract = dayOfWeek >= 5 ? dayOfWeek - 5 : dayOfWeek + 2;
  const friday = new Date(now);
  friday.setDate(friday.getDate() - daysToSubtract);
  return friday.toISOString().split('T')[0];
}

/**
 * Check if today is Friday
 */
export function isFriday(): boolean {
  return new Date().getDay() === 5;
}

/**
 * Get Friday status for a guild
 */
export async function getFridayStatus(guildId: string): Promise<FridayStatus> {
  const db = requireDatabase();
  const fridayKey = getCurrentFridayKey();

  const result = await db`
    SELECT user_id, username, guild_id, channel_id, image_url,
           category, drink_name, score, created_at
    FROM tributes
    WHERE friday_key = ${fridayKey} AND guild_id = ${guildId}
    ORDER BY created_at ASC
  `;

  const posts: FridayPost[] = result.map(row => ({
    userId: row.user_id as string,
    username: row.username as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string | undefined,
    imageUrl: row.image_url as string | undefined,
    category: row.category as string,
    drinkName: row.drink_name as string | undefined,
    score: Number(row.score),
    timestamp: (row.created_at as Date).toISOString(),
  }));

  const totalScore = posts.reduce((sum, p) => sum + p.score, 0);

  return {
    date: fridayKey,
    hasTributePost: posts.length > 0,
    posts,
    totalScore,
  };
}

/**
 * Check if user has offered tribute this Friday in a guild
 */
export async function hasUserOfferedTribute(userId: string, guildId: string): Promise<boolean> {
  const db = requireDatabase();
  const fridayKey = getCurrentFridayKey();

  const result = await db`
    SELECT 1 FROM tributes
    WHERE user_id = ${userId} AND guild_id = ${guildId} AND friday_key = ${fridayKey}
    LIMIT 1
  `;

  return result.length > 0;
}

// ============ AI CONTEXT FUNCTIONS ============

/**
 * Get recent tributes for AI context (rich data for memory)
 */
export async function getRecentTributes(limit: number = 20, guildId?: string): Promise<TributeRecord[]> {
  const db = requireDatabase();

  const result = await db`
    SELECT id, user_id, username, guild_id, channel_id, is_dm,
           image_url, category, drink_name, description, ai_response,
           score, friday_key, is_friday, created_at
    FROM tributes
    ${guildId ? db`WHERE guild_id = ${guildId}` : db``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    id: row.id as number,
    userId: row.user_id as string,
    username: row.username as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string | undefined,
    isDm: row.is_dm as boolean,
    imageUrl: row.image_url as string | undefined,
    category: row.category as 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER',
    drinkName: row.drink_name as string | undefined,
    description: row.description as string | undefined,
    aiResponse: row.ai_response as string | undefined,
    score: row.score as number,
    fridayKey: row.friday_key as string,
    isFriday: row.is_friday as boolean,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

/**
 * Get user's tribute history for AI context
 */
export async function getUserTributeHistory(userId: string, limit: number = 10): Promise<TributeRecord[]> {
  const db = requireDatabase();

  const result = await db`
    SELECT id, user_id, username, guild_id, channel_id, is_dm,
           image_url, category, drink_name, description, ai_response,
           score, friday_key, is_friday, created_at
    FROM tributes
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    id: row.id as number,
    userId: row.user_id as string,
    username: row.username as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string | undefined,
    isDm: row.is_dm as boolean,
    imageUrl: row.image_url as string | undefined,
    category: row.category as 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER',
    drinkName: row.drink_name as string | undefined,
    description: row.description as string | undefined,
    aiResponse: row.ai_response as string | undefined,
    score: row.score as number,
    fridayKey: row.friday_key as string,
    isFriday: row.is_friday as boolean,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

/**
 * Get channel tribute history for AI context
 */
export async function getChannelTributeHistory(channelId: string, limit: number = 10): Promise<TributeRecord[]> {
  const db = requireDatabase();

  const result = await db`
    SELECT id, user_id, username, guild_id, channel_id, is_dm,
           image_url, category, drink_name, description, ai_response,
           score, friday_key, is_friday, created_at
    FROM tributes
    WHERE channel_id = ${channelId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return result.map(row => ({
    id: row.id as number,
    userId: row.user_id as string,
    username: row.username as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string | undefined,
    isDm: row.is_dm as boolean,
    imageUrl: row.image_url as string | undefined,
    category: row.category as 'TIKI' | 'COCKTAIL' | 'BEER_WINE' | 'OTHER',
    drinkName: row.drink_name as string | undefined,
    description: row.description as string | undefined,
    aiResponse: row.ai_response as string | undefined,
    score: row.score as number,
    fridayKey: row.friday_key as string,
    isFriday: row.is_friday as boolean,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

/**
 * Get global tribute statistics for AI context
 */
export async function getGlobalStats(): Promise<{
  totalTributes: number;
  totalScore: number;
  uniqueUsers: number;
  categoryBreakdown: Record<string, { count: number; score: number }>;
  todayTributes: number;
  fridayTributes: number;
}> {
  const db = requireDatabase();
  const today = new Date().toISOString().split('T')[0];

  const [totalResult, usersResult, categoryResult, todayResult, fridayResult] = await Promise.all([
    db`SELECT COUNT(*) as count, COALESCE(SUM(score), 0) as score FROM tributes WHERE is_dm = FALSE`,
    db`SELECT COUNT(DISTINCT user_id) as count FROM tributes WHERE is_dm = FALSE`,
    db`SELECT category, COUNT(*) as count, SUM(score) as score FROM tributes WHERE is_dm = FALSE GROUP BY category`,
    db`SELECT COUNT(*) as count FROM tributes WHERE is_dm = FALSE AND DATE(created_at) = ${today}`,
    db`SELECT COUNT(*) as count FROM tributes WHERE is_dm = FALSE AND is_friday = TRUE`,
  ]);

  const categoryBreakdown: Record<string, { count: number; score: number }> = {};
  for (const row of categoryResult) {
    categoryBreakdown[row.category as string] = {
      count: Number(row.count),
      score: Number(row.score),
    };
  }

  return {
    totalTributes: Number(totalResult[0]?.count || 0),
    totalScore: Number(totalResult[0]?.score || 0),
    uniqueUsers: Number(usersResult[0]?.count || 0),
    categoryBreakdown,
    todayTributes: Number(todayResult[0]?.count || 0),
    fridayTributes: Number(fridayResult[0]?.count || 0),
  };
}

/**
 * Format user stats for AI context string
 */
export function formatUserStatsForAI(stats: DetailedUserStats): string {
  return `[USER STATS for ${stats.username} (ID: ${stats.userId})]
All-Time: ${stats.allTime.score}pts from ${stats.allTime.count} public tributes
Fridays: ${stats.fridays.score}pts from ${stats.fridays.count} tributes
Today: ${stats.today.score}pts from ${stats.today.count} tributes
Private DM tributes: ${stats.private.score}pts from ${stats.private.count} tributes
Category breakdown - Tiki: ${stats.byCategory.tiki.count}, Cocktails: ${stats.byCategory.cocktail.count}, Beer/Wine: ${stats.byCategory.beerWine.count}, Other: ${stats.byCategory.other.count}
${stats.lastTribute ? `Last tribute: ${stats.lastTribute.category}${stats.lastTribute.drinkName ? ` (${stats.lastTribute.drinkName})` : ''} on ${new Date(stats.lastTribute.date).toLocaleDateString()}` : 'No tributes yet'}
[Scoring: Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt]`;
}

/**
 * Format leaderboard for AI context string
 */
export function formatLeaderboardForAI(
  allTime: LeaderboardEntry[],
  daily: LeaderboardEntry[],
  friday: LeaderboardEntry[]
): string {
  let context = '[LEADERBOARD DATA]\n';

  if (allTime.length > 0) {
    context += 'All-Time Top 5: ' + allTime.slice(0, 5).map((e, i) =>
      `#${i + 1} ${e.username || `<@${e.userId}>`} (${e.score}pts, ${e.count} tributes)`
    ).join(', ') + '\n';
  }

  if (daily.length > 0) {
    context += 'Today: ' + daily.slice(0, 5).map((e, i) =>
      `#${i + 1} ${e.username || `<@${e.userId}>`} (${e.score}pts)`
    ).join(', ') + '\n';
  }

  if (friday.length > 0) {
    context += 'Friday Champions: ' + friday.slice(0, 5).map((e, i) =>
      `#${i + 1} ${e.username || `<@${e.userId}>`} (${e.score}pts)`
    ).join(', ');
  }

  return context;
}

/**
 * Format tribute history for AI context string
 */
export function formatTributeHistoryForAI(tributes: TributeRecord[]): string {
  if (tributes.length === 0) return '[No tribute history]';

  return '[RECENT TRIBUTE HISTORY]\n' + tributes.map(t => {
    const date = new Date(t.createdAt!).toLocaleDateString();
    const time = new Date(t.createdAt!).toLocaleTimeString();
    return `- ${date} ${time}: ${t.username} offered ${t.category}${t.drinkName ? ` (${t.drinkName})` : ''} for ${t.score}pts${t.isDm ? ' (private)' : ''}`;
  }).join('\n');
}

/**
 * Get comprehensive AI context for a user interaction
 */
export async function getAIContext(userId: string, channelId?: string, guildId?: string): Promise<string> {
  const [userStats, allTime, daily, friday, recentTributes, userHistory] = await Promise.all([
    getUserStats(userId, guildId),
    getAllTimeLeaderboard(10, guildId),
    getDailyLeaderboard(5, guildId),
    getFridayLeaderboard(5, guildId),
    getRecentTributes(10, guildId),
    getUserTributeHistory(userId, 5),
  ]);

  let context = formatUserStatsForAI(userStats) + '\n\n';
  context += formatLeaderboardForAI(allTime, daily, friday) + '\n\n';

  if (userHistory.length > 0) {
    context += '[YOUR RECENT TRIBUTES]\n' + userHistory.map(t => {
      const date = new Date(t.createdAt!).toLocaleDateString();
      return `- ${date}: ${t.category}${t.drinkName ? ` (${t.drinkName})` : ''} - ${t.score}pts`;
    }).join('\n') + '\n\n';
  }

  context += formatTributeHistoryForAI(recentTributes);

  return context;
}
