import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, vi } from "vitest";
import { INITIAL_TABS, useTabs } from "@/features/tabs/store";

// tabs persist through tauri-plugin-store in the app; tests keep them in memory
vi.mock("@/features/tabs/storage", () => ({
  tauriStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
}));

// jsdom has no layout: give elements a size so virtualized lists render rows
// and CodeMirror can measure.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get: () => 600 },
  offsetWidth: { configurable: true, get: () => 1024 }
});
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: [][Symbol.iterator]
  }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
// resizable panels observe their size; jsdom never resizes, so observing is a no-op
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  clearMocks();
  useTabs.setState(INITIAL_TABS);
});
