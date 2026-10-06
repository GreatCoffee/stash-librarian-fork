import test from "node:test";
import assert from "node:assert/strict";
import { planEntity } from "../../src/core/plan-scene.js";
import {
  normalizeConfig,
  DEFAULT_CONFIG,
  resetFormatting,
} from "../../src/core/config-schema.js";
import { utf8ByteLength } from "../../src/core/path-template.js";

// The three switches in the formatting panel control behaviour that used to
// depend on the pattern: shortening overlong names, marking what was shortened,
// and numbering files of a split release. These tests pin the switches
// themselves, since a switch that does nothing reads as a broken feature.

const SEP = String.fromCharCode(92);
const LIB = "X:" + SEP + "AV";
const LONG =
  "クラスの女子が僕の秘蔵のオナホを見つけ、オナホ使うところ見せてよ！勃起しないと無理だよ！" +
  "じゃ私の黒タイツパンツ見たら勃起する？2 と、まさかの神展開ゲットだぜ！";

function cfg(sanitize) {
  return normalizeConfig({
    sanitize: sanitize,
    scenes: {
      defaultPattern: {
        filenamePattern: "[{code}][{performers}][{title}]",
        folderPattern: "{current}",
        libraryRoot: LIB,
      },
    },
  });
}

function entity(id, code, title, performers) {
  return {
    id: id,
    title: title,
    code: code,
    date: null,
    organized: true,
    rating100: null,
    studio: null,
    studio_id: null,
    performers: (performers || []).map((n, i) => ({
      id: String(1000 + i),
      name: n,
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
        path: LIB + SEP + "[" + code + "]orig.mp4",
        parent_folder: { id: 70 },
      },
    ],
  };
}

const ALL_ON = {
  maxFilenameBytes: 255,
  filenameEllipsis: true,
  duplicateSceneSuffix: 9,
};

test("the defaults enable all three behaviours", () => {
  assert.equal(DEFAULT_CONFIG.sanitize.maxFilenameBytes, 255);
  assert.equal(DEFAULT_CONFIG.sanitize.filenameEllipsis, true);
  assert.equal(DEFAULT_CONFIG.sanitize.duplicateSceneSuffix, 9);
});

test("a config saved before filenameEllipsis existed keeps the marker", () => {
  // An absent key must not read as false, or upgrading would silently drop the
  // marker off every existing name.
  const c = normalizeConfig({ sanitize: { maxFilenameBytes: 255 } });
  assert.equal(c.sanitize.filenameEllipsis, true);
});

test("shortening on, marker on: fits and carries the ellipsis", () => {
  const r = planEntity(
    entity(1, "SW-933", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"]),
    cfg(ALL_ON),
    "scenes",
    null,
  );
  assert.equal(r.status, "ok");
  const b = r.files[0].basename;
  assert.ok(utf8ByteLength(b) <= 255, "got " + utf8ByteLength(b) + "B: " + b);
  assert.ok(b.includes("..."), "expected a marker in " + b);
  assert.equal(
    (b.match(/\[/g) || []).length,
    (b.match(/\]/g) || []).length,
    "brackets must stay balanced: " + b,
  );
});

test("shortening on, marker off: fits and carries no marker", () => {
  const r = planEntity(
    entity(1, "SW-933", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"]),
    cfg(Object.assign({}, ALL_ON, { filenameEllipsis: false })),
    "scenes",
    null,
  );
  assert.equal(r.status, "ok");
  const b = r.files[0].basename;
  assert.ok(utf8ByteLength(b) <= 255, "got " + utf8ByteLength(b) + "B: " + b);
  assert.ok(!b.includes("..."), "marker was turned off, got " + b);
  // without the marker the clip is less aggressive: three more bytes fit
  assert.ok(b.length > 0);
});

test("the marker is counted inside the budget, not added after it", () => {
  // Trimming to exactly the limit and then appending "..." would overshoot by
  // three, forcing a second pass that moves the name again. Both variants must
  // land at or under the limit on the first pass.
  [true, false].forEach((mark) => {
    const r = planEntity(
      entity(1, "SW-933", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"]),
      cfg(Object.assign({}, ALL_ON, { filenameEllipsis: mark })),
      "scenes",
      null,
    );
    const b = r.files[0].basename;
    assert.ok(
      utf8ByteLength(b) <= 255,
      "mark=" + mark + " produced " + utf8ByteLength(b) + "B",
    );
  });
});

test("shortening off: the overlong name is left alone", () => {
  const r = planEntity(
    entity(1, "SW-933", LONG, ["服部飛鳥"]),
    cfg(Object.assign({}, ALL_ON, { maxFilenameBytes: 0 })),
    "scenes",
    null,
  );
  assert.equal(r.status, "ok");
  const b = r.files[0].basename;
  assert.ok(
    utf8ByteLength(b) > 255,
    "with shortening off the name must be left overlong, got " +
      utf8ByteLength(b) +
      "B",
  );
  assert.ok(!b.includes("..."), "nothing was shortened, so nothing is marked");
});

test("numbering off: a second copy of a release collides instead of suffixing", () => {
  const e = entity(1, "DPSVR-009", "いろいろなデニール数の黒タイツ", [
    "皆月ひかる",
  ]);
  const reg = new Map();
  const plan = (lookup) =>
    planEntity(
      e,
      cfg(Object.assign({}, ALL_ON, { duplicateSceneSuffix: 0 })),
      "scenes",
      null,
      {
        pathOwnerLookup: lookup,
      },
    );

  // with numbering off nothing is claimed, so the plan carries no suffix
  const free = plan(() => null);
  assert.equal(free.files[0].duplicateSuffix || "", "");

  // and a sibling holding that path is not detected, which is the collision
  const taken = new Map([["x:\\av\\whatever.mp4", 999]]);
  const clash = plan((p) =>
    taken.has(String(p).toLowerCase()) ? { id: 999 } : null,
  );
  assert.equal(
    clash.files[0].duplicateSuffix || "",
    "",
    "numbering is off, so no suffix is invented",
  );
  assert.equal(reg.size, 0);
});

test("numbering on: a second copy of a release takes _1", () => {
  const base = entity(1, "DPSVR-009", "いろいろなデニール数の黒タイツ", [
    "皆月ひかる",
  ]);
  const plain = planEntity(base, cfg(ALL_ON), "scenes", null, {
    pathOwnerLookup: () => null,
  });
  const target = plain.files[0].basename;
  const owner = new Map([[String(LIB + SEP + target).toLowerCase(), 1]]);

  const second = planEntity(
    entity(2, "DPSVR-009", "いろいろなデニール数の黒タイツ", ["皆月ひかる"]),
    cfg(ALL_ON),
    "scenes",
    null,
    {
      pathOwnerLookup: (p, self) => {
        const o = owner.get(String(p).toLowerCase());
        if (o === undefined) return null;
        return String(o) === String(self) ? null : { id: o };
      },
    },
  );
  assert.equal(second.files[0].duplicateSuffix, "_1");
  assert.notEqual(second.files[0].basename, target);
});

test("all three off: no whole-name clip, no marker, no suffix", () => {
  const r = planEntity(
    entity(1, "SW-933", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"]),
    cfg({
      maxFilenameBytes: 0,
      filenameEllipsis: false,
      duplicateSceneSuffix: 0,
    }),
    "scenes",
    null,
  );
  assert.equal(r.status, "ok");
  const b = r.files[0].basename;
  // maxSegmentLength still applies, because it is a stock setting and always
  // has. What must be gone is the whole-name byte guard, so the result is the
  // overlong name stock would have produced.
  assert.ok(
    utf8ByteLength(b) > 255,
    "without the byte guard the name stays overlong, got " +
      utf8ByteLength(b) +
      "B",
  );
  assert.ok(!b.includes("..."), "nothing marked, got " + b);
  assert.equal(r.files[0].duplicateSuffix || "", "");
});

test("resetFormatting restores all three switches", () => {
  const off = cfg({
    maxFilenameBytes: 0,
    filenameEllipsis: false,
    duplicateSceneSuffix: 0,
  });
  const back = resetFormatting(off);
  assert.equal(back.sanitize.maxFilenameBytes, 255);
  assert.equal(back.sanitize.filenameEllipsis, true);
  assert.equal(back.sanitize.duplicateSceneSuffix, 9);
});
