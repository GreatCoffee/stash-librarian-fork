import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeConfig,
  blankPatternToCurrent,
  DEFAULT_CONFIG,
  resetSection,
  resetFormatting,
  availableEntityTypes,
  resolveActiveType,
} from "../../src/core/config-schema.js";

test("a fresh config (no raw at all) returns DEFAULT_CONFIG's own shape", () => {
  assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG);
});

test("raw values override the matching default, field by field", () => {
  const config = normalizeConfig({
    scenes: { onlyOrganized: false, rules: [{ id: "r1" }] },
  });
  assert.equal(config.scenes.onlyOrganized, false);
  assert.deepEqual(config.scenes.rules, [{ id: "r1" }]);
  // Untouched fields still fall back to their own default.
  assert.equal(config.scenes.onlyWithStashId, false);
  assert.equal(config.scenes.autoRename, false);
});

test("a partially-specified nested object (defaultPattern) is merged field by field, not replaced wholesale", () => {
  const config = normalizeConfig({
    scenes: { defaultPattern: { libraryRoot: "/data/main" } },
  });
  assert.equal(config.scenes.defaultPattern.libraryRoot, "/data/main");
  assert.equal(
    config.scenes.defaultPattern.folderPattern,
    DEFAULT_CONFIG.scenes.defaultPattern.folderPattern,
  );
  assert.deepEqual(config.scenes.defaultPattern.sortBy, ["name"]);
});

// mergeDefaults replaces a non-array with an array default, so a sortBy that
// is not a criteria list degrades to the default rather than erroring
test("a non-criteria sortBy degrades to the default rather than erroring", () => {
  const config = normalizeConfig({
    scenes: { defaultPattern: { sortBy: "nonsense" } },
  });
  assert.deepEqual(config.scenes.defaultPattern.sortBy, ["name"]);
});

test("a non-object raw value (null, a string, a number) is treated the same as no config at all", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig("nonsense"), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(42), DEFAULT_CONFIG);
});

test("normalizeConfig is idempotent: re-normalizing an already-normalized config changes nothing", () => {
  const once = normalizeConfig({ onlyOrganized: false, rules: [{ id: "r1" }] });
  const twice = normalizeConfig(once);
  assert.deepEqual(twice, once);
});

test("a hybrid config with stray top-level keys leaves the keys alone; sections stay the source of truth", () => {
  // entitySettings reads only the known sections, so a stray key like this
  // neither shadows a section nor gains a meaning
  const config = normalizeConfig({
    scenes: { rules: [{ id: "new" }] },
    rules: [{ id: "stale" }],
  });
  assert.deepEqual(config.scenes.rules, [{ id: "new" }]);
});

test("galleries and images default to a keep-in-place folder pattern", () => {
  const config = normalizeConfig(undefined);
  assert.equal(config.galleries.defaultPattern.folderPattern, "{current}");
  assert.equal(config.images.defaultPattern.folderPattern, "{current}");
});

// A blank pattern means nothing by itself. "Keep what this file already has"
// is spelled {current}: the planner refuses a bare blank with an error naming
// the token, and the pattern editor substitutes {current} the moment a field
// is cleared. "/" is the library root, not a blank
test("the planner refuses a blank pattern instead of guessing", () => {
  const config = normalizeConfig({
    scenes: { defaultPattern: { folderPattern: "  ", filenamePattern: "{title}" } },
  });
  // normalizeConfig no longer rewrites stored values: the blank is passed
  // through as stored, and it is the planner that names the fix
  assert.equal(config.scenes.defaultPattern.folderPattern, "  ");
  assert.equal(config.scenes.defaultPattern.filenamePattern, "{title}");
});

test("global formatting settings stay at the top level, not moved into scenes", () => {
  const config = normalizeConfig({
    rules: [{ id: "r1" }],
    delimiters: { performers: " & ", tags: ", " },
    sanitize: { maxSegmentLength: 120, spaceReplacement: "." },
  });
  assert.equal(config.delimiters.performers, " & ");
  assert.equal(config.sanitize.spaceReplacement, ".");
  assert.equal(config.scenes.delimiters, undefined);
});

test("an already-migrated config is left alone rather than migrated a second time", () => {
  const already = {
    scenes: { rules: [{ id: "kept" }], onlyOrganized: false },
    images: { rules: [{ id: "img" }] },
  };
  const config = normalizeConfig(already);
  assert.deepEqual(config.scenes.rules, [{ id: "kept" }]);
  assert.equal(config.scenes.onlyOrganized, false);
  assert.deepEqual(config.images.rules, [{ id: "img" }]);
});

test("resetting a section restores its defaults but keeps rules, switched off", () => {
  const config = normalizeConfig({
    scenes: {
      autoRename: false,
      onlyOrganized: false,
      rules: [
        { id: "a", name: "Keep me", enabled: true },
        { id: "b", name: "Already off", enabled: false },
      ],
      defaultPattern: { folderPattern: "custom", libraryRoot: "/x" },
    },
  });
  const out = resetSection(config, "scenes");

  assert.equal(out.scenes.autoRename, DEFAULT_CONFIG.scenes.autoRename);
  assert.equal(out.scenes.onlyOrganized, DEFAULT_CONFIG.scenes.onlyOrganized);
  assert.equal(
    out.scenes.defaultPattern.folderPattern,
    DEFAULT_CONFIG.scenes.defaultPattern.folderPattern,
  );
  assert.equal(out.scenes.defaultPattern.libraryRoot, "");

  // the rules themselves survive, only disabled
  assert.equal(out.scenes.rules.length, 2);
  assert.equal(out.scenes.rules[0].name, "Keep me");
  assert.deepEqual(
    out.scenes.rules.map((r) => r.enabled),
    [false, false],
  );
});

test("resetting one section leaves the others and the global settings alone", () => {
  const config = normalizeConfig({
    scenes: { autoRename: false },
    images: { autoRename: true, rules: [{ id: "i", enabled: true }] },
    delimiters: { performers: " & ", tags: ", " },
  });
  const out = resetSection(config, "scenes");
  assert.deepEqual(out.images.rules, [{ id: "i", enabled: true }]);
  assert.equal(out.images.autoRename, true);
  assert.equal(out.delimiters.performers, " & ");
});

test("resetting does not mutate DEFAULT_CONFIG, so a later reset still works", () => {
  const config = normalizeConfig({ scenes: { rules: [{ id: "a" }] } });
  const out = resetSection(config, "scenes");
  out.scenes.defaultPattern.folderPattern = "clobbered";
  out.scenes.rules.push({ id: "extra" });

  assert.notEqual(
    DEFAULT_CONFIG.scenes.defaultPattern.folderPattern,
    "clobbered",
  );
  assert.equal(DEFAULT_CONFIG.scenes.rules.length, 0);
  assert.equal(resetSection(config, "scenes").scenes.rules.length, 1);
});

test("resetting an unknown entity type is a no-op rather than a crash", () => {
  const config = normalizeConfig({ scenes: { autoRename: false } });
  assert.equal(resetSection(config, "nonsense"), config);
});

test("resetting formatting restores the shared settings and nothing else", () => {
  const config = normalizeConfig({
    scenes: {
      autoRename: false,
      rules: [{ id: "a", name: "Keep me", enabled: true }],
      defaultPattern: { folderPattern: "custom" },
    },
    images: { rules: [{ id: "i", enabled: true }] },
    delimiters: { performers: " & ", tags: " | " },
    sanitize: { maxSegmentLength: 80, spaceReplacement: "." },
  });
  const out = resetFormatting(config);

  assert.deepEqual(out.delimiters, DEFAULT_CONFIG.delimiters);
  assert.deepEqual(out.sanitize, DEFAULT_CONFIG.sanitize);

  // the entity sections, including rules, are untouched
  assert.equal(out.scenes.autoRename, false);
  assert.equal(out.scenes.defaultPattern.folderPattern, "custom");
  assert.deepEqual(out.scenes.rules, [
    { id: "a", name: "Keep me", enabled: true },
  ]);
  assert.deepEqual(out.images.rules, [{ id: "i", enabled: true }]);
});

test("resetting formatting does not mutate DEFAULT_CONFIG", () => {
  const config = normalizeConfig({ sanitize: { spaceReplacement: "." } });
  const out = resetFormatting(config);
  out.delimiters.performers = "clobbered";
  out.sanitize.maxSegmentLength = 1;
  assert.notEqual(DEFAULT_CONFIG.delimiters.performers, "clobbered");
  assert.notEqual(DEFAULT_CONFIG.sanitize.maxSegmentLength, 1);
});

test("the two resets are complementary: neither touches the other's settings", () => {
  const config = normalizeConfig({
    scenes: { autoRename: false, rules: [{ id: "a", enabled: true }] },
    delimiters: { performers: " & ", tags: " | " },
  });
  // resetting a section leaves formatting alone
  assert.equal(resetSection(config, "scenes").delimiters.performers, " & ");
  // resetting formatting leaves the section alone
  assert.equal(resetFormatting(config).scenes.autoRename, false);
});

test("a type with no entities gets no tab, whichever type it is", () => {
  assert.deepEqual(
    availableEntityTypes({ scenes: 7, galleries: 8, images: 22 }),
    ["scenes", "galleries", "images"],
  );
  assert.deepEqual(
    availableEntityTypes({ scenes: 7, galleries: 0, images: 0 }),
    ["scenes"],
  );
  // an image-only Stash hides scenes too
  assert.deepEqual(
    availableEntityTypes({ scenes: 0, galleries: 0, images: 5 }),
    ["images"],
  );
  assert.deepEqual(
    availableEntityTypes({ scenes: 0, galleries: 0, images: 0 }),
    [],
  );
});

test("unknown counts show every tab, rather than hiding settings", () => {
  // the stats query failing must not lock the user out of their own config
  assert.deepEqual(availableEntityTypes(null), [
    "scenes",
    "galleries",
    "images",
  ]);
  assert.deepEqual(availableEntityTypes(undefined), [
    "scenes",
    "galleries",
    "images",
  ]);
});

test("a missing count is treated as none, not as unknown", () => {
  assert.deepEqual(availableEntityTypes({ scenes: 3 }), ["scenes"]);
});

test("the active tab falls back when the remembered one is no longer available", () => {
  assert.equal(resolveActiveType(["scenes", "images"], "images"), "images");
  // remembered galleries, but they have all gone
  assert.equal(resolveActiveType(["scenes", "images"], "galleries"), "scenes");
  // image-only library, remembered default of scenes
  assert.equal(resolveActiveType(["images"], "scenes"), "images");
  assert.equal(resolveActiveType([], "scenes"), undefined);
});

// The pattern editor calls this the moment a field is cleared, so a blank never
// reaches the page state at all: without it the preview would spend the time
// between the edit and the save reporting a pattern the save was going to
// rewrite anyway
test("blankPatternToCurrent turns an empty pattern into the token", () => {
  assert.equal(blankPatternToCurrent(""), "{current}");
  assert.equal(blankPatternToCurrent("   "), "{current}");
  assert.equal(blankPatternToCurrent(undefined), "{current}");
  assert.equal(blankPatternToCurrent(null), "{current}");
  // anything the user actually wrote is left exactly as typed
  assert.equal(blankPatternToCurrent("{title}"), "{title}");
  assert.equal(blankPatternToCurrent("/"), "/");
  assert.equal(blankPatternToCurrent(" {studio} "), " {studio} ");
});
