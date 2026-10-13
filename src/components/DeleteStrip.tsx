import { useId, type MouseEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";

type DeleteStripProps = {
  /** the exact command, printed whole: the identifying id is usually at the end */
  command: string;
  pending?: boolean;
  onConfirm: () => void;
  onDisarm: () => void;
  /** where Escape puts focus back: the trigger, which stays put while armed */
  triggerRef: RefObject<HTMLButtonElement | null>;
  className?: string;
};

/**
 * The armed state of an inline delete. It opens away from the trigger, which stays put and
 * disarms on a second click, so a double click can never land on the confirmation. The
 * confirmation sits at the strip's left, the side away from the triggers at the right.
 */
export function DeleteStrip({
  command,
  pending,
  onConfirm,
  onDisarm,
  triggerRef,
  className
}: DeleteStripProps) {
  const commandId = useId();
  return (
    // reversed: the command comes first in reading order, the button first on screen
    <div className={`flex flex-row-reverse items-center justify-end gap-2 ${className ?? ""}`}>
      <code
        id={commandId}
        className="min-w-0 flex-1 border border-foreground bg-background px-1.5 py-0.5 font-mono text-xs leading-5 break-all text-foreground"
      >
        {command}
      </code>
      {/* focused so Enter confirms; leaving it or Escape disarms the delete */}
      <Button
        size="xs"
        variant="destructive"
        autoFocus
        aria-describedby={commandId}
        disabled={pending}
        onClick={onConfirm}
        onBlur={onDisarm}
        onKeyDown={event => {
          if (event.key === "Escape") {
            // back to the trigger, not to the page: its blur disarms
            triggerRef.current?.focus();
          }
        }}
      >
        Confirmar exclusão
      </Button>
    </div>
  );
}

/** Keeps focus on the armed confirmation when the trigger is clicked again, so the click disarms. */
export function keepArmedFocus(armed: boolean) {
  return (event: MouseEvent) => {
    if (armed) {
      event.preventDefault();
    }
  };
}
