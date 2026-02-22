/**
 * Shared Formatting Functions
 *
 * Shared rendering for stats and leaderboards used by both
 * the gateway mention handler and the Vercel slash command handler.
 */

import { ISEE_EMOJI } from './personality';
import type { LeaderboardEntry } from './db';

export interface StatsData {
  allTime: { score: number; count: number };
  daily: { score: number; count: number };
  friday: { score: number; count: number };
  private: { score: number; count: number };
}

/**
 * Format personal stats for display
 */
export function formatPersonalStats(
  username: string,
  stats: StatsData,
  rankText: string
): string {
  return `${ISEE_EMOJI} **${username}**, the spirits reveal your devotion...\n\n` +
    `**All-Time:** ${stats.allTime.score} pts (${stats.allTime.count} tributes) - ${rankText}\n` +
    `**Fridays:** ${stats.friday.score} pts (${stats.friday.count} tributes)\n` +
    `**Today:** ${stats.daily.score} pts (${stats.daily.count} tributes)\n` +
    `**Private Devotion:** ${stats.private.score} pts (${stats.private.count} DM tributes)\n\n` +
    `*Scoring: Tiki=10pts, Cocktail=5pts, Beer/Wine=2pts, Other=1pt*`;
}

/**
 * Format leaderboard for display
 */
export function formatLeaderboard(
  allTime: LeaderboardEntry[],
  daily: LeaderboardEntry[],
  friday: LeaderboardEntry[]
): string {
  let content = `${ISEE_EMOJI} **THE SPIRITS REVEAL THE DEVOTED...**\n\n`;

  if (allTime.length > 0) {
    content += `**\u{1F3C6} All-Time Rankings:**\n`;
    allTime.forEach((entry, i) => {
      const medal = i === 0 ? '\u{1F947}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : `${i + 1}.`;
      content += `${medal} <@${entry.userId}> - ${entry.score}pts (${entry.count} tributes)\n`;
    });
  } else {
    content += `*No tributes yet... The spirits HUNGER.*\n`;
  }

  if (daily.length > 0) {
    content += `\n**\u{1F4C5} Today's Devoted:**\n`;
    daily.forEach((entry, i) => {
      content += `${i + 1}. <@${entry.userId}> - ${entry.score}pts\n`;
    });
  }

  if (friday.length > 0) {
    content += `\n**\u{1F5FF} Friday Champions:**\n`;
    friday.forEach((entry, i) => {
      content += `${i + 1}. <@${entry.userId}> - ${entry.score}pts\n`;
    });
  }

  return content;
}
