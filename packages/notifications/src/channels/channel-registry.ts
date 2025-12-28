/**
 * Channel Registry
 * Manages registration and lookup of notification channels
 */

import type { NotificationChannel } from '../types/core';
import type { BaseChannel } from '../types/channels';

export class ChannelRegistry {
  private channels: Map<NotificationChannel, BaseChannel> = new Map();

  /**
   * Register a channel adapter
   */
  register(channel: BaseChannel): void {
    const name = channel.getChannelName();
    if (this.channels.has(name)) {
      throw new Error(`Channel ${name} is already registered`);
    }
    this.channels.set(name, channel);
  }

  /**
   * Get a channel adapter by name
   */
  get(name: NotificationChannel): BaseChannel | undefined {
    return this.channels.get(name);
  }

  /**
   * Check if a channel is registered
   */
  has(name: NotificationChannel): boolean {
    return this.channels.has(name);
  }

  /**
   * Get all registered channel names
   */
  getRegisteredChannels(): NotificationChannel[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Unregister a channel (useful for testing)
   */
  unregister(name: NotificationChannel): boolean {
    return this.channels.delete(name);
  }

  /**
   * Clear all registered channels (useful for testing)
   */
  clear(): void {
    this.channels.clear();
  }
}

// Singleton instance
let registryInstance: ChannelRegistry | null = null;

export function getChannelRegistry(): ChannelRegistry {
  if (!registryInstance) {
    registryInstance = new ChannelRegistry();
  }
  return registryInstance;
}

export function resetChannelRegistry(): void {
  registryInstance = null;
}
