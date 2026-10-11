import * as React from "react";
import { cn } from "cn";

/** The platform <select>, styled to sit next to <Input>. Size it with `h-7`/`h-8`. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 border border-input bg-transparent px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:shadow-[inset_0_0_0_1px_var(--ring)] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-z9",
        className
      )}
      {...props}
    />
  );
}

export { NativeSelect };
