import type { Engine, Environment } from "@/bindings";
import { ENGINE_CODE, ENGINE_LABEL, ENVIRONMENT_STYLE } from "@/features/connections/options";
import { cn } from "@/lib/utils";

type EnvTagProps = {
  environment: Environment;
  className?: string;
  /** under a field already labelled "Ambiente": the tag reads "Prod", not "ambiente Prod" */
  labelled?: boolean;
};

type EngineCodeProps = { engine: Engine; className?: string };

/** The environment printed as a legend: dotted, solid, hatched or under the safelight. */
export function EnvTag({ environment, className, labelled = false }: EnvTagProps) {
  const style = ENVIRONMENT_STYLE[environment];
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center px-1.5 legend",
        style.tagClass,
        className
      )}
    >
      {/* read in context: "ambiente Prod", not a bare "Prod" */}
      {!labelled && <span className="sr-only">ambiente </span>}
      {style.label}
    </span>
  );
}

/** The engine as a two-letter code in a square cell; the full name is spelled out next to it. */
export function EngineCode({ engine, className }: EngineCodeProps) {
  return (
    <span
      aria-hidden
      title={ENGINE_LABEL[engine]}
      className={cn(
        "inline-grid size-6 shrink-0 place-items-center border border-current text-[0.75rem] legend tracking-[0.02em]",
        className
      )}
    >
      {ENGINE_CODE[engine]}
    </span>
  );
}
