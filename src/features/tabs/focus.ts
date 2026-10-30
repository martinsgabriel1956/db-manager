import { useRef } from "react";
import { tabElementId } from "@/features/tabs/TabBar";
import { useTabs } from "@/features/tabs/store";

/**
 * The active tab is where focus lands when the element that had it is gone; with no tab
 * left, the empty workspace's first action ("Abrir uma conexão"), never <body>.
 */
export function focusActiveTab() {
  const { activeId } = useTabs.getState();
  if (activeId) {
    document.getElementById(tabElementId(activeId))?.focus();
  } else {
    document.querySelector<HTMLElement>("#workspace button")?.focus();
  }
}

/**
 * For dialogs opened without a trigger (Ctrl+K, a menu): remember what had focus
 * and give it back on close, instead of dropping it on <body>.
 * `skip` leaves focus to the caller (e.g. a pick that opened a new tab).
 */
export function useFocusReturn(skip: () => boolean = () => false) {
  const returnTo = useRef<Element | null>(null);
  return {
    onOpenAutoFocus: () => {
      returnTo.current = document.activeElement;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (skip()) {
        return;
      }
      const target = returnTo.current;
      if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
        target.focus();
      } else {
        focusActiveTab();
      }
    }
  };
}
