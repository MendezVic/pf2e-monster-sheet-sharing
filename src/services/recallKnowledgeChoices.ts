import { MODULE_ID } from '@/constants';
import { ActorFilter } from '@/services/sanitize';

export type RecallKnowledgeChoiceId = 'identity' | 'perception' | 'ac' | 'hp' | 'fortitude' | 'reflex' | 'will' | 'immunity' | 'resistance' | 'weakness' | 'speed' | 'attack' | 'action' | 'passive';

interface RecallKnowledgeChoice {
  id: RecallKnowledgeChoiceId;
  labelKey: string;
  fallbackLabel: string;
  maxDiscoveries?: number;
  paths?: string[][];
  listPaths?: string[][];
  itemTypes?: string[];
  itemFilter?: (item: Record<string, unknown>) => boolean;
  itemLimit?: number;
}

export interface RecallKnowledgeChoiceView {
  id: RecallKnowledgeChoiceId;
  label: string;
  disabled: boolean;
  remaining: number;
}

const HIDDEN_ITEM_VISIBILITIES = new Set(['gm', 'owner']);

export interface RecallKnowledgeDiscoveryContext {
  isLoreSkill?: boolean;
  loreRank?: number;
  useReasonRapidly?: boolean;
}

export function getRecallKnowledgeDiscoveryChoiceCount(actor: Actor | null | undefined, degreeOfSuccess: number | null | undefined, context: RecallKnowledgeDiscoveryContext = {}): number {
  if (degreeOfSuccess === 3 || degreeOfSuccess === 2) {
    if (context.useReasonRapidly && hasFeat(actor, 'reason-rapidly')) return 1;

    const baseCount = degreeOfSuccess === 3 ? 2 : 1;
    let bonusCount = 0;

    if (hasFeat(actor, 'thorough-research')) bonusCount += degreeOfSuccess === 3 ? 2 : 1;
    if (context.isLoreSkill && context.loreRank !== undefined ? context.loreRank >= 3 : false) {
      if (hasFeat(actor, 'unmistakable-lore')) bonusCount += 1;
    }

    return baseCount + bonusCount;
  }

  return 0;
}

export const RECALL_KNOWLEDGE_CHOICES: RecallKnowledgeChoice[] = [
  {
    id: 'identity',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.identity`,
    fallbackLabel: 'Identity',
    maxDiscoveries: 1,
    paths: [
      ['system', 'details', 'level', 'value'],
      ['system', 'details', 'languages'],
      ['system', 'traits'],
    ],
  },
  {
    id: 'perception',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.perception`,
    fallbackLabel: 'Perception',
    maxDiscoveries: 1,
    paths: [
      ['system', 'perception'],
      ['system', 'attributes', 'senses'],
    ],
  },
  {
    id: 'speed',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.speed`,
    fallbackLabel: 'Speed',
    maxDiscoveries: 1,
    paths: [['system', 'attributes', 'speed']],
  },
  {
    id: 'ac',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.ac`,
    fallbackLabel: 'AC',
    maxDiscoveries: 1,
    paths: [['system', 'attributes', 'ac']],
  },
  {
    id: 'hp',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.hp`,
    fallbackLabel: 'HP',
    maxDiscoveries: 1,
    paths: [['system', 'attributes', 'hp']],
  },
  {
    id: 'fortitude',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.fortitude`,
    fallbackLabel: 'Fortitude',
    maxDiscoveries: 1,
    paths: [['system', 'saves', 'fortitude']],
  },
  {
    id: 'reflex',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.reflex`,
    fallbackLabel: 'Reflex',
    maxDiscoveries: 1,
    paths: [['system', 'saves', 'reflex']],
  },
  {
    id: 'will',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.will`,
    fallbackLabel: 'Will',
    maxDiscoveries: 1,
    paths: [['system', 'saves', 'will']],
  },
  {
    id: 'immunity',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.immunity`,
    fallbackLabel: 'Immunity',
    listPaths: [['system', 'attributes', 'immunities']],
  },
  {
    id: 'resistance',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.resistance`,
    fallbackLabel: 'Resistance',
    listPaths: [['system', 'attributes', 'resistances']],
  },
  {
    id: 'weakness',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.weakness`,
    fallbackLabel: 'Weakness',
    listPaths: [['system', 'attributes', 'weaknesses']],
  },
  {
    id: 'attack',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.attack`,
    fallbackLabel: 'Attack',
    itemTypes: ['melee', 'spellcastingEntry', 'spell'],
    itemLimit: 1,
  },
  {
    id: 'action',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.action`,
    fallbackLabel: 'Action',
    itemFilter: isRecallKnowledgeActionItem,
    itemLimit: 1,
  },
  {
    id: 'passive',
    labelKey: `${MODULE_ID}.recallKnowledge.choices.passive`,
    fallbackLabel: 'Passive',
    itemFilter: isRecallKnowledgePassiveItem,
    itemLimit: 1,
  },
];

export function getRecallKnowledgeChoiceViews(actor?: Actor, discoveredChoiceIds: RecallKnowledgeChoiceId[] = []): RecallKnowledgeChoiceView[] {
  const discoveredCounts = countChoices(discoveredChoiceIds);
  const discoverableCounts = actor ? getDiscoverableChoiceCounts(actor) : new Map<RecallKnowledgeChoiceId, number>();

  return RECALL_KNOWLEDGE_CHOICES.map(choice => {
    const discoverableCount = actor ? (discoverableCounts.get(choice.id) ?? 0) : 1;
    const discoveredCount = discoveredCounts.get(choice.id) ?? 0;
    const remaining = Math.max(discoverableCount - discoveredCount, 0);

    return {
      id: choice.id,
      label: localizeWithFallback(choice.labelKey, choice.fallbackLabel),
      disabled: actor ? remaining <= 0 : false,
      remaining,
    };
  }).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}

export function isRecallKnowledgeChoiceId(value: string): value is RecallKnowledgeChoiceId {
  return RECALL_KNOWLEDGE_CHOICES.some(choice => choice.id === value);
}

export function createRecallKnowledgeFilter(choiceIds: RecallKnowledgeChoiceId[]): ActorFilter {
  const choiceCounts = countChoices(choiceIds);
  const selectedChoices = RECALL_KNOWLEDGE_CHOICES.filter(choice => (choiceCounts.get(choice.id) ?? 0) > 0);
  return source => {
    const system = source.system;
    const revealedSystem: Record<string, unknown> = {};
    if (isRecord(system)) {
      for (const path of selectedChoices.flatMap(choice => choice.paths ?? [])) {
        copyPath(system, revealedSystem, path.slice(1));
      }
      for (const choice of selectedChoices) {
        for (const path of choice.listPaths ?? []) {
          copyListEntries(system, revealedSystem, path.slice(1), choiceCounts.get(choice.id) ?? 1);
        }
      }
    }
    source.system = revealedSystem;

    const items = source.items;
    if (Array.isArray(items)) {
      source.items = selectedChoices.flatMap(choice => {
        if (!hasItemFilter(choice)) return [];

        const itemLimit = (choice.itemLimit ?? Number.POSITIVE_INFINITY) * (choiceCounts.get(choice.id) ?? 1);
        return items.filter(item => shouldKeepItemForChoice(item as Record<string, unknown>, choice)).slice(0, itemLimit);
      });
    }
  };
}

function shouldKeepItemForChoice(item: Record<string, unknown>, choice: RecallKnowledgeChoice): boolean {
  if (isHiddenItem(item)) return false;
  if (choice.itemFilter) return choice.itemFilter(item);

  const type = item.type;
  return typeof type === 'string' && (choice.itemTypes ?? []).includes(type);
}

function hasItemFilter(choice: RecallKnowledgeChoice): boolean {
  return Boolean(choice.itemFilter || choice.itemTypes?.length);
}

export function isRecallKnowledgePassiveItem(item: Record<string, unknown>): boolean {
  const type = item.type;
  if (type !== 'action' && type !== 'feat') return false;

  const actionType = normalizeString(getProperty(item, 'system.actionType.value'));
  if (actionType) return actionType === 'passive';

  return normalizeString(getProperty(item, 'system.category')) === 'passive' || getTraits(item).has('passive');
}

export function isRecallKnowledgeActionItem(item: Record<string, unknown>): boolean {
  const type = item.type;
  if (type !== 'action' && type !== 'feat') return false;
  if (isRecallKnowledgePassiveItem(item)) return false;

  const actionType = normalizeString(getProperty(item, 'system.actionType.value'));
  if (actionType) return actionType === 'action' || actionType === 'reaction' || actionType === 'free';

  return typeof getProperty(item, 'system.actions.value') === 'number';
}

function getTraits(item: Record<string, unknown>): Set<string> {
  const traits = getProperty(item, 'system.traits.value');
  if (!Array.isArray(traits)) return new Set();

  return new Set(traits.map(trait => normalizeString(trait)).filter(trait => trait.length > 0));
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function getProperty(source: Record<string, unknown>, path: string): unknown {
  return foundry.utils.getProperty(source, path);
}

function localizeWithFallback(key: string, fallback: string): string {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

function isHiddenItem(item: Record<string, unknown>): boolean {
  const system = item.system as Record<string, unknown> | undefined;
  const publication = system?.publication as Record<string, unknown> | undefined;
  const visibility = system?.visibility ?? publication?.visibility;
  return typeof visibility === 'string' && HIDDEN_ITEM_VISIBILITIES.has(visibility);
}

function hasFeat(actor: Actor | null | undefined, slug: string): boolean {
  const normalizedSlug = normalizeFeatText(slug);
  if (getActorRollOptions(actor).some(option => {
    const normalizedOption = normalizeFeatText(option);
    return normalizedOption === `selffeat${normalizedSlug}` || normalizedOption.endsWith(`feat${normalizedSlug}`);
  })) return true;

  return getActorItems(actor).some(item => {
    const itemSlug = normalizeFeatText(getItemString(item, 'slug') ?? getItemString(item, 'system.slug') ?? getItemString(item, 'name') ?? '');
    const itemName = normalizeFeatText(getItemString(item, 'name') ?? '');
    return itemSlug === normalizedSlug || itemName === normalizedSlug;
  });
}

function normalizeFeatText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getActorItems(actor: Actor | null | undefined): unknown[] {
  const itemTypes = (actor as unknown as { itemTypes?: Record<string, unknown[]> } | null | undefined)?.itemTypes;
  const typedItems = itemTypes ? Object.values(itemTypes).flat() : [];
  if (typedItems.length > 0) return typedItems;

  const items = actor?.items as unknown;
  if (Array.isArray(items)) return items;
  if (items && typeof items === 'object' && Array.isArray((items as { contents?: unknown[] }).contents)) {
    return (items as { contents: unknown[] }).contents;
  }
  if (items && typeof (items as Iterable<unknown>)[Symbol.iterator] === 'function') return Array.from(items as Iterable<unknown>);
  return [];
}

function getActorRollOptions(actor: Actor | null | undefined): string[] {
  if (!actor) return [];

  const getSelfRollOptions = (actor as unknown as { getSelfRollOptions?: () => string[] } | null | undefined)?.getSelfRollOptions;
  if (typeof getSelfRollOptions === 'function') return getSelfRollOptions.call(actor);

  const rollOptions = foundry.utils.getProperty(actor as object, 'rollOptions.all');
  return Array.isArray(rollOptions) ? rollOptions.filter((option): option is string => typeof option === 'string') : [];
}

function getItemString(item: unknown, path: string): string | undefined {
  const value = foundry.utils.getProperty(item as object, path);
  return typeof value === 'string' ? value : undefined;
}

function copyPath(source: Record<string, unknown>, target: Record<string, unknown>, path: string[]): void {
  const last = path.at(-1);
  if (!last) return;

  let currentSource: Record<string, unknown> | undefined = source;
  let currentTarget = target;
  for (const segment of path.slice(0, -1)) {
    const next: unknown = currentSource?.[segment];
    if (!isRecord(next)) return;
    currentSource = next;

    const targetNext = currentTarget[segment];
    if (isRecord(targetNext)) {
      currentTarget = targetNext;
    } else {
      const newTarget: Record<string, unknown> = {};
      currentTarget[segment] = newTarget;
      currentTarget = newTarget;
    }
  }

  if (last in currentSource) currentTarget[last] = foundry.utils.deepClone(currentSource[last]);
}

function copyListEntries(source: Record<string, unknown>, target: Record<string, unknown>, path: string[], limit: number): void {
  const value = getPath(source, path);
  const entries = getListEntries(value);
  if (entries.length === 0) return;
  setPath(target, path, foundry.utils.deepClone(entries.slice(0, limit)));
}

function getPath(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  const last = path.at(-1);
  if (!last) return;

  let currentTarget = target;
  for (const segment of path.slice(0, -1)) {
    const targetNext = currentTarget[segment];
    if (isRecord(targetNext)) {
      currentTarget = targetNext;
    } else {
      const newTarget: Record<string, unknown> = {};
      currentTarget[segment] = newTarget;
      currentTarget = newTarget;
    }
  }

  currentTarget[last] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countChoices(choiceIds: RecallKnowledgeChoiceId[]): Map<RecallKnowledgeChoiceId, number> {
  const counts = new Map<RecallKnowledgeChoiceId, number>();
  for (const id of choiceIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function getDiscoverableChoiceCounts(actor: Actor): Map<RecallKnowledgeChoiceId, number> {
  const source = actor.toObject(true) as Record<string, unknown>;
  const liveSystem = (actor as unknown as { system?: unknown }).system;
  const system = isRecord(liveSystem) ? liveSystem : isRecord(source.system) ? source.system : undefined;
  const items = Array.isArray(source.items) ? (source.items as Record<string, unknown>[]) : [];
  const counts = new Map<RecallKnowledgeChoiceId, number>();

  for (const choice of RECALL_KNOWLEDGE_CHOICES) {
    if (choice.paths) {
      const hasDiscoverablePath = choice.paths.some(path => hasPath(system, path.slice(1)));
      counts.set(choice.id, hasDiscoverablePath ? (choice.maxDiscoveries ?? 1) : 0);
    } else if (choice.listPaths) {
      counts.set(choice.id, Math.max(...choice.listPaths.map(path => listLength(system, path.slice(1)))));
    } else if (hasItemFilter(choice)) {
      counts.set(choice.id, items.filter(item => shouldKeepItemForChoice(item, choice)).length);
    } else {
      counts.set(choice.id, 0);
    }
  }

  return counts;
}

function hasPath(source: Record<string, unknown> | undefined, path: string[]): boolean {
  return getPath(source ?? {}, path) !== undefined;
}

function listLength(source: Record<string, unknown> | undefined, path: string[]): number {
  const value = getPath(source ?? {}, path);
  const entries = getListEntries(value);
  return entries.length;
}

function getListEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.value)) return value.value;
  return [];
}
