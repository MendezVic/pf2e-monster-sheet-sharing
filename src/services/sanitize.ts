import { MODULE_ID } from '@/constants';

export type InformationLevel = 'full' | 'public';
export type ActorSourceLike = Record<string, unknown>;
export type ActorFilter = (source: ActorSourceLike, context: SanitizerContext) => ActorSourceLike | void;

export interface SanitizerContext {
  actorId?: string;
  level: InformationLevel;
  requesterId?: string;
}

const HIDDEN_ITEM_VISIBILITIES = new Set(['gm', 'owner']);

export function sanitizeActorData(
  actorSource: ActorSourceLike,
  context: SanitizerContext,
  customFilter?: ActorFilter,
): ActorSourceLike {
  const source = foundry.utils.deepClone(actorSource) as ActorSourceLike;
  stripWorldIdentity(source);
  markTemporaryShare(source);

  if (context.level === 'public') sanitizePublicActor(source);

  const filtered = customFilter?.(source, context);
  return filtered ?? source;
}

function stripWorldIdentity(source: ActorSourceLike): void {
  delete source._id;
  delete source.ownership;
  delete source.folder;
  delete source.sort;

  const prototypeToken = source.prototypeToken as Record<string, unknown> | undefined;
  if (prototypeToken) {
    delete prototypeToken.actorId;
    delete prototypeToken.actorLink;
  }
}

function markTemporaryShare(source: ActorSourceLike): void {
  const flags = (source.flags ??= {}) as Record<string, unknown>;
  const moduleFlags = (flags[MODULE_ID] ??= {}) as Record<string, unknown>;
  moduleFlags.temporary = true;
}

function sanitizePublicActor(source: ActorSourceLike): void {
  const system = source.system as Record<string, unknown> | undefined;
  if (system) {
    removePath(system, ['attributes', 'hp']);
    removePath(system, ['attributes', 'ac']);
    removePath(system, ['attributes', 'hardness']);
    removePath(system, ['attributes', 'allSaves']);
    removePath(system, ['saves']);
    removePath(system, ['perception']);
    removePath(system, ['details', 'level', 'value']);
    removePath(system, ['details', 'languages']);
    removePath(system, ['resources']);
  }

  const items = source.items;
  if (Array.isArray(items)) {
    source.items = items.filter((item) => shouldKeepPublicItem(item as Record<string, unknown>));
  }
}

function shouldKeepPublicItem(item: Record<string, unknown>): boolean {
  const type = item.type;
  if (type === 'melee' || type === 'spellcastingEntry' || type === 'spell') return false;

  const system = item.system as Record<string, unknown> | undefined;
  const publication = system?.publication as Record<string, unknown> | undefined;
  const visibility = system?.visibility ?? publication?.visibility;
  if (typeof visibility === 'string' && HIDDEN_ITEM_VISIBILITIES.has(visibility)) return false;

  return true;
}

function removePath(source: Record<string, unknown>, path: string[]): void {
  const last = path.at(-1);
  if (!last) return;

  let current: Record<string, unknown> | undefined = source;
  for (const segment of path.slice(0, -1)) {
    const next = current?.[segment];
    if (!isRecord(next)) return;
    current = next;
  }

  delete current?.[last];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
