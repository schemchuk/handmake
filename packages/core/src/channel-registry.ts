import type { ChannelAdapter } from './ports';

/**
 * Registry of channel adapters (Strategy + registry, ADR 007). The publisher
 * asks the registry for the tenant's enabled channels; core has no
 * `if (telegram)` branches anywhere.
 */
export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.key)) {
      throw new Error(`duplicate channel key: "${adapter.key}"`);
    }
    this.adapters.set(adapter.key, adapter);
  }

  get(key: string): ChannelAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new Error(`unknown channel: "${key}"`);
    }
    return adapter;
  }

  has(key: string): boolean {
    return this.adapters.has(key);
  }

  keys(): string[] {
    return [...this.adapters.keys()];
  }

  list(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }
}
