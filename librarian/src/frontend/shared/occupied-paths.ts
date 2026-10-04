import { createRegistryLookup } from "../../core/duplicate-scenes.js";
import { joinBasename } from "../../core/path-template.js";

// A path -> owning-entity-id map covering every entity in the current preview
// batch, used to answer planEntity's "does another scene own this path?"
// without a round trip to Stash.
//
// The preview can do this because its sample query already selects each entity's
// files together with their paths, so the whole batch is in memory. The backend
// cannot use this: it only ever holds one entity at a time, so it asks Stash
// instead. Both paths must agree, or the preview shows names the move will not
// produce.
//
// Case handling: Windows and SMB are case-insensitive, so keys are lowercased.
// A path held by the entity being planned is not a collision, and the lookup
// returns selfId so the core can recognise and skip it.
export function buildOccupiedPaths(entities: any[]): Map<string, any> {
  const registry = new Map<string, any>();
  (entities || []).forEach((entity: any) => {
    const files = (entity && entity.files) || [];
    files.forEach((file: any) => {
      if (!file || !file.path) {
        return;
      }
      const key = String(file.path).toLowerCase();
      // First writer wins. Two entities listing the same path is already a
      // broken library, and the earlier one is as good an owner as any.
      if (!registry.has(key)) {
        registry.set(key, entity.id);
      }
    });
  });
  return registry;
}

export function previewPathOwnerLookup(registry: Map<string, any>) {
  return createRegistryLookup(registry);
}

// Plans a whole batch in order, letting each entity see the names the ones
// before it just claimed.
//
// Seeding alone is not enough. The sample query reports where files are NOW, but
// a scene that renders the same name as an earlier scene in this same batch is
// going to move there too, and neither of them is in the seed for the other yet.
// The backend gets this ordering for free because processScene commits one scene
// before planning the next, so its database query sees the finished move. The
// preview has to record each planned target itself.
export function planBatchInto(
  entities: any[],
  config: any,
  entityType: string,
  stashBoxes: any[] | null | undefined,
  planEntity: (
    entity: any,
    config: any,
    type: string,
    boxes: any,
    options: any,
  ) => any,
  registry?: Map<string, any>,
) {
  // Reuse the caller's registry when given one, so a paged preview keeps a
  // single view of claimed paths across page boundaries.
  const claimed = registry || buildOccupiedPaths(entities);
  (entities || []).forEach((entity: any) => {
    const files = (entity && entity.files) || [];
    files.forEach((file: any) => {
      if (!file || !file.path) {
        return;
      }
      const key = String(file.path).toLowerCase();
      if (!claimed.has(key)) {
        claimed.set(key, entity.id);
      }
    });
  });
  return (entities || []).map((entity: any) => {
    const plan = planEntity(entity, config, entityType, stashBoxes, {
      pathOwnerLookup: previewPathOwnerLookup(claimed),
    });
    const files = (plan && plan.files) || [];
    files.forEach((file: any) => {
      if (!file || !file.basename || !file.folder) {
        return;
      }
      const key = String(
        joinBasename(file.folder, file.basename),
      ).toLowerCase();
      if (!claimed.has(key)) {
        claimed.set(key, entity.id);
      }
    });
    return { scene: entity, plan: plan };
  });
}

export function planBatch(
  entities: any[],
  config: any,
  entityType: string,
  stashBoxes: any[] | null | undefined,
  planEntity: (
    entity: any,
    config: any,
    type: string,
    boxes: any,
    options: any,
  ) => any,
) {
  return planBatchInto(
    entities,
    config,
    entityType,
    stashBoxes,
    planEntity,
    undefined,
  );
}
