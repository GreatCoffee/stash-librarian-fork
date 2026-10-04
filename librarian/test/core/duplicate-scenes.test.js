import test from "node:test";
import assert from "node:assert/strict";
import {
  disambiguateDuplicateScenes,
  pathClaimedByOtherScene,
  createRegistryLookup,
} from "../../src/core/duplicate-scenes.js";
import { joinPath } from "../../src/core/path-template.js";

// Built from a char code so the test file cannot be corrupted by a shell or
// editor eating the backslashes, which is exactly the bug this guards against.
const SEP = String.fromCharCode(92);
const FOLDER = "X:" + SEP + "AV";

function options(lookup, maxSuffix) {
  return {
    folder: FOLDER,
    basenameNoExt: "[DPSVR-009][皆月ひかる][タイトル]",
    extension: ".mp4",
    selfId: 670,
    maxSuffix: maxSuffix === undefined ? 9 : maxSuffix,
    joinPath: joinPath,
    lookup: lookup,
  };
}

// Reports the given full paths as owned, everything else as free.
function lookupOwning(owned) {
  const set = new Set(owned);
  return function lookup(path) {
    return set.has(path) ? { id: 999 } : null;
  };
}

test("a free name is left alone", () => {
  const result = disambiguateDuplicateScenes(options(lookupOwning([])));
  assert.equal(result.basenameNoExt, "[DPSVR-009][皆月ひかる][タイトル]");
  assert.equal(result.collided, false);
  assert.equal(result.suffix, "");
});

test("a name another scene holds gains _1", () => {
  const base = "[DPSVR-009][皆月ひかる][タイトル]";
  const result = disambiguateDuplicateScenes(
    options(lookupOwning([joinPath(FOLDER, base + ".mp4")])),
  );
  assert.equal(result.basenameNoExt, base + "_1");
  assert.equal(result.collided, true);
  assert.equal(result.suffix, "_1");
});

test("successive collisions walk further up the suffix series", () => {
  // Five scenes rendering one name. Each caller must skip the names its
  // predecessors already claimed, so the set of taken paths grows as we go.
  const base = "[DPSVR-009][皆月ひかる][タイトル]";
  const owned = new Set();
  const lookup = function lookup(path) {
    return owned.has(path) ? { id: 999 } : null;
  };
  const results = [];
  for (let i = 0; i < 5; i++) {
    const result = disambiguateDuplicateScenes(options(lookup));
    results.push(result.basenameNoExt);
    owned.add(joinPath(FOLDER, result.basenameNoExt + ".mp4"));
  }
  assert.equal(
    new Set(results).size,
    5,
    "every scene must get its own name: " + results,
  );
  assert.equal(results[0], base, "the first caller keeps the plain name");
  assert.equal(results[1], base + "_1");
  assert.equal(results[4], base + "_4");
});

test("a scene does not collide with itself", () => {
  const base = "[DPSVR-009][皆月ひかる][タイトル]";
  // The lookup reports the path as owned, but by this very scene.
  const lookup = createRegistryLookup(
    new Map([[joinPath(FOLDER, base + ".mp4").toLowerCase(), 670]]),
    670,
  );
  const result = disambiguateDuplicateScenes(options(lookup));
  assert.equal(result.basenameNoExt, base);
  assert.equal(result.collided, false);
});

test("a failed lookup is not read as a free path", () => {
  // Reading failure as "free" is how a rename clobbers someone else's file, so
  // the pattern's own name is kept and no suffix is invented.
  const lookup = function lookup() {
    throw new Error("network down");
  };
  const result = disambiguateDuplicateScenes(options(lookup));
  assert.equal(result.basenameNoExt, "[DPSVR-009][皆月ひかる][タイトル]");
  assert.equal(result.skipped, true);
  assert.equal(result.suffix, "");
});

test("an unknown answer stops the walk instead of guessing", () => {
  const lookup = function lookup() {
    return { id: null, unknown: true };
  };
  const result = disambiguateDuplicateScenes(options(lookup));
  assert.equal(result.skipped, true);
  assert.equal(result.suffix, "");
});

test("a suffix limit of 0 disables disambiguation entirely", () => {
  const base = "[DPSVR-009][皆月ひかる][タイトル]";
  const result = disambiguateDuplicateScenes(
    options(lookupOwning([joinPath(FOLDER, base + ".mp4")]), 0),
  );
  assert.equal(result.basenameNoExt, base);
  assert.equal(result.collided, false);
});

test("running out of suffixes reports exhaustion rather than lying", () => {
  const base = "[DPSVR-009][皆月ひかる][タイトル]";
  const owned = [];
  for (let n = 0; n <= 9; n++) {
    owned.push(joinPath(FOLDER, (n === 0 ? base : base + "_" + n) + ".mp4"));
  }
  const result = disambiguateDuplicateScenes(options(lookupOwning(owned), 9));
  assert.equal(result.exhausted, true);
  assert.equal(result.collided, true);
});

test("no lookup at all leaves the name untouched", () => {
  const result = disambiguateDuplicateScenes(options(undefined));
  assert.equal(result.basenameNoExt, "[DPSVR-009][皆月ひかる][タイトル]");
  assert.equal(result.collided, false);
});

test("the registry lookup matches paths case-insensitively", () => {
  // Windows and SMB treat these paths as the same file, so an exact-case
  // comparison would miss a real collision.
  const lower = "x:" + SEP + "av" + SEP + "[abc].mp4";
  const registry = new Map([[lower, 42]]);
  const lookup = createRegistryLookup(registry, 670);
  const owner = pathClaimedByOtherScene(
    lookup,
    670,
    "X:" + SEP + "AV" + SEP + "[ABC].mp4",
  );
  assert.ok(owner, "expected a case-insensitive match");
  assert.equal(owner.id, 42);
});

test("a missing path in the registry reads as free", () => {
  const lookup = createRegistryLookup(new Map(), 670);
  assert.equal(pathClaimedByOtherScene(lookup, 670, "X:\\AV\\[abc].mp4"), null);
});
