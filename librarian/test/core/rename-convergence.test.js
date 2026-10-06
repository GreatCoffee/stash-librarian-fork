import test from "node:test";
import assert from "node:assert/strict";
import { planEntity } from "../../src/core/plan-scene.js";
import { normalizeConfig } from "../../src/core/config-schema.js";
import { utf8ByteLength } from "../../src/core/path-template.js";

// A rename tool has to reach a fixed point. If planning an already-renamed
// entity yields a different name, the next run moves it again and the one after
// that moves it back, and the file never settles.
//
// This is the property that a per-run unit test cannot show, because it needs
// the filesystem to actually change between passes. The registry below stands in
// for the filesystem: it holds the current path of every entity, and each pass
// commits the moves it planned by freeing the old path and taking the new one.

const SEP = String.fromCharCode(92);

// A Windows libraryRoot, because the byte budget exists for network shares and
// a POSIX root would not exercise the path handling the way the user's does.
const LIBRARY = "X:" + SEP + "AV";
const PATTERN =
  "[{code}][{performers}][{title|regex=/^(.{50})[\\s\\S]*$/$1.../}]";

function config() {
  return normalizeConfig({
    sanitize: { maxFilenameBytes: 255, duplicateSceneSuffix: 9 },
    scenes: {
      defaultPattern: {
        filenamePattern: PATTERN,
        folderPattern: "{current}",
        libraryRoot: LIBRARY,
      },
    },
  });
}

// A long CJK title, so the byte budget and the ellipsis marker are both in play.
function entity(id, code, title, performers) {
  const safeTitle = title.replace(/[[\]]/g, "");
  return {
    id: id,
    title: title,
    code: code,
    date: null,
    organized: true,
    rating100: null,
    studio: null,
    studio_id: null,
    performerNames: performers || [],
    performers: (performers || []).map((name, i) => ({
      id: String(1000 + i),
      name: name,
      gender: null,
      favorite: false,
      image_path: null,
      details: null,
      aliases: null,
    })),
    tags: [],
    stash_ids: [],
    files: [
      {
        id: 900000 + id,
        path: LIBRARY + SEP + "[" + code + "]" + safeTitle + ".mp4",
        parent_folder: { id: 70 },
      },
    ],
  };
}

const LONG_TITLE =
  "クラスの女子が僕の秘蔵のオナホを見つけ、オナホ使うところ見せてよ！勃起しないと無理だよ！" +
  "じゃ私の黒タイツパンツ見たら勃起する？2 と、まさかの神展開ゲットだぜ！";

// Plans one pass over the whole library against a registry that stands in for
// the filesystem, committing each move the way the backend does: free the old
// path, claim the new one.
function runPass(entities, cfg) {
  const registry = new Map();
  entities.forEach((e) => {
    (e.files || []).forEach((f) =>
      registry.set(String(f.path).toLowerCase(), e.id),
    );
  });

  const lookup = (path, selfId) => {
    const owner = registry.get(String(path).toLowerCase());
    if (owner === undefined) {
      return null;
    }
    return String(owner) === String(selfId) ? null : { id: owner };
  };

  const moves = [];
  entities.forEach((e) => {
    const from = e.files[0].path;
    const plan = planEntity(e, cfg, "scenes", null, { pathOwnerLookup: lookup });
    if (plan.status !== "ok") {
      return;
    }
    const f = plan.files[0];
    if (!f || f.unchanged) {
      return;
    }
    const to = f.folder + SEP + f.basename;
    if (registry.get(String(from).toLowerCase()) === e.id) {
      registry.delete(String(from).toLowerCase());
    }
    if (!registry.has(String(to).toLowerCase())) {
      registry.set(String(to).toLowerCase(), e.id);
    }
    e.files[0].path = to;
    moves.push({ id: e.id, from: from, to: to });
  });
  return moves;
}

function basenames(entities) {
  return entities.map((e) => e.files[0].path.split(SEP).pop());
}

test("a second pass over an already-renamed library moves nothing", () => {
  const cfg = config();
  const entities = [
    entity(1, "SW-933", LONG_TITLE, ["服部飛鳥", "水谷梨明日", "白浜みなみ"]),
    entity(2, "DVDMS-876", "较短的中文标题", ["测试演员"]),
    entity(3, "CAWD-447", "Another short one", []),
  ];

  const first = runPass(entities, cfg);
  assert.ok(first.length > 0, "the first pass has to actually rename something");

  const after = basenames(entities).slice();
  const second = runPass(entities, cfg);

  assert.deepEqual(
    second.map((m) => m.to.split(SEP).pop()),
    [],
    "a settled library must produce no moves, got: " + JSON.stringify(second),
  );
  assert.deepEqual(basenames(entities), after, "no name may drift on a re-run");
});

test("a long title is marked once and stays marked", () => {
  const cfg = config();
  const entities = [entity(1, "SW-933", LONG_TITLE, ["服部飛鳥"])];

  runPass(entities, cfg);
  const once = basenames(entities)[0];
  runPass(entities, cfg);
  const twice = basenames(entities)[0];

  assert.ok(once.includes("..."), "the first pass marks the clipped title");
  assert.equal(twice, once, "the marker must not be re-applied on top of itself");
  // A second "..." would mean the pattern re-clipped an already-clipped title.
  assert.equal(
    twice.split("...").length - 1,
    1,
    "exactly one ellipsis expected, got: " + twice,
  );
});

test("split releases settle on distinct names and stay there", () => {
  const cfg = config();
  // One release, five files, all carrying the same metadata: Stash models these
  // as five scenes sharing a title, so all five render one filename.
  const title = "いろいろなデニール数の黒タイツに挟まれたい…踏まれたい…絞められたい…";
  const entities = [1, 2, 3, 4, 5].map((n) =>
    entity(600 + n, "DPSVR-009", title, ["皆月ひかる"]),
  );

  runPass(entities, cfg);
  const names = basenames(entities);
  assert.equal(
    new Set(names.map((n) => n.toLowerCase())).size,
    5,
    "every copy needs its own name, got: " + JSON.stringify(names),
  );

  runPass(entities, cfg);
  assert.deepEqual(
    basenames(entities),
    names,
    "the suffixes must not be re-walked on a second pass",
  );
});

test("every produced name fits the budget and keeps its brackets balanced", () => {
  const cfg = config();
  const entities = [
    entity(1, "SW-933", LONG_TITLE, ["服部飛鳥", "水谷梨明日", "白浜みなみ"]),
    entity(2, "DVMM-107", LONG_TITLE, ["A", "B", "C", "D", "E", "F", "G"]),
    entity(3, "DVDMS-876", "较短的中文标题", ["测试演员"]),
  ];

  runPass(entities, cfg);

  basenames(entities).forEach((name) => {
    assert.ok(
      utf8ByteLength(name) <= 255,
      "over the SMB limit: " + utf8ByteLength(name) + "B " + name,
    );
    const opens = (name.match(/\[/g) || []).length;
    const closes = (name.match(/\]/g) || []).length;
    assert.equal(opens, closes, "unbalanced brackets: " + name);
  });
});

test("disambiguation and trimming compose without losing uniqueness", () => {
  // A long title that needs clipping AND a sibling copy that needs a suffix.
  // The suffix has to survive the trim, and the trim has to survive the suffix.
  const cfg = config();
  const title = LONG_TITLE;
  const entities = [1, 2, 3].map((n) =>
    entity(700 + n, "DVMM-107", title, ["木下ひまり", "Nia", "渚みつき", "美園和花"]),
  );

  runPass(entities, cfg);
  const names = basenames(entities);

  assert.equal(
    new Set(names.map((n) => n.toLowerCase())).size,
    3,
    "all three must stay distinct: " + JSON.stringify(names),
  );
  names.forEach((n) => {
    assert.ok(utf8ByteLength(n) <= 255, "over budget: " + utf8ByteLength(n) + "B " + n);
  });

  const before = names.slice();
  runPass(entities, cfg);
  assert.deepEqual(basenames(entities), before, "must settle after one pass");
});

test("a single-file library converges in one pass", () => {
  const cfg = config();
  const entities = [entity(1, "SW-933", LONG_TITLE, ["服部飛鳥"])];
  const first = runPass(entities, cfg);
  assert.equal(first.length, 1);
  assert.equal(runPass(entities, cfg).length, 0);
});
