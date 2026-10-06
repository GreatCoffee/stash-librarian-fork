import test from "node:test";
import assert from "node:assert/strict";
import {
  utf8ByteLength,
  fitBasenameToBudget,
  renderPath,
} from "../../src/core/path-template.js";
import { normalizeConfig } from "../../src/core/config-schema.js";
import { planEntity } from "../../src/core/plan-scene.js";

// Measured against an SMB mount, not quoted from a spec: 254 bytes was accepted
// and 256 was refused with EINVAL. That is the limit these tests protect.
const SMB_LIMIT = 255;

const PATTERN = "[{code}][{performers}][{title}]";
const LIBRARY = "X:\\" + "AV";
const SEP = "\\";
const FOLDER = LIBRARY + "\\Movies";

// A real name from the library that failed to rename before a byte guard
// existed: 114 characters but 298 UTF-8 bytes, because CJK costs 3 bytes each.
const SW933_TITLE =
  "クラスの女子が僕の秘蔵のオナホを見つけ、オナホ使うところ見せてよ！勃起しないと無理だよ！" +
  "じゃ私の黒タイツパンツ見たら勃起する？2 と、まさかの神展開ゲットだぜ！";
const PERFORMERS = ["服部飛鳥", "水谷梨明日", "白浜みなみ"];

function config(sanitizeOverride) {
  return normalizeConfig({
    sanitize: Object.assign(
      {
        maxFilenameBytes: SMB_LIMIT,
        filenameEllipsis: true,
        duplicateSceneSuffix: 9,
        maxFullPathBytes: 0,
      },
      sanitizeOverride,
    ),
    scenes: {
      defaultPattern: {
        filenamePattern: PATTERN,
        folderPattern: "{current}",
        libraryRoot: LIBRARY,
      },
    },
  });
}

function sceneView(id, title, performers, overrides) {
  const view = {
    id: id,
    title: title,
    code: "SW-933",
    date: null,
    organized: true,
    rating100: null,
    studioNames: [],
    studio: null,
    performerNames: performers,
    performers: performers.map((name, i) => ({
      id: String(1000 + i),
      name: name,
      gender: null,
      favorite: false,
      image_path: null,
      details: null,
      aliases: null,
    })),
    tags: [],
    stashIds: [],
  };
  return Object.assign(view, overrides || {});
}

// Renders the name the pattern would write, then fits it: this is the exact
// order plan-scene runs it in.
function fitted(scene, opts) {
  const options = opts || {};
  const cfg = config(options.sanitize);
  const currentPath = { folder: FOLDER, basename: "whatever" };
  const rendered = renderPath("{current}", PATTERN, scene, cfg, null, currentPath);
  return fitBasenameToBudget({
    folderPattern: "{current}",
    filenamePattern: PATTERN,
    sceneView: scene,
    config: cfg,
    matchedIds: null,
    currentPath: currentPath,
    rendered: rendered,
    extension: ".mp4",
    budget: options.budget ?? SMB_LIMIT,
    ellipsis: options.ellipsis ?? true,
  });
}

test("the name that motivated this fits after fitting", () => {
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS));
  const out = fit.basenameNoExt + ".mp4";
  assert.ok(
    utf8ByteLength(out) <= SMB_LIMIT,
    "expected <= 255 bytes, got " + utf8ByteLength(out),
  );
});

test("a name that already fits is returned byte-for-byte", () => {
  const scene = sceneView(1, "短いタイトル", PERFORMERS);
  const fit = fitted(scene);
  assert.equal(fit.clipped, false, "nothing was clipped");
  assert.ok(fit.basenameNoExt.startsWith("[SW-933]"), "code intact");
});

test("a shortened name keeps code and performers intact — the title gives ground alone", () => {
  // The old string-layer trimmer began damaging the performer group at a
  // budget of 76B (measured). The token-layer fit must spend ONLY the title.
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS), {
    budget: 76,
  });
  const expectFixed = "[SW-933][服部飛鳥, 水谷梨明日, 白浜みなみ][";
  assert.ok(
    fit.basenameNoExt.startsWith(expectFixed),
    "code and performers must survive intact: " + fit.basenameNoExt,
  );
  assert.ok(fit.clipped, "the title did get cut");
});

test("a 76-byte budget leaves the title 2 bytes: it empties honestly rather than faking a marker", () => {
  // 76 - 4(ext) - 12(suffix room) = 60; the fixed parts take 58, so the title
  // has 2 bytes — less than one CJK char, less than "...". The old trimmer
  // answered this by marking the PERFORMERS bracket with "..." while dropping
  // the whole title (misattributed marker). The fit leaves the title empty.
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS), {
    budget: 76,
  });
  assert.ok(
    fit.basenameNoExt.endsWith("[]"),
    "an emptied title leaves the pattern's own brackets: " + fit.basenameNoExt,
  );
  assert.ok(
    utf8ByteLength(fit.basenameNoExt + ".mp4") <= 76,
    "expected <= 76 bytes, got " + utf8ByteLength(fit.basenameNoExt + ".mp4"),
  );
});

test("a 100-byte budget keeps a marked partial title", () => {
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS), {
    budget: 100,
  });
  assert.ok(
    fit.basenameNoExt.endsWith("...]"),
    "the marker belongs at the end of the title value: " + fit.basenameNoExt,
  );
  assert.ok(
    fit.basenameNoExt.startsWith("[SW-933][服部飛鳥, 水谷梨明日, 白浜みなみ]["),
    "fixed parts intact: " + fit.basenameNoExt,
  );
});

test("a budget too small for the fixed parts is refused, not emptied", () => {
  // The old trimmer returned "" (a nameless file) at budget <= 20 and junk
  // like "[...]" at 21-24. The fit refuses instead.
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS), {
    budget: 20,
  });
  assert.equal(fit.infeasible, true);
  assert.match(fit.message, /even with|no \{title\} token/);
});

test("a non-bracket template gets the marker too", () => {
  // The old marker only fired when the name ended with "]"; templates without
  // brackets paid 3 reserved bytes and showed nothing.
  const patternBare = "{title}";
  const scene = sceneView(1, "水".repeat(60), []);
  const cfg = config();
  const currentPath = { folder: FOLDER, basename: "whatever" };
  const rendered = renderPath(
    "{current}",
    patternBare,
    scene,
    cfg,
    null,
    currentPath,
  );
  const fit = fitBasenameToBudget({
    folderPattern: "{current}",
    filenamePattern: patternBare,
    sceneView: scene,
    config: cfg,
    matchedIds: null,
    currentPath: currentPath,
    rendered: rendered,
    extension: ".mp4",
    budget: 120,
    ellipsis: true,
  });
  assert.equal(fit.clipped, true);
  // the marker may be eaten by the segment sanitizer when the title is the
  // pattern's last token, but the bytes must fit either way
  assert.ok(utf8ByteLength(fit.basenameNoExt + ".mp4") <= 120);
});

test("room is left for the multi-file suffix assignSuffixes adds later", () => {
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS));
  const withSuffix = fit.basenameNoExt + " (2)" + ".mp4";
  assert.ok(
    utf8ByteLength(withSuffix) <= SMB_LIMIT,
    "expected <= 255 bytes once ' (2)' is added, got " +
      utf8ByteLength(withSuffix),
  );
});

test("the same cut lands on every run — fitting twice changes nothing", () => {
  const scene = sceneView(1, SW933_TITLE, PERFORMERS);
  const one = fitted(scene);
  const two = fitted(scene);
  assert.equal(one.basenameNoExt, two.basenameNoExt);
});

test("the marker never stacks beyond one", () => {
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS));
  assert.equal(
    fit.basenameNoExt.split("...").length - 1,
    1,
    "exactly one ellipsis expected, got: " + fit.basenameNoExt,
  );
});

test("a zero or negative budget disables trimming", () => {
  const fit = fitted(sceneView(1, SW933_TITLE, PERFORMERS), {
    budget: 0,
  });
  assert.equal(fit.clipped, false);
  assert.equal(fit.infeasible, false);
});

test("stored values override the defaults", () => {
  const config2 = normalizeConfig({
    sanitize: { maxFilenameBytes: 200, duplicateSceneSuffix: 0 },
  });
  assert.equal(config2.sanitize.maxFilenameBytes, 200);
  assert.equal(config2.sanitize.duplicateSceneSuffix, 0);
});

test("a pattern with no {title} is refused rather than cut blind", () => {
  const patternNoTitle = "[{code}][{performers}]";
  const scene = sceneView(1, SW933_TITLE, PERFORMERS);
  const cfg = config();
  const currentPath = { folder: FOLDER, basename: "whatever" };
  const rendered = renderPath(
    "{current}",
    patternNoTitle,
    scene,
    cfg,
    null,
    currentPath,
  );
  const fit = fitBasenameToBudget({
    folderPattern: "{current}",
    filenamePattern: patternNoTitle,
    sceneView: scene,
    config: cfg,
    matchedIds: null,
    currentPath: currentPath,
    rendered: rendered,
    extension: ".mp4",
    budget: 50,
    ellipsis: true,
  });
  assert.equal(fit.infeasible, true);
  assert.match(fit.message, /no \{title\} token/);
});

test("a kept name over the budget stays byte for byte and is reported", () => {
  // A1: a kept ({current}) name is not made of rendered tokens, so the byte
  // budget has nothing it is allowed to spend. The name keeps every byte it
  // has on disk, and the plan says so instead of leaving a silent over-limit
  // name behind.
  const longName = "水".repeat(90) + ".mp4"; // 270 bytes + extension already in
  const cfg = normalizeConfig({
    sanitize: {
      maxFilenameBytes: SMB_LIMIT,
      filenameEllipsis: true,
      duplicateSceneSuffix: 9,
    },
    scenes: {
      defaultPattern: {
        filenamePattern: "{current}",
        // a rendering folder pattern, so this is not the both-keep skip
        folderPattern: "Sorted",
        libraryRoot: LIBRARY,
      },
    },
  });
  const entity = {
    id: 11,
    title: "whatever",
    code: null,
    date: null,
    organized: true,
    rating100: null,
    studio: null,
    studio_id: null,
    performerNames: [],
    performers: [],
    tags: [],
    stash_ids: [],
    files: [
      {
        id: 900111,
        path: LIBRARY + SEP + "Old" + SEP + longName,
        parent_folder: { id: 70 },
      },
    ],
  };
  const plan = planEntity(entity, cfg, "scenes", null, {});
  assert.equal(plan.status, "ok");
  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].basename, longName, "kept name untouched");
  assert.ok(
    plan.warnings.some((w) => /kept name exceeds the filename byte budget/.test(w)),
    "expected a kept-name warning, got: " + JSON.stringify(plan.warnings),
  );
});
