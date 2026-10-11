import { LazyStore } from "@tauri-apps/plugin-store";
import type { StateStorage } from "zustand/middleware";

// ui-state.json in the app data dir, written by tauri-plugin-store
const store = new LazyStore("ui-state.json");

export const tauriStorage: StateStorage = {
  getItem: async name => (await store.get<string>(name)) ?? null,
  setItem: async (name, value) => {
    await store.set(name, value);
    await store.save();
  },
  removeItem: async name => {
    await store.delete(name);
    await store.save();
  }
};
