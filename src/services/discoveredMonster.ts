import { RecallKnowledgeChoiceId, isRecallKnowledgeActionItem, isRecallKnowledgePassiveItem } from '@/services/recallKnowledgeChoices';
import { ActorSourceLike } from '@/services/sanitize';

export interface DiscoveredMonsterItem {
  name: string;
  type: string;
  description: string;
}

export interface DiscoveredMonsterSection {
  id: RecallKnowledgeChoiceId;
  label: string;
  rows: DiscoveredMonsterRow[];
  items: DiscoveredMonsterItem[];
}

export interface DiscoveredMonsterRow {
  label: string;
  value: string;
  kind?: 'size-scale';
}

export interface DiscoveredMonsterData {
  name: string;
  actorUuid?: string;
  image?: string;
  choices: RecallKnowledgeChoiceId[];
  sections: DiscoveredMonsterSection[];
}

const CHOICE_LABEL_KEYS: Record<RecallKnowledgeChoiceId, string> = {
  ac: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.ac',
  action: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.action',
  attack: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.attack',
  fortitude: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.fortitude',
  hp: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.hp',
  identity: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.identity',
  immunity: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.immunity',
  passive: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.passive',
  perception: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.perception',
  reflex: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.reflex',
  resistance: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.resistance',
  speed: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.speed',
  weakness: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.weakness',
  will: 'pf2e-monster-sheet-sharing.recallKnowledge.choices.will',
};
const CHOICE_LABEL_FALLBACKS: Record<RecallKnowledgeChoiceId, string> = {
  ac: 'AC',
  action: 'Actions',
  attack: 'Attacks',
  fortitude: 'Fortitude',
  hp: 'HP',
  identity: 'Identity',
  immunity: 'Immunity',
  passive: 'Passives',
  perception: 'Perception',
  reflex: 'Reflex',
  resistance: 'Resistance',
  speed: 'Speed',
  weakness: 'Weakness',
  will: 'Will',
};
const DISCOVERED_SECTION_ORDER: RecallKnowledgeChoiceId[] = ['identity', 'perception', 'speed', 'ac', 'hp', 'fortitude', 'reflex', 'will', 'immunity', 'resistance', 'weakness', 'attack', 'action', 'passive'];
const UNKNOWN_VALUE = '??';

export function normalizeNpcDiscoveryKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function createDiscoveredMonsterData(actor: Actor, choices: RecallKnowledgeChoiceId[], actorUuid: string = actor.uuid): DiscoveredMonsterData {
  const source = actor.toObject(true) as ActorSourceLike;
  const liveSystem = (actor as unknown as { system?: unknown }).system;
  const system = isRecord(liveSystem) ? liveSystem : source.system as Record<string, unknown> | undefined;
  const items = Array.isArray(source.items) ? (source.items as Record<string, unknown>[]) : [];
  const choiceCounts = countChoices(choices);
  const sections: DiscoveredMonsterSection[] = [];

  for (const id of DISCOVERED_SECTION_ORDER) {
    if (!choiceCounts.has(id)) continue;
    sections.push(createSection(id, system, items, choiceCounts.get(id) ?? 1));
  }

  return {
    name: actor.name,
    actorUuid,
    image: typeof source.img === 'string' ? source.img : undefined,
    choices,
    sections: sections.filter(section => section.rows.length > 0 || section.items.length > 0),
  };
}

function createSection(id: RecallKnowledgeChoiceId, system: Record<string, unknown> | undefined, items: Record<string, unknown>[], count: number): DiscoveredMonsterSection {
  switch (id) {
    case 'identity':
      return createIdentitySection(system);
    case 'perception':
      return createPerceptionSection(system);
    case 'ac':
      return createSingleRowSection('ac', row('AC', getProperty(system, 'attributes.ac.value')));
    case 'hp':
      return createSingleRowSection('hp', row('HP', formatHitPoints(system)));
    case 'fortitude':
      return createSingleRowSection('fortitude', row('Fortitude', getProperty(system, 'saves.fortitude.value'), { signed: true }));
    case 'reflex':
      return createSingleRowSection('reflex', row('Reflex', getProperty(system, 'saves.reflex.value'), { signed: true }));
    case 'will':
      return createSingleRowSection('will', row('Will', getProperty(system, 'saves.will.value'), { signed: true }));
    case 'speed':
      return createSingleRowSection('speed', row('Speed', getProperty(system, 'attributes.speed.value') ?? getProperty(system, 'attributes.speed')));
    case 'immunity':
      return createWeaknessLikeSection('immunity', getProperty(system, 'attributes.immunities'), count);
    case 'resistance':
      return createWeaknessLikeSection('resistance', getProperty(system, 'attributes.resistances'), count);
    case 'weakness':
      return createWeaknessLikeSection('weakness', getProperty(system, 'attributes.weaknesses'), count);
    case 'attack':
      return createItemSection('attack', items, count);
    case 'action':
      return createItemSection('action', items, count);
    case 'passive':
      return createItemSection('passive', items, count);
  }
}

export function isDiscoveredMonsterData(value: unknown): value is DiscoveredMonsterData {
  if (!isRecord(value)) return false;
  return typeof value.name === 'string'
    && (value.actorUuid === undefined || typeof value.actorUuid === 'string')
    && Array.isArray(value.choices)
    && value.choices.every(choice => typeof choice === 'string')
    && Array.isArray(value.sections)
    && value.sections.every(isDiscoveredMonsterSection);
}

function isDiscoveredMonsterSection(value: unknown): value is DiscoveredMonsterSection {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.label === 'string' && Array.isArray(value.rows) && value.rows.every(isDiscoveredMonsterRow) && Array.isArray(value.items) && value.items.every(isDiscoveredMonsterItem);
}

function isDiscoveredMonsterRow(value: unknown): value is DiscoveredMonsterRow {
  return isRecord(value) && typeof value.label === 'string' && typeof value.value === 'string' && (value.kind === undefined || value.kind === 'size-scale');
}

function isDiscoveredMonsterItem(value: unknown): value is DiscoveredMonsterItem {
  return isRecord(value) && typeof value.name === 'string' && typeof value.type === 'string' && typeof value.description === 'string';
}

function createIdentitySection(system: Record<string, unknown> | undefined): DiscoveredMonsterSection {
  return {
    id: 'identity',
    label: localizeChoiceLabel('identity'),
    rows: [row('Level', getProperty(system, 'details.level.value')), sizeRow(getProperty(system, 'traits.size')), row('Traits', formatTraits(getProperty(system, 'traits.value'))), row('Languages', formatList(getProperty(system, 'details.languages.value')))],
    items: [],
  };
}

function formatHitPoints(system: Record<string, unknown> | undefined): string {
  const current = formatValue(getProperty(system, 'attributes.hp.value'));
  const maximum = formatValue(getProperty(system, 'attributes.hp.max'));

  if (current && maximum) return `${current}/${maximum}`;
  return current || maximum;
}

function createSingleRowSection(id: RecallKnowledgeChoiceId, discoveredRow: DiscoveredMonsterRow): DiscoveredMonsterSection {
  return {
    id,
    label: localizeChoiceLabel(id),
    rows: [discoveredRow],
    items: [],
  };
}

function createWeaknessLikeSection(id: 'immunity' | 'resistance' | 'weakness', value: unknown, count: number): DiscoveredMonsterSection {
  const entries = sortWeaknessLikeEntries(getWeaknessLikeEntries(value)).slice(0, count);

  if (id === 'immunity') {
    const names = entries
      .map(entry => weaknessLikeEntryName(entry))
      .filter(name => name.length > 0);
    const rows = pairNamesIntoRows(names);

    return {
      id,
      label: localizeChoiceLabel(id),
      rows: rows.length > 0 ? rows : [row(UNKNOWN_VALUE, '')],
      items: [],
    };
  }

  const rows = entries
    .map(entry => weaknessLikeEntryToRow(entry))
    .filter((discoveredRow): discoveredRow is DiscoveredMonsterRow => discoveredRow !== null);

  return {
    id,
    label: localizeChoiceLabel(id),
    rows: rows.length > 0 ? rows : [row(UNKNOWN_VALUE, '')],
    items: [],
  };
}

function createPerceptionSection(system: Record<string, unknown> | undefined): DiscoveredMonsterSection {
  const rows = [optionalRow('Perception', getProperty(system, 'perception.mod') ?? getProperty(system, 'perception.value'), { signed: true }), optionalRow('Senses', formatSenses(getProperty(system, 'perception.senses') ?? getProperty(system, 'attributes.senses')))].filter((discoveredRow): discoveredRow is DiscoveredMonsterRow => discoveredRow !== null);

  return {
    id: 'perception',
    label: localizeChoiceLabel('perception'),
    rows,
    items: [],
  };
}

function createItemSection(id: 'attack' | 'action' | 'passive', items: Record<string, unknown>[], limit: number): DiscoveredMonsterSection {
  return {
    id,
    label: localizeChoiceLabel(id),
    rows: [],
    items: items
      .filter(item => {
        return shouldKeepItemForSection(item, id);
      })
      .map(item => ({
        name: typeof item.name === 'string' ? item.name : 'Unknown',
        type: typeof item.type === 'string' ? item.type : '',
        description: createItemDescription(item),
      }))
      .slice(0, limit),
  };
}

function shouldKeepItemForSection(item: Record<string, unknown>, id: 'attack' | 'action' | 'passive'): boolean {
  if (isHiddenItem(item)) return false;

  const type = item.type;
  if (typeof type !== 'string') return false;

  if (id === 'attack') return ['melee', 'spellcastingEntry', 'spell'].includes(type);
  if (id === 'action') return isRecallKnowledgeActionItem(item);
  return isRecallKnowledgePassiveItem(item);
}

function row(label: string, value: unknown, options: { signed?: boolean } = {}): DiscoveredMonsterRow {
  const formatted = formatValue(value, options);
  return { label, value: formatted || UNKNOWN_VALUE };
}

function optionalRow(label: string, value: unknown, options: { signed?: boolean } = {}): DiscoveredMonsterRow | null {
  const formatted = formatValue(value, options);
  return formatted ? { label, value: formatted } : null;
}

function sizeRow(value: unknown): DiscoveredMonsterRow {
  return {
    label: 'Size',
    value: normalizeSize(value) ?? UNKNOWN_VALUE,
    kind: 'size-scale',
  };
}

function getProperty(source: Record<string, unknown> | undefined, path: string): unknown {
  if (!source) return undefined;
  return foundry.utils.getProperty(source, path);
}

function formatValue(value: unknown, options: { signed?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return options.signed && value >= 0 ? `+${value}` : String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return formatList(value);
  return '';
}

function formatList(value: unknown): string {
  if (!Array.isArray(value)) return formatValue(value);
  return value
    .map(entry => formatValue(entry))
    .filter(Boolean)
    .join(', ');
}

function formatTraits(value: unknown): string {
  return formatList(value);
}

function normalizeSize(value: unknown): string | null {
  if (isRecord(value)) {
    return normalizeSize(value.value) ?? normalizeSize(value.label) ?? normalizeSize(value.longLabel) ?? normalizeSize(value.shortLabel);
  }

  if (typeof value !== 'string') return null;
  const size = value.trim().toLocaleLowerCase();
  const keys: Record<string, string> = {
    tiny: 'tiny',
    t: 'tiny',
    sm: 'sm',
    small: 'sm',
    med: 'med',
    medium: 'med',
    lg: 'lg',
    large: 'lg',
    huge: 'huge',
    h: 'huge',
    grg: 'grg',
    gargantuan: 'grg',
    g: 'grg',
  };
  return keys[size] ?? null;
}

function formatSenses(value: unknown): string {
  if (typeof value === 'string') return formatSenseText(value);
  if (!Array.isArray(value)) return formatValue(value);
  return value
    .map(sense => {
      if (typeof sense === 'string') return formatSenseText(sense);
      if (!isRecord(sense)) return formatValue(sense);
      const type = formatValue(sense.type);
      const acuity = formatValue(sense.acuity);
      const range = formatSenseRange(sense.range);
      return [acuity, type, range].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

function formatSenseRange(value: unknown): string {
  if (typeof value === 'number') return `${value} feet`;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return `${value.trim()} feet`;
  return formatValue(value);
}

function formatSenseText(value: string): string {
  return value.replace(/\b(\d+)(?!\s*(?:feet|foot|ft\.?|miles?|meters?|metres?)\b)/gi, '$1 feet');
}

function weaknessLikeEntryName(entry: unknown): string {
  const discoveredRow = weaknessLikeEntryToRow(entry);
  return discoveredRow?.label ?? '';
}

function pairNamesIntoRows(names: string[]): DiscoveredMonsterRow[] {
  const rows: DiscoveredMonsterRow[] = [];
  for (let index = 0; index < names.length; index += 2) {
    rows.push({
      label: names[index] ?? UNKNOWN_VALUE,
      value: names[index + 1] ?? '',
    });
  }
  return rows;
}

function weaknessLikeEntryToRow(entry: unknown): DiscoveredMonsterRow | null {
  if (!isRecord(entry)) {
    const text = formatValue(entry);
    return text ? { label: text, value: '' } : null;
  }

  const valueText = formatWeaknessLikeValue(entry);
  const typeText = formatWeaknessLikeType(entry, valueText);
  if (!typeText && !valueText) return null;

  return {
    label: typeText || UNKNOWN_VALUE,
    value: valueText,
  };
}

function formatWeaknessLikeValue(entry: Record<string, unknown>): string {
  const value = entry.value;
  if (typeof value === 'number' || typeof value === 'string') return formatValue(value);
  return '';
}

function formatWeaknessLikeType(entry: Record<string, unknown>, valueText: string): string {
  const typeText = formatEntryType(entry.type);
  if (typeText) return typeText;

  const label = formatValue(entry.label);
  if (!label) return '';

  return parseTypeFromCombinedLabel(label, valueText);
}

function formatEntryType(type: unknown): string {
  if (typeof type === 'string') return type;
  if (!isRecord(type)) return '';
  return formatValue(type.label) || formatValue(type.value) || formatValue(type.slug);
}

function parseTypeFromCombinedLabel(label: string, valueText: string): string {
  if (valueText && label.endsWith(` ${valueText}`)) {
    return label.slice(0, label.length - valueText.length - 1).trim();
  }

  const match = label.match(/^(.+?)\s+(\d+)$/);
  if (match) return match[1].trim();

  return label;
}

function getWeaknessLikeEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.value)) return value.value;
  return [];
}

function sortWeaknessLikeEntries(entries: unknown[]): unknown[] {
  return [...entries].sort((a, b) => getWeaknessLikeEntryValue(b) - getWeaknessLikeEntryValue(a));
}

function getWeaknessLikeEntryValue(entry: unknown): number {
  if (!isRecord(entry)) return 0;
  const value = entry.value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function cleanDescription(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  return foundry.utils.cleanHTML(localizeInlineText(value));
}

function createItemDescription(item: Record<string, unknown>): string {
  const description = cleanDescription(getProperty(item, 'system.description.value'));
  if (description) return description;
  if (item.type === 'melee') return formatMeleeAttackDescription(item);
  return '';
}

function formatMeleeAttackDescription(item: Record<string, unknown>): string {
  const rows = [formatAttackBonus(getProperty(item, 'system.bonus.value')), formatAttackDamage(getProperty(item, 'system.damageRolls')), formatLabelledList('Traits', getProperty(item, 'system.traits.value')), formatLabelledList('Effects', getProperty(item, 'system.attackEffects.value')), formatAttackRange(getProperty(item, 'system.range.increment'), getProperty(item, 'system.range.max')), formatAttackArea(getProperty(item, 'system.area.type'), getProperty(item, 'system.area.value'))].filter(Boolean);

  return rows.length > 0 ? `<p>${rows.map(escapeHtml).join('<br>')}</p>` : '';
}

function formatAttackBonus(value: unknown): string {
  if (typeof value !== 'number') return '';
  return `Strike ${formatValue(value, { signed: true })}`;
}

function formatAttackDamage(value: unknown): string {
  if (!isRecord(value)) return '';

  const damage = Object.values(value)
    .map(roll => {
      if (!isRecord(roll)) return '';
      const formula = formatValue(roll.damage);
      const type = formatValue(roll.damageType);
      return [formula, type].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(' + ');

  return damage ? `Damage ${damage}` : '';
}

function formatLabelledList(label: string, value: unknown): string {
  const text = formatList(value);
  return text ? `${label} ${text}` : '';
}

function formatAttackRange(increment: unknown, max: unknown): string {
  if (typeof increment === 'number') return `Range ${increment} feet`;
  if (typeof max === 'number') return `Range ${max} feet`;
  return '';
}

function formatAttackArea(type: unknown, value: unknown): string {
  const typeText = formatValue(type);
  const valueText = typeof value === 'number' ? `${value} feet` : formatValue(value);
  const area = [valueText, typeText].filter(Boolean).join(' ');
  return area ? `Area ${area}` : '';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function localizeInlineText(value: string): string {
  return value.replace(/@Localize\[([^\]]+)\]/g, (_match, key: string) => game.i18n.localize(key));
}

function localizeChoiceLabel(id: RecallKnowledgeChoiceId): string {
  const value = game.i18n.localize(CHOICE_LABEL_KEYS[id]);
  return value === CHOICE_LABEL_KEYS[id] ? CHOICE_LABEL_FALLBACKS[id] : value;
}

function isHiddenItem(item: Record<string, unknown>): boolean {
  const visibility = getProperty(item, 'system.visibility') ?? getProperty(item, 'system.publication.visibility');
  return visibility === 'gm' || visibility === 'owner';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countChoices(choices: RecallKnowledgeChoiceId[]): Map<RecallKnowledgeChoiceId, number> {
  const counts = new Map<RecallKnowledgeChoiceId, number>();
  for (const choice of choices) {
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }
  return counts;
}
