import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../../src/core/config-schema.js";
import { planEntity } from "../../src/core/plan-scene.js";
import {
  resolveFilenameByteBudget,
  utf8ByteLength,
  joinPath,
} from "../../src/core/path-template.js";

const SEP = String.fromCharCode(92);
const BASE = "X:" + SEP + "AV";
const DEEP = BASE + SEP + "NJAV" + SEP + "Lilu's Handjobs";
const PATTERN = "[{code}][{performers}][{title}]";

// Long enough that the whole-path ceiling has to shorten it. 80 characters of
// CJK, so the byte budget bites well before any character count would.
const LONG =
  "クラスの女子が僕の秘蔵のオナホを見つけ、オナホ使うところ見せてよ！勃起しないと無理だよ！じゃ私の黒タイツパンツ見たら勃起する？2 と、まさかの神展開ゲットだぜ！";

function cfg(sanitize, libraryRoot) {
  return normalizeConfig({
    sanitize: sanitize,
    scenes: {
      defaultPattern: {
        filenamePattern: PATTERN,
        folderPattern: "{current}",
        libraryRoot: libraryRoot || BASE,
      },
    },
  });
}

function entity(id, code, title, performers, folder) {
  return {
    id: id,
    title: title,
    code: code,
    date: null,
    organized: true,
    rating100: null,
    studio: null,
    studio_id: null,
    performers: (performers || []).map((n, i) => {
      return {
        id: String(1000 + i),
        name: n,
        gender: null,
        favorite: false,
        image_path: null,
        details: null,
        aliases: null,
      };
    }),
    tags: [],
    stash_ids: [],
    files: [
      {
        id: 900000 + id,
        path: (folder || BASE) + SEP + "[" + code + "]orig.mp4",
        parent_folder: { id: 70 },
      },
    ],
  };
}

const baseSanitize = {
  maxFilenameBytes: 255,
  filenameEllipsis: true,
  maxFullPathBytes: 0,
};

function fullPathBytes(folder, basename) {
  return utf8ByteLength(folder + SEP + basename);
}

test("with the ceiling off, the folder is not measured at all", () => {
  const r = resolveFilenameByteBudget({
    folder: DEEP,
    maxFilenameBytes: 255,
    maxFullPathBytes: 0,
    joinPath: joinPath,
  });
  assert.equal(r.budget, 255);
  assert.equal(r.limitedBy, "component");
  assert.equal(r.folderBytes, 0);
});

test("the folder's own bytes come off the top of the ceiling", () => {
  const r = resolveFilenameByteBudget({
    folder: DEEP,
    maxFilenameBytes: 255,
    maxFullPathBytes: 300,
    joinPath: joinPath,
  });
  // The separator that will join folder to filename is counted too, otherwise
  // every path comes out exactly one byte short of the ceiling.
  assert.equal(
    r.folderBytes,
    utf8ByteLength(DEEP) + 1,
    "folder bytes must include the joining separator",
  );
  // At 300 this folder leaves 273 for the name, which is still more than the
  // per-component limit, so the component limit is the one that binds.
  assert.equal(r.limitedBy, "component");
  assert.equal(r.budget, 255);

  // Drop the ceiling until the folder actually starts eating into the name.
  const tight = resolveFilenameByteBudget({
    folder: DEEP,
    maxFilenameBytes: 255,
    maxFullPathBytes: 270,
    joinPath: joinPath,
  });
  assert.equal(tight.limitedBy, "wholePath");
  assert.equal(tight.budget, 270 - tight.folderBytes);
  assert.ok(tight.budget < 255, "the whole-path ceiling must actually bind");
});

test("the narrower of the two ceilings wins", () => {
  // A generous whole-path ceiling must not loosen the per-component limit.
  const loose = resolveFilenameByteBudget({
    folder: BASE + SEP + "JAV",
    maxFilenameBytes: 255,
    maxFullPathBytes: 4000,
    joinPath: joinPath,
  });
  assert.equal(loose.budget, 255, "the component limit still applies");
  assert.equal(loose.limitedBy, "component");

  // A tight whole-path ceiling must not be ignored just because the component
  // limit alone would have allowed the name.
  const tight = resolveFilenameByteBudget({
    folder: BASE + SEP + "JAV",
    maxFilenameBytes: 255,
    maxFullPathBytes: 100,
    joinPath: joinPath,
  });
  assert.equal(tight.limitedBy, "wholePath");
  assert.equal(tight.budget, 100 - tight.folderBytes);
});

test("a folder that busts the ceiling on its own reports rather than truncating", () => {
  // budget 0 means "there is no room for any filename". Returning a name that
  // fits nothing would produce a file with an empty basename.
  const r = resolveFilenameByteBudget({
    folder: BASE + SEP + "X".repeat(400),
    maxFilenameBytes: 255,
    maxFullPathBytes: 300,
    joinPath: joinPath,
  });
  assert.equal(r.limitedBy, "folder");
  assert.ok(r.budget <= 0, "no room can be offered");
});

test("the whole-path ceiling actually holds on a real plan", () => {
  [260, 280, 300].forEach((cap) => {
    const r = planEntity(
      entity(1, "SW-933", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"], DEEP),
      cfg({ ...baseSanitize, maxFullPathBytes: cap }),
      "scenes",
      null,
    );
    assert.equal(r.status, "ok");
    const f = r.files[0];
    const full = fullPathBytes(f.folder, f.basename);
    assert.ok(
      full <= cap,
      "cap " + cap + " breached: " + full + " bytes, " + f.basename,
    );
  });
});

test("a deeper folder yields a shorter name for the same ceiling", () => {
  // This is the whole point: the same scene under the same ceiling produces a
  // different name depending on how much directory sits above it.
  const shallow = planEntity(
    entity(
      2,
      "SW-933",
      LONG,
      ["服部飛鳥", "水谷梨明日", "白浜みなみ"],
      BASE + SEP + "JAV",
    ),
    cfg({ ...baseSanitize, maxFullPathBytes: 300 }),
    "scenes",
    null,
  );
  const deep = planEntity(
    entity(2, "SW-933", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"], DEEP),
    cfg({ ...baseSanitize, maxFullPathBytes: 300 }),
    "scenes",
    null,
  );
  assert.ok(
    utf8ByteLength(deep.files[0].basename) <=
      utf8ByteLength(shallow.files[0].basename),
    "the deeper folder must not produce a longer name",
  );
});

test("a folder over the ceiling is reported instead of silently failing", () => {
  const huge = BASE + SEP + "X".repeat(400);
  const r = planEntity(
    entity(3, "SW-933", LONG, ["服部飛鳥"], huge),
    cfg({ ...baseSanitize, maxFullPathBytes: 300 }),
    "scenes",
    null,
  );
  assert.equal(r.status, "ok", "the scene is still plannable");
  const warned = (r.warnings || []).filter((w) => /Folder path/.test(w));
  assert.equal(
    warned.length,
    1,
    "exactly one folder warning: " + JSON.stringify(r.warnings),
  );
  // The name must not have been emptied trying to fit.
  assert.ok(r.files[0].basename.length > 0, "no empty basename");
});

test("short names are untouched by the ceiling", () => {
  const off = planEntity(
    entity(4, "ABC-123", "短いタイトル", ["香月"]),
    cfg(baseSanitize),
    "scenes",
    null,
  );
  const on = planEntity(
    entity(4, "ABC-123", "短いタイトル", ["香月"]),
    cfg({ ...baseSanitize, maxFullPathBytes: 300 }),
    "scenes",
    null,
  );
  assert.equal(on.files[0].basename, off.files[0].basename);
  assert.ok(
    !on.files[0].basename.includes("..."),
    "no marker on an unclipped name",
  );
});

test("names settle: a second pass over the ceiling moves nothing", () => {
  // A ceiling that moves the name again on the next run would make the file
  // travel back and forth forever, which is worse than a failed rename.
  const deep = DEEP;
  let entities = [
    entity(1, "SW-930", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"], deep),
    entity(2, "SW-931", LONG, ["服部飛鳥", "水谷梨明日", "白浜みなみ"], deep),
  ];
  const config = cfg({ ...baseSanitize, maxFullPathBytes: 280 });
  const movesPerRound = [];
  for (let round = 0; round < 3; round++) {
    let moves = 0;
    const next = [];
    entities.forEach((e) => {
      const r = planEntity(e, config, "scenes", null);
      const f = r.files[0];
      if (!f.unchanged) {
        moves++;
      }
      next.push({
        ...e,
        files: [{ ...e.files[0], path: f.folder + SEP + f.basename }],
      });
    });
    entities = next;
    movesPerRound.push(moves);
  }
  assert.ok(movesPerRound[0] > 0, "the first pass has work to do");
  assert.equal(movesPerRound[1], 0, "second pass moved: " + movesPerRound[1]);
  assert.equal(movesPerRound[2], 0, "third pass moved: " + movesPerRound[2]);
});
