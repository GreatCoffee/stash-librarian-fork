import test from "node:test";
import assert from "node:assert/strict";
import {
  utf8ByteLength,
  truncateBasenameForExtension,
} from "../../src/core/path-template.js";
import { normalizeConfig } from "../../src/core/config-schema.js";

// Measured against an SMB mount, not quoted from a spec: 254 bytes was accepted
// and 256 was refused with EINVAL. That is the limit these tests protect.
const SMB_LIMIT = 255;

// A real name from the library that failed to rename before this function
// existed: 114 characters but 298 UTF-8 bytes, because CJK costs 3 bytes each.
// The title is the untruncated one, so this exercises the byte guard on its own.
const SW933 =
  "[SW-933][水谷梨明日, 白浜みなみ, 服部飛鳥]" +
  "[クラスの女子が僕の秘蔵のオナホを見つけ、オナホ使うところ見せてよ！勃起しないと無理だよ！" +
  "じゃ私の黒タイツパンツ見たら勃起する？2 と、まさかの神展開ゲットだぜ！]";

test("the name that motivated this fits after trimming", () => {
  assert.equal(utf8ByteLength(SW933 + ".mp4"), 298);
  const out = truncateBasenameForExtension(SW933, ".mp4", SMB_LIMIT) + ".mp4";
  assert.ok(
    utf8ByteLength(out) <= SMB_LIMIT,
    "expected <= 255 bytes, got " + utf8ByteLength(out),
  );
});

test("a name that already fits is returned byte-for-byte", () => {
  const short = "[SW-933][水谷梨明日][短いタイトル]";
  assert.equal(
    truncateBasenameForExtension(short, ".mp4", SMB_LIMIT),
    short,
    "no ellipsis may be added to a name that was not shortened",
  );
});

test("a shortened name is marked with an ellipsis inside the final bracket", () => {
  const out = truncateBasenameForExtension(SW933, ".mp4", SMB_LIMIT);
  assert.ok(
    out.endsWith("...]"),
    "ellipsis belongs before the closing bracket",
  );
  assert.ok(out.includes("..."), "expected an ellipsis, got: " + out);
});

test("the ellipsis survives the trailing-punctuation trim", () => {
  // tidy() strips trailing dots, so it has to run before the ellipsis is added.
  // Getting this order wrong silently drops the marker.
  const out = truncateBasenameForExtension(SW933, ".mp4", SMB_LIMIT);
  assert.ok(
    !/\.\.\.$/.test(out),
    "ellipsis must not end up outside the bracket",
  );
  assert.ok(out.includes("..."));
});

test("room is reserved for the multi-file suffix assignSuffixes adds later", () => {
  // "(2)" is appended AFTER this function returns, so trimming to exactly the
  // limit here would overflow once the real name is assembled.
  const trimmed = truncateBasenameForExtension(SW933, ".mp4", SMB_LIMIT);
  const withSuffix = trimmed + " (2)" + ".mp4";
  assert.ok(
    utf8ByteLength(withSuffix) <= SMB_LIMIT,
    "expected <= 255 bytes once ' (2)' is added, got " +
      utf8ByteLength(withSuffix),
  );
});

test("an existing numeric suffix is dropped rather than counted twice", () => {
  const already = SW933 + " (2)";
  const out = truncateBasenameForExtension(already, ".mp4", SMB_LIMIT);
  assert.ok(!/\s\(\d+\)$/.test(out), "the stripped suffix must not reappear");
});

test("a partial title is preferred over dropping the whole title group", () => {
  // Trimming inside "[title]" keeps a recognisable name; peeling the group
  // entirely leaves only "[code][performers]", which identifies nothing.
  const out = truncateBasenameForExtension(SW933, ".mp4", SMB_LIMIT);
  assert.ok(
    out.startsWith("[SW-933][水谷梨明日, 白浜みなみ, 服部飛鳥]["),
    "the code and performer groups must survive: " + out,
  );
  assert.ok(out.length > 60, "the title group must keep real content");
});

test("a zero or negative budget disables trimming", () => {
  assert.equal(truncateBasenameForExtension(SW933, ".mp4", 0), SW933);
  assert.equal(truncateBasenameForExtension(SW933, ".mp4", -1), SW933);
});

test("a budget smaller than the extension cannot be met and returns the input", () => {
  // Nothing sensible can be produced; the caller keeps the pattern's own name.
  assert.equal(truncateBasenameForExtension("abc", ".mp4", 3), "abc");
});

test("the default config enables both new caps", () => {
  const config = normalizeConfig({});
  assert.equal(config.sanitize.maxFilenameBytes, 255);
  assert.equal(config.sanitize.duplicateSceneSuffix, 9);
});

test("stored values override the defaults", () => {
  const config = normalizeConfig({
    sanitize: { maxFilenameBytes: 200, duplicateSceneSuffix: 0 },
  });
  assert.equal(config.sanitize.maxFilenameBytes, 200);
  assert.equal(config.sanitize.duplicateSceneSuffix, 0);
});
