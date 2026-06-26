import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getColorSelectMenuPosition } from "./ColorSelect";

describe("getColorSelectMenuPosition", () => {
  it("positions the color menu in viewport coordinates below the trigger", () => {
    const position = getColorSelectMenuPosition({
      left: 24,
      bottom: 100,
      top: 56,
    } as DOMRect);

    assert.deepEqual(position, {
      left: 24,
      top: 108,
    });
  });
});
