import { DEFAULT_SORT_CRITERIA } from "./entity-sort.js";

export const PLUGIN_ID = "librarian";

// Settings that are not owned by any one entity type. The planner layers only
// these over a section, and the Formatting reset restores exactly these.
export const GLOBAL_SETTING_KEYS = ["delimiters", "sanitize"];

export const ENTITY_TYPES = ["scenes", "galleries", "images"];

const DEFAULT_SCENES = {
  autoRename: false,
  onlyOrganized: true,
  onlyWithStashId: false,
  // which stash-box endpoints satisfy onlyWithStashId; empty means any of them
  stashIdEndpoints: [],
  rules: [],
  excludeConditions: { conditionLogic: "OR", conditions: [] },
  tagBlacklist: [],
  defaultPattern: {
    folderPattern: "{studio_hierarchy}",
    filenamePattern: "{studio} - {date} - {title}",
    sortBy: DEFAULT_SORT_CRITERIA,
    libraryRoot: "",
    stashBoxEndpoint: "",
  },
};

const DEFAULT_GALLERIES = {
  autoRename: false,
  onlyOrganized: true,
  rules: [],
  excludeConditions: { conditionLogic: "OR", conditions: [] },
  tagBlacklist: [],
  defaultPattern: {
    folderPattern: "{current}",
    filenamePattern: "{title}",
    sortBy: DEFAULT_SORT_CRITERIA,
    libraryRoot: "",
  },
};

const DEFAULT_IMAGES = {
  autoRename: false,
  onlyOrganized: true,
  rules: [],
  excludeConditions: { conditionLogic: "OR", conditions: [] },
  tagBlacklist: [],
  defaultPattern: {
    folderPattern: "{current}",
    filenamePattern: "{title}",
    sortBy: DEFAULT_SORT_CRITERIA,
    libraryRoot: "",
  },
};

export const DEFAULT_CONFIG = {
  scenes: DEFAULT_SCENES,
  galleries: DEFAULT_GALLERIES,
  images: DEFAULT_IMAGES,
  delimiters: { performers: ", ", tags: ", " },
  sanitize: {
    // Per-segment cap, applied to a rendered segment before the name is
    // assembled. Cannot enforce the filesystem limit on its own: it never sees
    // the extension, so a 254-byte segment plus ".mp4" still overflows.
    maxSegmentLength: 255,
    // Hard cap on the finished filename, extension included, in UTF-8 bytes.
    // SMB/network filesystems reject a path component at 256 bytes (measured
    // 254 passes, 256 fails), so this is what actually keeps a rename legal.
    // 0 disables the cap.
    maxFilenameBytes: 255,
    // How many "_1".."_9" suffixes to try when a rendered name is already
    // claimed by a different scene. 0 disables disambiguation and restores the
    // old "already belongs to scene N" failure.
    duplicateSceneSuffix: 9,
    // Whether a shortened name is marked with "..." just inside the final "]",
    // so a clipped title is not mistaken for the complete one. The three bytes
    // are reserved inside maxFilenameBytes rather than added afterwards, which
    // is what stops the name from overshooting the moment the marker lands.
    // Only meaningful while maxFilenameBytes is non-zero.
    filenameEllipsis: true,
    // Hard cap on the whole path from the drive root, in UTF-8 bytes, with the
    // extension included. 0 disables the cap.
    //
    // maxFilenameBytes only sees the last path component, so it cannot know
    // how much room the directories above it already used. That matters as soon
    // as folderPattern nests scenes: a folderPattern of "{studio}" adds the
    // studio name to every path, and names that fit under one layout stop
    // fitting under another. Subtracting the rendered folder from the total
    // makes the filename yield exactly the space the folders took.
    //
    // The default is 0, not a number. The per-component ceiling is a documented
    // filesystem limit, but the ceiling for a total path is set by whatever
    // answers the share, and it has not been measured here. Guessing low would
    // clip titles that are in fact fine; guessing high would leave the setting
    // looking configured while doing nothing, since a large total minus a folder
    // still lands above the per-component limit and the check never engages.
    //
    // The toggle writes 255, the same value the per-name limit uses. Matching
    // them is what makes the two limits comparable at all: the check only does
    // work when the folder is long enough for the remainder to fall below the
    // per-name ceiling.
    //
    // Turning this on has a visible cost even before anything moves. It is a
    // guard for a future layout change, not something to leave enabled: with it
    // on, every folder byte is subtracted from the title, so a deep folder can
    // cut a title down to a handful of characters.
    maxFullPathBytes: 0,
    spaceReplacement: "",
  },
};

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A blank pattern means nothing by itself. "Keep what this file already has" is
// spelled {current}, and the planner refuses a bare blank with an error that
// names the token to write, so nothing else needs the old meaning: the pattern
// editor substitutes {current} the moment a field is cleared, and mergeDefaults
// gives a section that never named a pattern its own default. "/" survives:
// it is the library root, not a blank.
export const KEEP_CURRENT = "{current}";

// Exported because the pattern editor applies the same rule the moment a field
// is cleared, rather than leaving a blank in the page state for the preview to
// report on and the next save to rewrite anyway
export function blankPatternToCurrent(value) {
  const raw = value == null ? "" : String(value);
  return raw.trim() === "" ? KEEP_CURRENT : value;
}

// Only Scene has the groups field
const SCENE_ONLY_CONDITION_FIELDS = ["group"];

function keepableConditions(conditions) {
  if (!Array.isArray(conditions)) {
    return conditions;
  }
  return conditions.filter((c) => {
    return (
      !isPlainObject(c) || SCENE_ONLY_CONDITION_FIELDS.indexOf(c.field) === -1
    );
  });
}

function dropSceneOnlyConditions(config) {
  if (!isPlainObject(config)) {
    return config;
  }
  const result = Object.assign({}, config);
  ENTITY_TYPES.forEach((type) => {
    if (type === "scenes" || !isPlainObject(result[type])) {
      return;
    }
    const section = Object.assign({}, result[type]);
    if (Array.isArray(section.rules)) {
      section.rules = section.rules.map((rule) => {
        if (!isPlainObject(rule) || !Array.isArray(rule.conditions)) {
          return rule;
        }
        return Object.assign({}, rule, {
          conditions: keepableConditions(rule.conditions),
        });
      });
    }
    if (isPlainObject(section.excludeConditions)) {
      section.excludeConditions = Object.assign({}, section.excludeConditions, {
        conditions: keepableConditions(section.excludeConditions.conditions),
      });
    }
    result[type] = section;
  });
  return result;
}

export function normalizeConfig(raw) {
  return dropSceneOnlyConditions(
    mergeDefaults(DEFAULT_CONFIG, isPlainObject(raw) ? raw : {}),
  );
}

function mergeDefaults(defaults, raw) {
  if (Array.isArray(defaults)) {
    return Array.isArray(raw) ? raw : defaults.slice();
  }
  if (isPlainObject(defaults)) {
    const rawObj = isPlainObject(raw) ? raw : {};
    const result = {};
    const keys = new Set(Object.keys(defaults).concat(Object.keys(rawObj)));
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(defaults, key)) {
        result[key] = mergeDefaults(defaults[key], rawObj[key]);
      } else {
        result[key] = rawObj[key];
      }
    });
    return result;
  }
  return raw === undefined ? defaults : raw;
}

// Restores one entity type's settings to their defaults. Rules are the user's
// own work and can represent a lot of it, so a reset disables them rather than
// discarding them: turning one back on is easy, rewriting it is not.
export function resetSection(config, entityType) {
  const defaults = DEFAULT_CONFIG[entityType];
  if (!defaults) {
    return config;
  }
  // deep copy, or the reset section would share nested objects with the defaults
  const section = JSON.parse(JSON.stringify(defaults));
  const existing = ((config && config[entityType]) || {}).rules || [];
  section.rules = existing.map((rule) => {
    return Object.assign({}, rule, { enabled: false });
  });

  const next = Object.assign({}, config);
  next[entityType] = section;
  return next;
}

// Counterpart to resetSection: restores the shared formatting settings and
// leaves every entity type, and its rules, untouched.
export function resetFormatting(config) {
  const next = Object.assign({}, config);
  GLOBAL_SETTING_KEYS.forEach((key) => {
    next[key] = JSON.parse(JSON.stringify(DEFAULT_CONFIG[key]));
  });
  return next;
}

export function availableEntityTypes(counts) {
  if (!counts) {
    return ENTITY_TYPES.slice();
  }
  return ENTITY_TYPES.filter((type) => {
    return (counts[type] || 0) > 0;
  });
}

export function resolveActiveType(available, remembered) {
  const list = available || [];
  return list.indexOf(remembered) === -1 ? list[0] : remembered;
}
