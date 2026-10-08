import type { ProviderId, StoreAdapter } from "./store";

export interface ProviderInfo {
  id: Exclude<ProviderId, "local">;
  label: string;
  available: boolean;
}

export class AdapterRegistry {
  private adapters = new Map<string, StoreAdapter>();

  register(adapter: StoreAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): StoreAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`No adapter for ${id}`);
    return adapter;
  }

  providers(): ProviderInfo[] {
    return [...this.adapters.values()]
      .filter((adapter) => adapter.id !== "local")
      .map((adapter) => ({
        id: adapter.id as ProviderInfo["id"],
        label: adapter.label,
        available: adapter.available,
      }));
  }
}
