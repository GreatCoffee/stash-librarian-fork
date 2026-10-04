// Disambiguates a rendered filename that some OTHER scene already owns.
//
// Stash happily models one release with several files as several independent
// scenes that share a title. assignSuffixes only separates files inside a single
// entity, so every one of those scenes renders the same target name and the move
// is rejected with "already belongs to scene N". This module walks _1.._N until
// a suffix yields a path nobody else holds.
//
// The lookup is injected rather than imported: planEntity is a pure core function
// shared by the backend and the browser preview, and only the backend can reach
// Stash's GraphQL API. The preview passes a local registry built from the paths
// its own sample query already fetched.
//
// A lookup answer of null means "free"; anything truthy means "taken". The
// `unknown` shape is what a failed lookup returns, and is deliberately NOT
// treated as free: proving a path is free is what keeps a rename from clobbering
// someone else's file.

export function pathClaimedByOtherScene(lookup, selfId, path) {
  if (typeof lookup !== "function" || !path) {
    return null;
  }
  let answer;
  try {
    answer = lookup(path, selfId);
  } catch (e) {
    return { id: null, unknown: true };
  }
  if (!answer) {
    return null;
  }
  if (answer.id === undefined || answer.id === null) {
    // unknown:true is a failure to prove freedom, not proof of a collision
    return answer.unknown ? { id: null, unknown: true } : null;
  }
  return String(answer.id) === String(selfId) ? null : answer;
}

// Walk _1.._N until the path is free. The counter is one digit wide by design,
// so a library holding more copies than that keeps the old failure for the
// overflow instead of silently growing the suffix past a single digit.
export function disambiguateDuplicateScenes(options) {
  const {
    folder,
    basenameNoExt,
    extension,
    selfId,
    maxSuffix,
    joinPath,
    lookup,
  } = options;
  const limit = Number(maxSuffix) || 0;
  if (!(limit > 0) || typeof joinPath !== "function") {
    return { basenameNoExt, collided: false, suffix: "" };
  }
  let candidate = basenameNoExt;
  // `candidate` is the name being probed, and the suffix it carries is the one
  // from the previous iteration. Track it separately so the reported suffix
  // always describes the name actually returned, not the probe index.
  let candidateSuffix = "";
  for (let n = 1; n <= limit; n++) {
    const probe = joinPath(folder, candidate + extension);
    const owner = pathClaimedByOtherScene(lookup, selfId, probe);
    if (!owner) {
      return {
        basenameNoExt: candidate,
        collided: candidateSuffix !== "",
        suffix: candidateSuffix,
      };
    }
    if (owner.unknown) {
      // Could not prove the path is free, so stop adding suffixes and keep the
      // name the pattern produced. gqlMoveFile remains the final authority.
      return { basenameNoExt, collided: false, suffix: "", skipped: true };
    }
    candidate = basenameNoExt + "_" + n;
    candidateSuffix = "_" + n;
  }
  return {
    basenameNoExt: candidate,
    collided: true,
    suffix: "_" + limit,
    exhausted: true,
  };
}

// Builds a lookup backed by a plain path -> owner-id map, for callers that
// already hold every path in memory. The browser preview does: its sample query
// selects each entity's files with their paths, so the whole batch is in hand.
//
// A lookup is called as lookup(path, selfId) and answers with the id of whatever
// owns that path, or a falsy value when the path is free. Returning the caller's
// own id is how a scene recognises that the file it is about to rename is the one
// it already holds, which is not a collision.
export function createRegistryLookup(registry) {
  return function registryLookup(path) {
    if (!registry || typeof registry.get !== "function") {
      return null;
    }
    // Windows and SMB are case-insensitive, so the keys are compared folded.
    const key = String(path).toLowerCase();
    const ownerId = registry.has(key) ? registry.get(key) : registry.get(path);
    if (ownerId === undefined || ownerId === null) {
      return null;
    }
    return { id: ownerId };
  };
}
