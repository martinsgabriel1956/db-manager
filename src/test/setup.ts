import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, vi } from "vitest";
import { useExplorer } from "@/features/explorer/store";
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
// every jsdom rect sits at 0,0 like user-event's pointer: resizable panels would read each
// press as a grab of their separator (and move focus there), so separators live off-screen
const elementRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  return this.hasAttribute("data-separator")
    ? new DOMRect(-1000, -1000, 1, 1)
    : elementRect.call(this);
};
// resizable panels observe their size; jsdom never resizes, so observing is a no-op
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(async () => {
  cleanup();
  // unmounting stops event listeners asynchronously; let that finish before the mocks go
  await new Promise(resolve => setTimeout(resolve));
  clearMocks();
  useTabs.setState({ ...INITIAL_TABS, pending: {}, closeRequest: null, quitRequest: false });
  useExplorer.setState({ expanded: [], collapsedGroups: [] });
});
