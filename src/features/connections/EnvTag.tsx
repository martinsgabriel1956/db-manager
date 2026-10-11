import type { Environment } from "@/bindings";
import { ENVIRONMENT_STYLE } from "@/features/connections/options";
import { cn } from "@/lib/utils";

type EnvTagProps = { environment: Environment; className?: string };

/** The environment printed on the sample label. */
export function EnvTag({ environment, className }: EnvTagProps) {
  const style = ENVIRONMENT_STYLE[environment];
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded-[2px] px-1.5 label-caps",
        style.tagClass,
        className
      )}
    >
      {style.label}
    </span>
  );
}
