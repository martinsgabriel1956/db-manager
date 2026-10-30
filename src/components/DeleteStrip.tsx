import { useId, type MouseEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";

type DeleteStripProps = {
  /** the exact command, printed whole: the identifying id is usually at the end */
  command?: string;
  /** what goes away, in words, when there is no database command to show */
  message?: string;
  confirmLabel?: string;
  /** the mouse's way out; named apart when the trigger is itself a "Cancelar" */
  keepLabel?: string;
  /** destructive for writes; outline for dropping a draft, which touches no database */
  variant?: "destructive" | "outline";
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
 * buttons sit at the strip's left (the mouse's Cancelar first, then the confirmation), the
 * side away from the triggers at the right; the command or message follows them.
 */
export function DeleteStrip({
  command,
  message,
  confirmLabel = "Confirmar exclusão",
  keepLabel = "Cancelar",
  variant = "destructive",
  pending,
  onConfirm,
  onDisarm,
  triggerRef,
  className
}: DeleteStripProps) {
  const commandId = useId();
  const hintId = useId();
  return (
    // reversed: the command comes first in reading order, the button first on screen
    <div className={`flex flex-row-reverse items-center justify-end gap-2 ${className ?? ""}`}>
      {command !== undefined ? (
        <code
          id={commandId}
          className="min-w-0 flex-1 border border-foreground bg-background px-1.5 py-0.5 font-mono text-xs leading-5 break-all text-foreground"
        >
          {command}
        </code>
      ) : (
        <p id={commandId} className="min-w-0 flex-1 text-sm text-foreground">
          {message}
        </p>
      )}
      <span id={hintId} className="sr-only">
        Esc cancela.
      </span>
      {/* focused so Enter confirms; leaving it or Escape disarms the delete */}
      <Button
        type="button"
        size="xs"
        variant={variant}
        className={variant === "outline" ? "text-destructive" : undefined}
        autoFocus
        aria-describedby={`${commandId} ${hintId}`}
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
        {confirmLabel}
      </Button>
      {/* for the mouse; the keyboard has Esc. Pressed without taking focus, so the
          confirmation's blur is what disarms, the same path as every other way out */}
      <Button
        type="button"
        size="xs"
        variant="outline"
        tabIndex={-1}
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          triggerRef.current?.focus();
          onDisarm();
        }}
      >
        {keepLabel}
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
