import { normalizeScene } from "./normalize-scene.js";
import {
  matchRule,
  getMatchedEntityIds,
  matchingConditions,
  describeCondition,
} from "./rule-engine.js";
import {
  renderPath,
  joinPath,
  normalizePathForCompare,
  findMissingRequiredData,
  findPatternProblems,
  patternsNeedStashIdDefault,
  patternsUseStashIdSource,
  patternUsesAnyToken,
  findDisambiguationRisks,
  resolveSceneGroup,
  describePatternPair,
  folderPatternMode,
  filenamePatternMode,
  currentUsage,
  fitBasenameToBudget,
  resolveFilenameByteBudget,
  utf8ByteLength,
} from "./path-template.js";
import { disambiguateDuplicateScenes } from "./duplicate-scenes.js";
import { assignSuffixes } from "./file-ordering.js";
import { deriveFileTech } from "./file-tech.js";
import { adapterFor } from "./entity-adapter.js";
// Only these apply to every type; everything else belongs to a section. Sharing
// the list stops a stray top-level key, such as one left behind by an older
// config shape, leaking a scene-only gate into galleries or images.
import { GLOBAL_SETTING_KEYS } from "./config-schema.js";

function getExtension(basename) {
  const dotIndex = (basename || "").lastIndexOf(".");
  return dotIndex === -1 ? "" : basename.slice(dotIndex);
}

function stripExtension(basename) {
  const name = basename || "";
  return name.slice(0, name.length - getExtension(name).length);
}

function splitPath(path) {
  const p = path || "";
  // Stash reports native paths, so a Windows library yields backslashes only:
  // splitting on "/" alone left the whole path as the basename
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1
    ? { folder: "", basename: p }
    : { folder: p.slice(0, idx), basename: p.slice(idx + 1) };
}

// An empty endpoint list means any source will do
function hasRequiredStashId(sceneView, endpoints) {
  const wanted = endpoints || [];
  if (wanted.length === 0) {
    return sceneView.hasStashId;
  }
  return (sceneView.stashIds || []).some((s) => {
    return wanted.indexOf(s.endpoint) !== -1;
  });
}

function dataError(
  reason,
  sceneId,
  matchedRule,
  folderPattern,
  filenamePattern,
  missingData,
) {
  return {
    status: "error",
    reason: reason,
    sceneId: sceneId,
    matchedRule: matchedRule ? matchedRule.id || null : null,
    folderPattern: folderPattern,
    filenamePattern: filenamePattern,
    missingData: missingData,
    files: [],
  };
}

// Used in both the frontend and in the Goja backend so it needs to
// stay compatible with the limited JS environment the VM provides
export function planScene(rawScene, config, stashBoxes, options) {
  return planEntity(rawScene, config, "scenes", stashBoxes, options);
}

export function storedStashBoxEndpoint(settings, matchedRule) {
  return (
    (matchedRule && matchedRule.stashBoxEndpoint) ||
    (settings.defaultPattern && settings.defaultPattern.stashBoxEndpoint) ||
    ""
  );
}

export function entitySettings(config, entityType) {
  const cfg = config || {};
  const globals = {};
  GLOBAL_SETTING_KEYS.forEach((key) => {
    if (cfg[key] !== undefined) {
      globals[key] = cfg[key];
    }
  });
  return Object.assign(globals, cfg[entityType] || {});
}

export function configNeedsStashBoxes(config, entityType) {
  const adapter = adapterFor(entityType);
  if (adapter.tokens.indexOf("stash_id") === -1) {
    return false;
  }
  const settings = entitySettings(config, entityType);

  const candidates = [{ pattern: settings.defaultPattern, rule: null }];
  (settings.rules || []).forEach((rule) => {
    if (rule && rule.enabled !== false) {
      candidates.push({ pattern: rule, rule: rule });
    }
  });

  return candidates.some((candidate) => {
    if (!candidate.pattern) {
      return false;
    }
    const patterns = [
      candidate.pattern.folderPattern,
      candidate.pattern.filenamePattern,
    ];
    if (patternsUseStashIdSource(patterns)) {
      return true;
    }
    return (
      patternsNeedStashIdDefault(patterns) &&
      !storedStashBoxEndpoint(settings, candidate.rule)
    );
  });
}

// `options.pathOwnerLookup(path, selfId)` is how a caller answers "does some
// other scene already own this path?". It is injected because the backend can
// ask Stash and the browser preview cannot: the preview passes a registry built
// from the paths its own sample query already fetched. Omitting it disables
// cross-entity disambiguation, which is the correct default for callers that
// have no way to answer the question.
export function planEntity(rawScene, config, entityType, stashBoxes, options) {
  const injectedLookup = options && options.pathOwnerLookup;
  const settings = entitySettings(config, entityType);
  const adapter = adapterFor(entityType);
  const sceneView = normalizeScene(rawScene, entityType);

  if (settings.onlyOrganized && !sceneView.organized) {
    return {
      status: "skipped",
      reason: "not_organized",
      sceneId: sceneView.id,
      files: [],
    };
  }

  if (
    settings.onlyWithStashId &&
    !hasRequiredStashId(sceneView, settings.stashIdEndpoints)
  ) {
    return {
      status: "skipped",
      reason: "no_stash_id",
      sceneId: sceneView.id,
      files: [],
    };
  }

  const excludeConditions = settings.excludeConditions;
  if (excludeConditions) {
    const matched = matchingConditions(
      sceneView,
      excludeConditions.conditionLogic,
      excludeConditions.conditions,
    );
    if (matched.length > 0) {
      return {
        status: "skipped",
        reason: "excluded",
        sceneId: sceneView.id,
        excludedBy: matched.map((c) => {
          return describeCondition(sceneView, c);
        }),
        files: [],
      };
    }
  }

  // Structural limits (folder galleries, images inside a zip) are reported before
  // the generic no_files skip, which would otherwise hide the real reason
  const ineligible = adapter.ineligible(rawScene);
  if (ineligible) {
    return {
      status: "skipped",
      reason: ineligible.reason,
      message: ineligible.message,
      sceneId: sceneView.id,
      files: [],
    };
  }

  if (sceneView.files.length === 0) {
    return {
      status: "skipped",
      reason: "no_files",
      sceneId: sceneView.id,
      files: [],
    };
  }

  const matchedRule = matchRule(sceneView, settings.rules || []);
  const folderPattern = matchedRule
    ? matchedRule.folderPattern
    : (settings.defaultPattern && settings.defaultPattern.folderPattern) || "";
  const filenamePattern = matchedRule
    ? matchedRule.filenamePattern
    : (settings.defaultPattern && settings.defaultPattern.filenamePattern) ||
      "";
  const sortBy =
    (matchedRule && matchedRule.sortBy) ||
    (settings.defaultPattern && settings.defaultPattern.sortBy) ||
    "alphabetical";
  const renderConfig = Object.assign({}, settings, { sortBy: sortBy });

  const patternOptions = { stashBoxes: stashBoxes || null };
  const patternProblems = []
    .concat(findPatternProblems(folderPattern, adapter.tokens, patternOptions))
    .concat(
      findPatternProblems(filenamePattern, adapter.tokens, patternOptions),
    )
    .filter((problem) => {
      return problem.blocking;
    });
  if (patternProblems.length > 0) {
    return dataError(
      "invalid_pattern",
      sceneView.id,
      matchedRule,
      folderPattern,
      filenamePattern,
      patternProblems.map((problem) => {
        return { token: null, message: problem.raw + ": " + problem.message };
      }),
    );
  }

  const folderMode = folderPatternMode(folderPattern);
  const filenameMode = filenamePatternMode(filenamePattern);

  // A backstop rather than something a user is expected to see: the editor
  // substitutes {current} the moment a field is cleared, and normalizeConfig
  // rewrites any blank it is handed, on every path into the planner. This is
  // what keeps a blank from meaning something by accident if one ever gets past
  // both of those
  if (folderMode === "blank" || filenameMode === "blank") {
    return dataError(
      "blank_pattern",
      sceneView.id,
      matchedRule,
      folderPattern,
      filenamePattern,
      [
        {
          token: null,
          message:
            "a blank " +
            (folderMode === "blank" ? "folder" : "filename") +
            " pattern no longer means anything. Write {current} to keep the " +
            (folderMode === "blank"
              ? "folder this file is already in"
              : "name this file already has"),
        },
      ],
    );
  }

  // The one skip decided after rule matching, so it is the one that can say
  // which rule made it. Without that, a keep-everything rule looks like the
  // default pattern doing nothing
  if (folderMode === "keep" && filenameMode === "keep") {
    return {
      status: "skipped",
      reason: "nothing_to_change",
      message:
        "both the folder and filename patterns are {current}, so this " +
        adapter.noun +
        " keeps the path it already has",
      sceneId: sceneView.id,
      matchedRule: matchedRule ? matchedRule.id || null : null,
      files: [],
    };
  }

  const libraryRoot = matchedRule
    ? matchedRule.libraryRoot
    : settings.defaultPattern && settings.defaultPattern.libraryRoot;

  // keep-in-place never leaves the file's own folder, so it needs no root
  if (folderMode !== "keep" && !libraryRoot) {
    return dataError(
      "no_library_root",
      sceneView.id,
      matchedRule,
      folderPattern,
      filenamePattern,
      [
        {
          token: null,
          message: matchedRule
            ? "the matched rule has no library root configured"
            : "the default pattern has no library root configured",
        },
      ],
    );
  }

  const matchedIds = {
    performerIds: getMatchedEntityIds(sceneView, matchedRule, "performer"),
    tagIds: getMatchedEntityIds(sceneView, matchedRule, "tag"),
    stashBoxEndpoint: storedStashBoxEndpoint(settings, matchedRule),
    stashBoxes: stashBoxes || null,
  };

  const sanitizeOptions = (config && config.sanitize) || {};
  const maxFilenameBytes = Number(sanitizeOptions.maxFilenameBytes) || 0;
  const maxFullPathBytes = Number(sanitizeOptions.maxFullPathBytes) || 0;
  // A setting saved by an older build has no filenameEllipsis key at all, so
  // only an explicit false turns the marker off.
  const filenameEllipsis = sanitizeOptions.filenameEllipsis !== false;
  // Folders whose own path exceeds the whole-path ceiling. Collected rather than
  // warned about inline because one folder can hold many files, and the message
  // is about the folder, not each name inside it.
  const unfixableFolders = new Set();
  // Kept names ({current}) that sit over the byte budget. They are left byte
  // for byte — a kept name comes off the filesystem, not out of a rendered
  // token, so there is no {title} value to spend — and each one is reported
  // rather than left as a silent over-limit name.
  const keptNameNotices = [];

  // We trust Stash's ordering of files: primary file will be first
  const sortedFiles = sceneView.files;

  const perFile = [];
  for (let i = 0; i < sortedFiles.length; i++) {
    const file = sortedFiles[i];
    const fileView = Object.assign({}, sceneView, deriveFileTech(file));

    const missingData = findMissingRequiredData(
      [folderPattern, filenamePattern],
      fileView,
      matchedIds,
      adapter.noun,
    );
    if (missingData.length > 0) {
      return dataError(
        "missing_data",
        sceneView.id,
        matchedRule,
        folderPattern,
        filenamePattern,
        missingData,
      );
    }

    const current = splitPath(file.path);

    const rendered = renderPath(
      folderPattern,
      filenamePattern,
      fileView,
      renderConfig,
      matchedIds,
      { folder: current.folder, basename: stripExtension(current.basename) },
    );

    // Both guards ask whether the pattern produced a usable name. Neither means
    // anything when the file is keeping the name it already has
    if (filenameMode === "render" && !rendered.basenameHasContent) {
      return dataError(
        "empty_filename",
        sceneView.id,
        matchedRule,
        folderPattern,
        filenamePattern,
        [
          {
            token: null,
            message:
              "the pattern produced no real filename for this scene (every token is either optional or has no data). Refusing to rename to a generic placeholder, since other scenes/files could collide on the same name",
          },
        ],
      );
    }

    if (filenameMode === "render" && !rendered.basenameHasMetadataContent) {
      return dataError(
        "no_identifying_metadata",
        sceneView.id,
        matchedRule,
        folderPattern,
        filenamePattern,
        [
          {
            token: null,
            message:
              "the filename would be based entirely on file properties (resolution/codec/bitrate/fps) with no actual Stash metadata (title, studio, performers, tags, date, or rating). Refusing to rename to a name that can't be told apart from other uncatalogued files with the same technical specs; add metadata to this scene, or use a pattern whose filename includes at least one metadata field",
          },
        ],
      );
    }

    // Deliberately not run through sanitizeSegment: the name is already on disk,
    // so it is legal there, and sanitizing would rename the very file the blank
    // pattern promised to leave alone (spaceReplacement being the obvious way)
    const basenameNoExt =
      filenameMode === "keep"
        ? stripExtension(current.basename)
        : rendered.basenameNoExt;

    // {current} is the one token that reads what the pattern writes, so a
    // pattern using it can fail to settle: {current|regex=/a/aa/} grows every
    // run, {current|titlecase|compact} costs one extra rename before it stops.
    // Rendering once more from the name we just produced is a total check, and
    // needs no claim about whether the modifiers are idempotent
    if (currentUsage(filenamePattern).modified) {
      const again = renderPath(
        folderPattern,
        filenamePattern,
        fileView,
        renderConfig,
        matchedIds,
        { folder: current.folder, basename: basenameNoExt },
      );
      if (again.basenameNoExt !== basenameNoExt) {
        return dataError(
          "unstable_pattern",
          sceneView.id,
          matchedRule,
          folderPattern,
          filenamePattern,
          [
            {
              token: null,
              message:
                "this pattern does not settle: renaming to " +
                basenameNoExt +
                " would rename again to " +
                again.basenameNoExt +
                " on the next run, and so on. {current} reads the name the" +
                " pattern writes, so its modifiers have to leave an already" +
                " renamed file alone",
            },
          ],
        );
      }
    }

    if (folderMode === "render" && !rendered.folder) {
      return dataError(
        "empty_folder",
        sceneView.id,
        matchedRule,
        folderPattern,
        filenamePattern,
        [
          {
            token: null,
            message:
              "the folder pattern produced no folder for this scene (every token is either optional or has no data). Refusing to guess: leave the folder pattern blank to keep files in their current folder, or set it to / to move them to the library root",
          },
        ],
      );
    }

    const targetFolder =
      folderMode === "keep"
        ? current.folder
        : joinPath(libraryRoot, rendered.folder);

    // Some entities may be renamed but not relocated. Only worth checking once
    // the target is known, since staying put is always allowed.
    if (
      adapter.relocationBlocked &&
      normalizePathForCompare(targetFolder) !==
        normalizePathForCompare(current.folder)
    ) {
      const blocked = adapter.relocationBlocked(rawScene);
      if (blocked) {
        return {
          status: "skipped",
          reason: blocked.reason,
          message: blocked.message,
          sceneId: sceneView.id,
          files: [],
        };
      }
    }

    // Two ceilings can apply, and the narrower one wins: the per-component
    // limit the filesystem enforces on any single name, and the whole-path
    // limit that also has to cover every directory above the file.
    const byteBudget = resolveFilenameByteBudget({
      folder: targetFolder,
      maxFilenameBytes: maxFilenameBytes,
      maxFullPathBytes: maxFullPathBytes,
      joinPath: joinPath,
    });
    if (byteBudget.limitedBy === "folder") {
      // The directories alone already exceed the ceiling. No filename can
      // bring this under, and trimming toward it would only produce an empty
      // name, so the name is left intact and the caller surfaces a warning.
      unfixableFolders.add(normalizePathForCompare(targetFolder));
    }
    // Fitting runs per FILE, before grouping: every suffix is appended to an
    // already fitted name. assignSuffixes (" (2)" for the second copy) and the
    // cross-scene "_1" both work from the 12-byte headroom the fit leaves, so
    // "suffix wins over clip" holds by construction and the name that the
    // disambiguation probes is the name that will actually be written.
    let fittedBasename = basenameNoExt;
    if (
      filenameMode === "render" &&
      byteBudget.limitedBy !== "folder" &&
      byteBudget.budget > 0
    ) {
      const fit = fitBasenameToBudget({
        folderPattern: folderPattern,
        filenamePattern: filenamePattern,
        sceneView: fileView,
        config: renderConfig,
        matchedIds: matchedIds,
        currentPath: {
          folder: current.folder,
          basename: stripExtension(current.basename),
        },
        rendered: rendered,
        extension: getExtension(current.basename),
        budget: byteBudget.budget,
        ellipsis: filenameEllipsis,
      });
      if (fit.infeasible) {
        return dataError(
          "name_budget_infeasible",
          sceneView.id,
          matchedRule,
          folderPattern,
          filenamePattern,
          [
            {
              token: "title",
              message: fit.message,
            },
          ],
        );
      }
      fittedBasename = fit.basenameNoExt;
    }
    if (
      filenameMode === "keep" &&
      byteBudget.limitedBy !== "folder" &&
      byteBudget.budget > 0 &&
      utf8ByteLength(current.basename) > byteBudget.budget
    ) {
      keptNameNotices.push(
        "kept name exceeds the filename byte budget (" +
          byteBudget.budget +
          " bytes) and was left untouched: " +
          current.basename,
      );
    }

    perFile.push({
      file: file,
      current: current,
      // Move by folder id when keeping files put: it is authoritative, cannot
      // create a folder hierarchy, and avoids re-parsing the path
      folderId:
        folderMode === "keep" && file.parent_folder
          ? file.parent_folder.id
          : null,
      folder: targetFolder,
      basenameNoExt: fittedBasename,
      // Kept names only really collide when the whole name matches, extension
      // included, and suffixing one that does not would be the rename a blank
      // pattern promises never to make. A rendered name is shared by every file
      // of the entity, so there the extension must stay out of the key
      groupExtension:
        filenameMode === "keep" ? getExtension(current.basename) : "",
    });
  }

  const groups = {};
  const groupKeys = [];
  perFile.forEach((entry) => {
    // NUL byte will never appear in filenames and is a safe joiner here
    const key =
      entry.folder + "\0" + entry.basenameNoExt + "\0" + entry.groupExtension;
    if (!groups[key]) {
      groups[key] = [];
      groupKeys.push(key);
    }
    groups[key].push(entry);
  });

  const resultByFileId = {};
  const duplicateSceneSuffix = Number(sanitizeOptions.duplicateSceneSuffix) || 0;
  // The fitted name is unique among the files of this entity. What it cannot
  // see is every OTHER entity plans the same pattern in the same folder, so a
  // lookup answers "does some other scene already hold this path?" and the
  // suffix walks _1.._N until it has a path of its own. The lookup is the same
  // injected one the render stage cannot call; running it against the Fitted
  // name is what keeps "clipped but unique" true without a second pass.
  const resolveUniqueBasename = (folder, base, extension, selfId) => {
    if (duplicateSceneSuffix > 0 && typeof injectedLookup === "function") {
      return disambiguateDuplicateScenes({
        folder: folder,
        basenameNoExt: base,
        extension: extension,
        selfId: selfId,
        maxSuffix: duplicateSceneSuffix,
        joinPath: joinPath,
        lookup: injectedLookup,
      });
    }
    return { basenameNoExt: base, collided: false, suffix: "" };
  };
  const suffixNotices = [];
  groupKeys.forEach((key) => {
    const group = groups[key];
    const suffixed = assignSuffixes(
      group.map((entry) => {
        return entry.file;
      }),
      group[0].basenameNoExt,
    );
    suffixed.forEach((s, i) => {
      const entry = group[i];
      const file = entry.file;
      const current = entry.current;
      const extension = getExtension(current.basename);
      const disambiguated = resolveUniqueBasename(
        entry.folder,
        s.basenameNoExt,
        extension,
        sceneView.id,
      );
      if (disambiguated.collided) {
        suffixNotices.push(
          disambiguated.exhausted
            ? "no free _1.._" +
                duplicateSceneSuffix +
                " suffix was available for " +
                disambiguated.basenameNoExt +
                extension
            : "renamed with a " +
                disambiguated.suffix +
                " suffix because another scene already uses that name",
        );
      }
      const basename = disambiguated.basenameNoExt + extension;
      const currentFolder = normalizePathForCompare(current.folder);
      const unchanged =
        currentFolder === normalizePathForCompare(entry.folder) &&
        current.basename === basename;
      resultByFileId[file.id] = {
        fileId: file.id,
        folder: entry.folder,
        folderId: entry.folderId,
        basename: basename,
        currentBasename: current.basename,
        currentPath: file.path,
        unchanged: unchanged,
        duplicateSuffix: disambiguated.suffix,
      };
    });
  });

  const files = sortedFiles.map((file) => {
    return resultByFileId[file.id];
  });

  // Which group {group} spoke for is a choice the user did not make, so a
  // scene in several says so on its own row rather than only in the docs. Not
  // an error: the pick is deterministic, it just might not be the one wanted
  const groupChoice = resolveSceneGroup(sceneView);
  const warnings = [];
  if (
    groupChoice.ambiguous &&
    patternUsesAnyToken(folderPattern + " " + filenamePattern, [
      "group",
      "group_idx",
    ])
  ) {
    warnings.push(
      "in " +
        groupChoice.all.length +
        ' groups; {group} used "' +
        groupChoice.group.name +
        '" (earliest created). Others: ' +
        groupChoice.all
          .slice(1)
          .map((g) => g.name)
          .join(", "),
    );
  }

  const disambiguationRisks = findDisambiguationRisks(
    [folderPattern, filenamePattern],
    sceneView,
    renderConfig,
    matchedIds,
  );
  if (disambiguationRisks.length > 0) {
    warnings.push(
      disambiguationRisks
        .map((risk) => {
          return risk.name + " (" + risk.disambiguation + ")";
        })
        .join(", ") +
        " may need |disambiguate: this pattern renders the " +
        (disambiguationRisks.length === 1 ? "name" : "names") +
        " alone",
    );
  }
  // De-duplicate: a scene with several copies of one release would otherwise
  // repeat the same sentence once per file.
  suffixNotices.forEach((notice) => {
    if (warnings.indexOf(notice) === -1) {
      warnings.push(notice);
    }
  });
  keptNameNotices.forEach((notice) => {
    if (warnings.indexOf(notice) === -1) {
      warnings.push(notice);
    }
  });
  // A folder that busts the whole-path ceiling on its own cannot be fixed by
  // shortening anything below it, so it is reported per folder rather than per
  // file. Silently leaving these names long would look like a successful plan
  // and fail at the filesystem instead.
  unfixableFolders.forEach((folder) => {
    warnings.push(
      "Folder path already exceeds the configured max full path length (" +
        maxFullPathBytes +
        " bytes): " +
        folder,
    );
  });

  return {
    status: "ok",
    warnings: warnings,
    reason: matchedRule
      ? "rule:" +
        (matchedRule.id ||
          describePatternPair(
            matchedRule.folderPattern,
            matchedRule.filenamePattern,
          ))
      : "default",
    sceneId: sceneView.id,
    files: files,
  };
}
