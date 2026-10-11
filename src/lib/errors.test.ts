import { expect, test } from "vitest";
import { errorMessage } from "@/lib/errors";

test("reads the message of a serialized AppError", () => {
  expect(errorMessage({ kind: "notFound", message: "conexão não encontrada: x" })).toBe(
    "conexão não encontrada: x"
  );
});

test("reads the message of an Error instance", () => {
  expect(errorMessage(new Error("boom"))).toBe("boom");
});

test("stringifies anything else", () => {
  expect(errorMessage("plain")).toBe("plain");
  expect(errorMessage(null)).toBe("null");
});
