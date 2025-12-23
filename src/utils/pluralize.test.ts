import { describe, expect, test } from "vitest";
import { pluralize } from "./pluralize.js";

describe("pluralize", () => {
  test("returns singular form with count 1", () => {
    expect(pluralize("action", "actions", 1)).toBe("1 action");
  });

  test("returns plural form with count 0", () => {
    expect(pluralize("action", "actions", 0)).toBe("0 actions");
  });

  test("returns plural form with count greater than 1", () => {
    expect(pluralize("action", "actions", 5)).toBe("5 actions");
  });

  test("handles irregular plurals", () => {
    expect(pluralize("workflow file", "workflow files", 1)).toBe("1 workflow file");
    expect(pluralize("workflow file", "workflow files", 3)).toBe("3 workflow files");
  });
});
