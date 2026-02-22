/**
 * Friday Cron Job
 *
 * Automatically posts tribute demands on Fridays.
 * Posts at a random time between 15:00-18:00 Stockholm time.
 */

import { Client, TextChannel } from 'discord.js';
import cron from 'node-cron';
import { getRandomPhrase, TRIBUTE_DEMAND_PHRASES } from '../personality';

// Stockholm timezone
const STOCKHOLM_TZ = 'Europe/Stockholm';

let currentTask: cron.ScheduledTask | null = null;

/**
 * Get a random minute between min and max (inclusive)
 */
function getRandomMinute(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Schedule the next Friday demand
 * Uses a random hour between 15-17 and random minute
 */
function scheduleFridayDemand(client: Client, channelId: string): void {
  // Random hour between 15, 16, or 17
  const hour = 15 + Math.floor(Math.random() * 3);
  const minute = getRandomMinute(0, 59);

  console.log(`Next Friday demand scheduled for ${hour}:${minute.toString().padStart(2, '0')} Stockholm time`);

  // Schedule for Fridays at the random time
  // Cron format: minute hour * * dayOfWeek
  // Friday is day 5
  const cronExpression = `${minute} ${hour} * * 5`;

  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  currentTask = cron.schedule(
    cronExpression,
    async () => {
      try {
        const channel = await client.channels.fetch(channelId);

        if (channel && channel instanceof TextChannel) {
          const demandMessage = getRandomPhrase(TRIBUTE_DEMAND_PHRASES);
          await channel.send(demandMessage);
          console.log(`Friday demand posted to channel ${channelId}`);
        } else {
          console.error(`Channel ${channelId} not found or not a text channel`);
        }
      } catch (error) {
        console.error('Error posting Friday demand:', error);
      }

      // Reschedule for next Friday with a new random time
      scheduleFridayDemand(client, channelId);
    },
    {
      timezone: STOCKHOLM_TZ,
      scheduled: true,
    }
  );
}

/**
 * Start the Friday cron job
 */
export function startFridayCron(client: Client, channelId: string): void {
  console.log('Initializing Friday tribute demand scheduler...');
  scheduleFridayDemand(client, channelId);
}

/**
 * Stop the Friday cron job
 */
export function stopFridayCron(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
    console.log('Friday cron stopped');
  }
}

/**
 * Check if today is Friday in Stockholm timezone
 */
export function isFridayInStockholm(): boolean {
  const stockholmDate = new Date().toLocaleString('en-US', {
    timeZone: STOCKHOLM_TZ,
    weekday: 'long',
  });
  return stockholmDate === 'Friday';
}

/**
 * Post an immediate demand (for testing or manual triggering)
 */
export async function postImmediateDemand(
  client: Client,
  channelId: string
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId);

    if (channel && channel instanceof TextChannel) {
      const demandMessage = getRandomPhrase(TRIBUTE_DEMAND_PHRASES);
      await channel.send(demandMessage);
      console.log(`Immediate demand posted to channel ${channelId}`);
      return true;
    }

    console.error(`Channel ${channelId} not found or not a text channel`);
    return false;
  } catch (error) {
    console.error('Error posting immediate demand:', error);
    return false;
  }
}
