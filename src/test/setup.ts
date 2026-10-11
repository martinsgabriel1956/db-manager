import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach } from "vitest";

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
});
