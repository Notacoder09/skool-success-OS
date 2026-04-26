import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { harvestSkoolUuids, isSkoolUuid } from "./harvest";

const A = "a7c8f33668dc4bd49d4306c5c1ac3f12";
const B = "90d98eb5a4774afbbde9559d4c7a0291";
const C = "d9d745b78db4444e9c445f14ba453ba6";
const NOT_UUID = "hello-world";

describe("isSkoolUuid", () => {
  it("matches 32-char lowercase hex strings", () => {
    assert.equal(isSkoolUuid(A), true);
  });
  it("rejects uppercase, dashes, wrong lengths", () => {
    assert.equal(isSkoolUuid(A.toUpperCase()), false);
    assert.equal(isSkoolUuid(`${A.slice(0, 8)}-${A.slice(8)}`), false);
    assert.equal(isSkoolUuid(A.slice(0, 31)), false);
    assert.equal(isSkoolUuid(NOT_UUID), false);
  });
});

describe("harvestSkoolUuids", () => {
  it("finds UUIDs in nested objects and arrays", () => {
    const payload = {
      members: [
        { id: A, name: "Bill" },
        { id: B, name: "Yuy" },
      ],
      meta: { creator_id: C, label: NOT_UUID },
    };
    const ids = harvestSkoolUuids(payload, { exclude: new Set([C]) });
    assert.deepEqual(ids.sort(), [A, B].sort());
  });

  it("excludes IDs we already know about", () => {
    const ids = harvestSkoolUuids({ a: A, b: B }, { exclude: new Set([A]) });
    assert.deepEqual(ids, [B]);
  });

  it("dedupes IDs that appear multiple times", () => {
    const ids = harvestSkoolUuids(
      { x: A, y: A, z: { a: A } },
      { exclude: new Set() },
    );
    assert.deepEqual(ids, [A]);
  });

  it("returns an empty list for primitives and empty input", () => {
    assert.deepEqual(harvestSkoolUuids(null, { exclude: new Set() }), []);
    assert.deepEqual(harvestSkoolUuids(undefined, { exclude: new Set() }), []);
    assert.deepEqual(harvestSkoolUuids(42, { exclude: new Set() }), []);
    assert.deepEqual(harvestSkoolUuids("", { exclude: new Set() }), []);
    assert.deepEqual(harvestSkoolUuids({}, { exclude: new Set() }), []);
  });

  it("handles cycles without infinite-looping", () => {
    const obj: Record<string, unknown> = { id: A };
    obj.self = obj;
    const ids = harvestSkoolUuids(obj, { exclude: new Set() });
    assert.deepEqual(ids, [A]);
  });
});
