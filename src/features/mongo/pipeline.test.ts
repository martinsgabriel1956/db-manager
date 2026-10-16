import { expect, test } from "vitest";
import {
  mergeStages,
  newStage,
  pipelineOf,
  previewPipeline,
  splitPipeline,
  stageOperator
} from "@/features/mongo/pipeline";

test("stages are cut from the text exactly, values untouched", () => {
  const text =
    '[ {"$match": {"n": 9007199254740993, "d": 1.0, "s": "a]},{\\"b"}},\n{ "$set": {"l": {"$numberLong": "5"}, "a": [1, {"x": 2}]} } ]';

  expect(splitPipeline(text)).toEqual([
    '{"$match": {"n": 9007199254740993, "d": 1.0, "s": "a]},{\\"b"}}',
    '{ "$set": {"l": {"$numberLong": "5"}, "a": [1, {"x": 2}]} }'
  ]);
  expect(splitPipeline("[]")).toEqual([]);
  expect(splitPipeline("{}")).toBeNull();
  expect(splitPipeline("[1]")).toBeNull();
  expect(splitPipeline('[{"$match": {}')).toBeNull();
});

test("disabled stages stay out of the text and keep their place on merge", () => {
  const off = { ...newStage('{"$sort": {"a": 1}}'), enabled: false };
  const stages = [newStage('{"$match": {}}'), off, newStage('{"$limit": 5}')];

  expect(pipelineOf(stages)).toBe('[\n  {"$match": {}},\n  {"$limit": 5}\n]');
  expect(pipelineOf([{ ...stages[0], text: "{" }])).toBeNull();

  const merged = mergeStages(stages, ['{"$match": {"a": 1}}', '{"$limit": 6}', '{"$count": "n"}']);
  expect(merged.map(s => [s.text, s.enabled])).toEqual([
    ['{"$match": {"a": 1}}', true],
    ['{"$sort": {"a": 1}}', false],
    ['{"$limit": 6}', true],
    ['{"$count": "n"}', true]
  ]);
  expect(merged.slice(0, 3).map(s => s.id)).toEqual(stages.map(s => s.id));
  expect(mergeStages(stages, []).map(s => s.id)).toEqual([off.id]);
});

test("the preview runs the enabled stages up to the selected one, plus $limit, and never writes", () => {
  const stages = [
    newStage('{"$match": {"d": 1.0}}'),
    { ...newStage('{"$skip": 1}'), enabled: false },
    newStage('{"$group": {"_id": "$k"}}'),
    newStage('{"$out": "copy"}')
  ];

  expect(previewPipeline(stages, 2)).toBe(
    '[\n  {"$match": {"d": 1.0}},\n  {"$group": {"_id": "$k"}},\n  { "$limit": 20 }\n]'
  );
  expect(previewPipeline(stages, 3)).toBeNull();
  expect(stageOperator('{"$out": "copy"}')).toBe("$out");
  expect(stageOperator("{")).toBeNull();
});
