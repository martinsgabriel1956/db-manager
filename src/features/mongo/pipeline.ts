// The pipeline text is the source of truth. Stages are cut out of it as text and
// joined back as text, never parsed and re-serialized: JSON.parse would turn `1.0`
// (a Double) into `1` (an Int32) and round integers above 2^53.

export type Stage = { id: string; text: string; enabled: boolean };

/** Appended to every preview; shown in the UI, never written into the pipeline. */
export const PREVIEW_LIMIT = 20;

const WRITE_STAGES = ["$out", "$merge"];

export function isStageText(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** The stages' exact source text; null unless `text` is a JSON array of objects. */
export function splitPipeline(text: string): string[] | null {
  try {
    const value: unknown = JSON.parse(text);
    if (
      !Array.isArray(value) ||
      !value.every(s => s !== null && typeof s === "object" && !Array.isArray(s))
    ) {
      return null;
    }
  } catch {
    return null;
  }
  // valid JSON whose elements are all objects: each one opens and closes at depth 1
  const stages: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") {
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      if (depth === 1) {
        start = i;
      }
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 1) {
        stages.push(text.slice(start, i + 1));
      }
    }
  }
  return stages;
}

export function joinPipeline(stages: string[]): string {
  return stages.length === 0 ? "[]" : `[\n  ${stages.join(",\n  ")}\n]`;
}

/** The stage's operator ("$match"), or null while its text is not a stage. */
export function stageOperator(text: string): string | null {
  return isStageText(text) ? (Object.keys(JSON.parse(text) as object)[0] ?? null) : null;
}

export function newStage(text: string): Stage {
  return { id: crypto.randomUUID(), text, enabled: true };
}

/**
 * Replaces the enabled stages, in order, with the ones now in the pipeline text.
 * Disabled stages are not in the text: they keep their place among the others.
 */
export function mergeStages(stages: Stage[], texts: string[]): Stage[] {
  const queue = [...texts];
  const merged = stages.flatMap(stage => {
    if (!stage.enabled) {
      return [stage];
    }
    const text = queue.shift();
    return text === undefined ? [] : [{ ...stage, text }];
  });
  return [...merged, ...queue.map(newStage)];
}

/** The pipeline the stages make, or null while an enabled stage is not valid. */
export function pipelineOf(stages: Stage[]): string | null {
  const enabled = stages.filter(stage => stage.enabled).map(stage => stage.text);
  return enabled.every(isStageText) ? joinPipeline(enabled) : null;
}

/**
 * The enabled stages up to `index`, plus the preview's $limit. Null when one of
 * them writes ($out/$merge): a preview never writes, and nothing may follow them.
 */
export function previewPipeline(stages: Stage[], index: number): string | null {
  const texts = stages
    .slice(0, index + 1)
    .filter(stage => stage.enabled)
    .map(stage => stage.text);
  if (!texts.every(isStageText) || texts.some(isWriteStage)) {
    return null;
  }
  return joinPipeline([...texts, `{ "$limit": ${PREVIEW_LIMIT} }`]);
}

export function isWriteStage(text: string): boolean {
  return WRITE_STAGES.includes(stageOperator(text) ?? "");
}
