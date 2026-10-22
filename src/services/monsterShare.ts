import { LINK_DATA_ATTRIBUTE, MODULE_ID, TEMPORARY_ACTOR_FLAG } from '@/constants';
import { DiscoveredMonsterApp } from '@/apps/DiscoveredMonsterApp';
import {
  createDiscoveredMonsterData,
  DiscoveredMonsterData,
  isDiscoveredMonsterData,
  normalizeNpcDiscoveryKey,
} from '@/services/discoveredMonster';
import {
  createRecallKnowledgeFilter,
  getRecallKnowledgeChoiceViews,
  isRecallKnowledgeChoiceId,
  RecallKnowledgeChoiceId,
} from '@/services/recallKnowledgeChoices';
import { broadcast, dispatchRequest, registerBroadcastHandler, registerRequestHandler } from '@/services/socket';
import { ActorFilter, ActorSourceLike, InformationLevel, sanitizeActorData } from '@/services/sanitize';
import { registerRecallKnowledgePrivacySetting } from '@/services/recallKnowledgePrivacy';

const REQUEST_ACTOR = 'requestActorShare';
const REQUEST_TARGET_ACTOR = 'requestTargetActorShare';
const REQUEST_DISCOVERED_ACTOR_SHARE = 'requestDiscoveredActorShare';
const DISCOVERY_UPDATED = 'discoveryUpdated';
const RECALL_KNOWLEDGE_DISCOVERIES_SETTING = 'recallKnowledgeDiscoveries';
const RESET_RECALL_KNOWLEDGE_DISCOVERIES_MENU = 'resetRecallKnowledgeDiscoveries';
const LINK_ACTOR_UUID_ATTRIBUTE = 'data-monster-share-actor-uuid';
const LINK_MODE_ATTRIBUTE = 'data-monster-share-mode';

const { ApplicationV2, DialogV2 } = foundry.applications.api;

export type ShareMode = 'full' | 'discovered' | 'custom';

interface ShareAccess {
  actorUuid: string;
  mode: ShareMode;
  level: InformationLevel;
  users: string[] | null;
  filter?: ActorFilter;
  createdAt: number;
}

interface ActorShareRequest {
  shareId: string;
  actorUuid?: string;
  mode?: ShareMode;
}

interface TargetActorShareRequest {
  actorUuid: string;
  choices: RecallKnowledgeChoiceId[];
}

interface DiscoveredActorShareRequest {
  actorUuid: string;
}

interface DiscoveryUpdatedMessage {
  discovered: DiscoveredMonsterData;
}

interface ActorShareResponse {
  actor?: ActorSourceLike;
  discovered?: DiscoveredMonsterData;
  mode: ShareMode;
}

export interface TargetActorShareResponse {
  shareId: string;
  discovered?: DiscoveredMonsterData;
}

export interface DiscoveredActorShareResponse {
  shareId: string;
}

export interface MonsterShareLinkFallback {
  actorUuid?: string;
  mode?: ShareMode;
}

export interface MonsterShareLinkData {
  shareId: string;
  fallback?: MonsterShareLinkFallback;
}

export interface ShareOptions {
  users?: string[];
  level?: InformationLevel;
  filter?: ActorFilter;
  postToChat?: boolean;
  actorUuid?: string;
  mode?: ShareMode;
}

export interface MonsterShareApi {
  version: string;
  share: (actor: Actor, users?: string[], options?: Omit<ShareOptions, 'users'>) => Promise<string>;
  shareDiscovered: (actor: Actor, options?: Pick<ShareOptions, 'actorUuid' | 'postToChat'>) => Promise<string>;
  requestDiscoveredShare: (actorUuid: string) => Promise<DiscoveredActorShareResponse>;
  shareTarget: (actorUuid: string, choices: RecallKnowledgeChoiceId[]) => Promise<TargetActorShareResponse>;
  open: (shareId: string, fallback?: MonsterShareLinkFallback) => Promise<void>;
  resetDiscoveries: () => Promise<void>;
  setDiscoveryCount: (actorUuid: string, choice: RecallKnowledgeChoiceId, count: number) => Promise<DiscoveredMonsterData>;
  sanitize: typeof sanitizeActorData;
}

const activeShares = new Map<string, ShareAccess>();
type DiscoverySetting = Record<string, RecallKnowledgeChoiceId[]>;
const recallKnowledgeDiscoveries = new Map<string, RecallKnowledgeChoiceId[]>();

export function registerMonsterShareSettings(): void {
  registerRecallKnowledgePrivacySetting();

  game.settings.register(MODULE_ID, RECALL_KNOWLEDGE_DISCOVERIES_SETTING, {
    name: `${MODULE_ID}.settings.recallKnowledgeDiscoveries.name`,
    scope: 'world',
    config: false,
    type: Object,
    default: {},
  });

  game.settings.registerMenu(MODULE_ID, RESET_RECALL_KNOWLEDGE_DISCOVERIES_MENU, {
    name: `${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.name`,
    label: `${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.label`,
    hint: `${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.hint`,
    icon: 'fa-solid fa-rotate-left',
    type: ResetRecallKnowledgeDiscoveriesApp,
    restricted: true,
  });
}

export function registerMonsterShare(): void {
  registerRequestHandler<ActorShareRequest, ActorShareResponse>(REQUEST_ACTOR, handleActorRequest);
  registerRequestHandler<TargetActorShareRequest, TargetActorShareResponse>(REQUEST_TARGET_ACTOR, handleTargetActorShareRequest);
  registerRequestHandler<DiscoveredActorShareRequest, DiscoveredActorShareResponse>(REQUEST_DISCOVERED_ACTOR_SHARE, handleDiscoveredActorShareRequest);
  registerBroadcastHandler<DiscoveryUpdatedMessage>(DISCOVERY_UPDATED, handleDiscoveryUpdatedBroadcast);
  Hooks.on('preUpdateActor', blockTemporaryActorUpdates);
  Hooks.on('preDeleteActor', blockTemporaryActorDeletes);
}

export async function shareMonsterSheet(actor: Actor, users?: string[], options: Omit<ShareOptions, 'users'> = {}): Promise<string> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));
  if (actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.npcOnly`));

  const shareId = foundry.utils.randomID();
  activeShares.set(shareId, {
    actorUuid: options.actorUuid ?? actor.uuid,
    mode: options.mode ?? (options.filter ? 'custom' : 'full'),
    level: options.level ?? 'full',
    users: users ?? null,
    filter: options.filter,
    createdAt: Date.now(),
  });

  if (options.postToChat ?? true) await createShareChatMessage(actor, shareId);
  return shareId;
}

export async function shareDiscoveredMonsterSheet(actor: Actor, options: Pick<ShareOptions, 'actorUuid' | 'postToChat'> = {}): Promise<string> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));
  if (actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.npcOnly`));

  const discoveredChoices = getKnownRecallKnowledgeChoices(actor);
  return shareMonsterSheet(actor, undefined, {
    level: 'full',
    mode: 'discovered',
    filter: createRecallKnowledgeFilter(discoveredChoices),
    actorUuid: options.actorUuid,
    postToChat: options.postToChat,
  });
}

export async function openSharedMonsterSheet(shareId: string, fallback?: MonsterShareLinkFallback): Promise<void> {
  const response = await dispatchRequest<ActorShareRequest, ActorShareResponse>(REQUEST_ACTOR, {
    shareId,
    actorUuid: fallback?.actorUuid,
    mode: fallback?.mode,
  });
  if (response.mode === 'discovered') {
    openDiscoveredMonsterWindow(response.discovered);
    return;
  }

  if (!response.actor) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorUnavailable`));
  const actorSource = prepareLocalActorSource(response.actor);
  const ActorClass = CONFIG.Actor.documentClass as unknown as new (data: ActorSourceLike, context?: Record<string, unknown>) => Actor;
  const actor = new ActorClass(actorSource, { strict: false });
  makeActorReadOnly(actor);
  actor.sheet.render(true);
}

export async function requestTargetMonsterShare(actorUuid: string, choices: RecallKnowledgeChoiceId[]): Promise<TargetActorShareResponse> {
  return dispatchRequest<TargetActorShareRequest, TargetActorShareResponse>(REQUEST_TARGET_ACTOR, {
    actorUuid,
    choices,
  });
}

export async function requestDiscoveredMonsterShare(actorUuid: string): Promise<DiscoveredActorShareResponse> {
  return dispatchRequest<DiscoveredActorShareRequest, DiscoveredActorShareResponse>(REQUEST_DISCOVERED_ACTOR_SHARE, {
    actorUuid,
  });
}

export async function resetRecallKnowledgeDiscoveries(): Promise<void> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));

  recallKnowledgeDiscoveries.clear();
  await game.settings.set(MODULE_ID, RECALL_KNOWLEDGE_DISCOVERIES_SETTING, {});
}

export async function setRecallKnowledgeDiscoveryCount(actorUuid: string, choice: RecallKnowledgeChoiceId, count: number): Promise<DiscoveredMonsterData> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));

  const actor = await resolveActorFromUuid(actorUuid);
  if (!actor || actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorUnavailable`));

  const maxCount = getRecallKnowledgeChoiceViews(actor, []).find(view => view.id === choice)?.remaining ?? 0;
  const nextCount = Math.min(Math.max(Math.trunc(count), 0), maxCount);
  const existingChoices = getKnownRecallKnowledgeChoices(actor).filter(existingChoice => existingChoice !== choice);
  const choices = [...existingChoices, ...Array.from({ length: nextCount }, () => choice)];

  await setRecallKnowledgeChoices(actor, choices);
  const discovered = createDiscoveredMonsterData(actor, getKnownRecallKnowledgeChoices(actor), actorUuid);
  broadcastDiscoveryUpdate(discovered);
  return discovered;
}

export function createMonsterShareApi(version: string): MonsterShareApi {
  return {
    version,
    share: (actor, users, options = {}) => shareMonsterSheet(actor, users, options),
    shareDiscovered: (actor, options = {}) => shareDiscoveredMonsterSheet(actor, options),
    requestDiscoveredShare: requestDiscoveredMonsterShare,
    shareTarget: requestTargetMonsterShare,
    open: openSharedMonsterSheet,
    resetDiscoveries: resetRecallKnowledgeDiscoveries,
    setDiscoveryCount: setRecallKnowledgeDiscoveryCount,
    sanitize: sanitizeActorData,
  };
}

class ResetRecallKnowledgeDiscoveriesApp extends ApplicationV2 {
  static override DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-reset-recall-knowledge-discoveries`,
    classes: ['pf2e', MODULE_ID, 'pf2e-monster-sheet-sharing__reset-discoveries-app'],
    window: {
      title: 'Reset Recall Knowledge Discoveries',
      icon: 'fa-solid fa-rotate-left',
      resizable: false,
    },
    position: {
      width: 420,
      height: 'auto' as const,
    },
  };

  constructor(options = {}) {
    super(foundry.utils.mergeObject({
      window: {
        title: game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.title`),
      },
    }, options, { inplace: false }));
  }

  protected override async _renderHTML(): Promise<HTMLElement> {
    const root = document.createElement('section');
    root.className = 'pf2e-monster-sheet-sharing__reset-discoveries';

    const prompt = document.createElement('p');
    prompt.textContent = game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.prompt`);
    root.append(prompt);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pf2e-monster-sheet-sharing__reset-discoveries-button';
    button.disabled = !game.user.isGM;
    button.innerHTML = `<i class="fa-solid fa-rotate-left"></i> ${escapeHtml(game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.button`))}`;
    button.addEventListener('click', () => {
      void this.#confirmAndReset();
    });
    root.append(button);

    return root;
  }

  protected override _replaceHTML(result: HTMLElement, content: HTMLElement): void {
    content.replaceChildren(result);
  }

  async #confirmAndReset(): Promise<void> {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));
      return;
    }

    const confirmed = await DialogV2.confirm({
      window: {
        title: game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.confirmTitle`),
      },
      modal: true,
      rejectClose: false,
      content: `<p>${escapeHtml(game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.confirmPrompt`))}</p>`,
      yes: {
        icon: 'fa-solid fa-rotate-left',
        label: game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.confirm`),
      },
      no: {
        label: game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.cancel`),
      },
    });
    if (!confirmed) return;

    await resetRecallKnowledgeDiscoveries();
    ui.notifications.info(game.i18n.localize(`${MODULE_ID}.settings.resetRecallKnowledgeDiscoveries.done`));
    await this.close();
  }
}

async function handleActorRequest(request: ActorShareRequest, requesterId: string): Promise<ActorShareResponse> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));

  const share = activeShares.get(request.shareId) ?? getFallbackShare(request);
  if (!share) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.shareExpired`));
  if (share.users && !share.users.includes(requesterId)) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.notRecipient`));

  const actor = await resolveActorFromUuid(share.actorUuid);
  if (!actor || actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorUnavailable`));

  const source = actor.toObject(true) as ActorSourceLike;
  if (share.mode === 'discovered') {
    const choices = getKnownRecallKnowledgeChoices(actor);
    return {
      mode: 'discovered',
      discovered: createDiscoveredMonsterData(actor, choices, share.actorUuid),
    };
  }

  return {
    mode: share.mode,
    actor: sanitizeActorData(source, {
      actorId: actor.id ?? undefined,
      actorUuid: share.actorUuid,
      level: share.level,
      requesterId,
    }, getShareFilter(actor, share)),
  };
}

async function handleTargetActorShareRequest(request: TargetActorShareRequest, requesterId: string): Promise<TargetActorShareResponse> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));

  const actor = await resolveActorFromUuid(request.actorUuid);
  if (!actor || actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorUnavailable`));

  const availableChoiceCounts = new Map(
    getRecallKnowledgeChoiceViews(actor, getKnownRecallKnowledgeChoices(actor))
      .filter((choice) => !choice.disabled)
      .map((choice) => [choice.id, choice.remaining]),
  );
  const selectedChoiceCounts = new Map<RecallKnowledgeChoiceId, number>();
  const choices = request.choices.filter((choice): choice is RecallKnowledgeChoiceId => {
    if (!isRecallKnowledgeChoiceId(choice)) return false;

    const selectedCount = selectedChoiceCounts.get(choice) ?? 0;
    const availableCount = availableChoiceCounts.get(choice) ?? 0;
    if (selectedCount >= availableCount) return false;

    selectedChoiceCounts.set(choice, selectedCount + 1);
    return true;
  });
  if (choices.length === 0) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.invalidRecallKnowledgeChoice`));

  await rememberRecallKnowledgeChoices(actor, choices);
  const shareId = await shareDiscoveredMonsterSheet(actor, { actorUuid: request.actorUuid });
  const discovered = createDiscoveredMonsterData(actor, getKnownRecallKnowledgeChoices(actor), request.actorUuid);
  broadcastDiscoveryUpdate(discovered);
  return {
    shareId,
    discovered,
  };
}

async function handleDiscoveredActorShareRequest(request: DiscoveredActorShareRequest): Promise<DiscoveredActorShareResponse> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));

  const actor = await resolveActorFromUuid(request.actorUuid);
  if (!actor || actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorUnavailable`));

  const shareId = await shareDiscoveredMonsterSheet(actor, { actorUuid: request.actorUuid });
  return { shareId };
}

async function createShareChatMessage(actor: Actor, shareId: string): Promise<void> {
  const share = activeShares.get(shareId);
  const actorUuid = share?.actorUuid ?? actor.uuid;
  const mode = share?.mode ?? 'full';
  const linkValue = encodeMonsterShareLinkData({ shareId, fallback: { actorUuid, mode } });
  const link = `<a class="pf2e-monster-sheet-sharing__link" ${LINK_DATA_ATTRIBUTE}="${escapeHtml(linkValue)}" ${LINK_ACTOR_UUID_ATTRIBUTE}="${escapeHtml(actorUuid)}" ${LINK_MODE_ATTRIBUTE}="${mode}" role="button" tabindex="0"><i class="fas fa-paw"></i> ${escapeHtml(actor.name)}</a>`;
  const ChatMessageClass = CONFIG.ChatMessage.documentClass as unknown as typeof ChatMessage;
  await ChatMessageClass.create({
    content: game.i18n.format(`${MODULE_ID}.chat.shareContent`, { link }),
    speaker: ChatMessageClass.getSpeaker({ actor }),
  });
}

export function openDiscoveredMonsterWindow(data: unknown): void {
  if (!isDiscoveredMonsterData(data)) {
    throw new Error(game.i18n.localize(`${MODULE_ID}.errors.discoveredUnavailable`));
  }

  DiscoveredMonsterApp.open(data);
}

function handleDiscoveryUpdatedBroadcast(message: DiscoveryUpdatedMessage): void {
  if (!isDiscoveredMonsterData(message.discovered)) return;
  DiscoveredMonsterApp.updateOpen(message.discovered);
}

function broadcastDiscoveryUpdate(discovered: DiscoveredMonsterData): void {
  broadcast<DiscoveryUpdatedMessage>(DISCOVERY_UPDATED, { discovered });
}

export function getMonsterShareLinkData(link: HTMLElement): MonsterShareLinkData | null {
  const raw = link.getAttribute(LINK_DATA_ATTRIBUTE);
  if (!raw) return null;

  const parsed = decodeMonsterShareLinkData(raw);
  if (parsed) return parsed;

  const legacyFallback = getMonsterShareLinkFallback(link);
  return {
    shareId: raw,
    fallback: legacyFallback.actorUuid || legacyFallback.mode ? legacyFallback : undefined,
  };
}

export function getMonsterShareLinkFallback(link: HTMLElement): MonsterShareLinkFallback {
  const actorUuid = link.getAttribute(LINK_ACTOR_UUID_ATTRIBUTE) ?? undefined;
  const mode = link.getAttribute(LINK_MODE_ATTRIBUTE);
  return {
    actorUuid,
    mode: isShareMode(mode) ? mode : undefined,
  };
}

function encodeMonsterShareLinkData(data: MonsterShareLinkData): string {
  const actorUuid = data.fallback?.actorUuid ? encodeURIComponent(data.fallback.actorUuid) : '';
  const mode = data.fallback?.mode ?? '';
  return [data.shareId, mode, actorUuid].join('|');
}

function decodeMonsterShareLinkData(value: string): MonsterShareLinkData | null {
  const parts = value.split('|');
  if (parts.length !== 3) return null;

  const [shareId, mode, actorUuid] = parts;
  if (!shareId) return null;

  return {
    shareId,
    fallback: {
      actorUuid: actorUuid ? decodeURIComponent(actorUuid) : undefined,
      mode: isShareMode(mode) ? mode : undefined,
    },
  };
}

function getFallbackShare(request: ActorShareRequest): ShareAccess | null {
  if (!request.actorUuid || !request.mode || request.mode === 'custom') return null;

  return {
    actorUuid: request.actorUuid,
    mode: request.mode,
    level: 'full',
    users: null,
    createdAt: Date.now(),
  };
}

function getShareFilter(actor: Actor, share: ShareAccess): ActorFilter | undefined {
  if (share.mode === 'discovered') return createRecallKnowledgeFilter(getKnownRecallKnowledgeChoices(actor));
  return share.filter;
}

function isShareMode(value: unknown): value is ShareMode {
  return value === 'full' || value === 'discovered' || value === 'custom';
}

function blockTemporaryActorUpdates(actor: Actor): boolean | void {
  if (actor.getFlag(MODULE_ID, TEMPORARY_ACTOR_FLAG)) return false;
}

function blockTemporaryActorDeletes(actor: Actor): boolean | void {
  if (actor.getFlag(MODULE_ID, TEMPORARY_ACTOR_FLAG)) return false;
}

function makeActorReadOnly(actor: Actor): void {
  const warn = () => {
    ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.errors.readOnly`));
    return Promise.resolve(undefined);
  };
  const warnEmbedded = () => {
    ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.errors.readOnly`));
    return Promise.resolve([]);
  };

  const readOnlyActor = actor as unknown as Record<string, unknown>;

  readOnlyActor.update = warn;
  readOnlyActor.delete = warn;
  readOnlyActor.createEmbeddedDocuments = warnEmbedded;
  readOnlyActor.updateEmbeddedDocuments = warnEmbedded;
  readOnlyActor.deleteEmbeddedDocuments = warnEmbedded;
}

function prepareLocalActorSource(source: ActorSourceLike): ActorSourceLike {
  const actorSource = foundry.utils.deepClone(source) as ActorSourceLike;
  actorSource.ownership = {
    default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
  };
  return actorSource;
}

function isActor(value: unknown): value is Actor {
  return value instanceof CONFIG.Actor.documentClass;
}

function isTokenDocument(value: unknown): value is TokenDocument {
  return value instanceof CONFIG.Token.documentClass;
}

async function resolveActorFromUuid(uuid: string): Promise<Actor | null> {
  const document = await foundry.utils.fromUuid(uuid);
  if (isActor(document)) return document;
  if (isTokenDocument(document)) return document.actor ?? null;
  return null;
}

async function rememberRecallKnowledgeChoices(
  actor: Actor,
  choices: RecallKnowledgeChoiceId[],
): Promise<RecallKnowledgeChoiceId[]> {
  const discoveryKey = normalizeNpcDiscoveryKey(actor.name);
  const memoryChoices = recallKnowledgeDiscoveries.get(discoveryKey);
  const existing = memoryChoices ?? getPersistedRecallKnowledgeChoices(discoveryKey);
  const discoveredChoices = [...existing, ...choices];

  recallKnowledgeDiscoveries.set(discoveryKey, discoveredChoices);
  await persistRecallKnowledgeChoices(discoveryKey, discoveredChoices);

  return discoveredChoices;
}

async function setRecallKnowledgeChoices(actor: Actor, choices: RecallKnowledgeChoiceId[]): Promise<RecallKnowledgeChoiceId[]> {
  const discoveryKey = normalizeNpcDiscoveryKey(actor.name);
  recallKnowledgeDiscoveries.set(discoveryKey, choices);
  await persistRecallKnowledgeChoices(discoveryKey, choices);
  return choices;
}

export function getKnownRecallKnowledgeChoices(actor: Actor): RecallKnowledgeChoiceId[] {
  const discoveryKey = normalizeNpcDiscoveryKey(actor.name);
  const memoryChoices = recallKnowledgeDiscoveries.get(discoveryKey);
  return memoryChoices ?? getPersistedRecallKnowledgeChoices(discoveryKey);
}

function getPersistedRecallKnowledgeChoices(discoveryKey: string): RecallKnowledgeChoiceId[] {
  const discoveries = getDiscoverySetting();
  const choices = discoveries[discoveryKey];
  return Array.isArray(choices) ? filterRecallKnowledgeChoices(choices) : [];
}

async function persistRecallKnowledgeChoices(
  discoveryKey: string,
  choices: RecallKnowledgeChoiceId[],
): Promise<void> {
  try {
    const discoveries = foundry.utils.deepClone(getDiscoverySetting()) as DiscoverySetting;
    discoveries[discoveryKey] = choices;
    await game.settings.set(MODULE_ID, RECALL_KNOWLEDGE_DISCOVERIES_SETTING, discoveries);
  } catch (error) {
    console.warn(`${MODULE_ID} | Unable to persist Recall Knowledge discoveries`, error);
  }
}

function getDiscoverySetting(): DiscoverySetting {
  const value = game.settings.get(MODULE_ID, RECALL_KNOWLEDGE_DISCOVERIES_SETTING);
  return isRecord(value) ? value as DiscoverySetting : {};
}

function filterRecallKnowledgeChoices(choices: unknown[]): RecallKnowledgeChoiceId[] {
  return choices.filter((choice): choice is RecallKnowledgeChoiceId => {
    return typeof choice === 'string' && isRecallKnowledgeChoiceId(choice);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}
