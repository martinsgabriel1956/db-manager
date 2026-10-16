import { expect, test } from "vitest";
import { prettyJson } from "@/features/redis/json";

test("JSON is re-indented without touching numbers or strings", () => {
  expect(prettyJson('{"n":18446744073709551615,"s":"a, {b}: \\"c\\"","l":[1,{}],"e":[ ]}')).toBe(
    [
      "{",
      '  "n": 18446744073709551615,',
      '  "s": "a, {b}: \\"c\\"",',
      '  "l": [',
      "    1,",
      "    {}",
      "  ],",
      '  "e": []',
      "}"
    ].join("\n")
  );
  expect(prettyJson("12345678901234567890")).toBe("12345678901234567890");
  expect(prettyJson('"só texto"')).toBe('"só texto"');
});
