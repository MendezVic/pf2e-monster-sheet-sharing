import { LINK_DATA_ATTRIBUTE, MODULE_ID, TEMPORARY_ACTOR_FLAG } from '@/constants';
import { dispatchRequest, registerRequestHandler } from '@/services/socket';
import { ActorFilter, ActorSourceLike, InformationLevel, sanitizeActorData } from '@/services/sanitize';

const REQUEST_ACTOR = 'requestActorShare';

interface ShareAccess {
  actorId: string;
  level: InformationLevel;
  users: string[];
  filter?: ActorFilter;
  createdAt: number;
}

interface ActorShareRequest {
  shareId: string;
}

interface ActorShareResponse {
  actor: ActorSourceLike;
}

export interface ShareOptions {
  users?: string[];
  level?: InformationLevel;
  filter?: ActorFilter;
  postToChat?: boolean;
}

export interface MonsterShareApi {
  version: string;
  share: (actor: Actor, users?: string[], options?: Omit<ShareOptions, 'users'>) => Promise<string>;
  open: (shareId: string) => Promise<void>;
  sanitize: typeof sanitizeActorData;
}

const activeShares = new Map<string, ShareAccess>();

export function registerMonsterShare(): void {
  registerRequestHandler<ActorShareRequest, ActorShareResponse>(REQUEST_ACTOR, handleActorRequest);
  Hooks.on('preUpdateActor', blockTemporaryActorUpdates);
  Hooks.on('preDeleteActor', blockTemporaryActorDeletes);
}

export async function shareMonsterSheet(actor: Actor, users?: string[], options: Omit<ShareOptions, 'users'> = {}): Promise<string> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));
  if (actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.npcOnly`));

  const shareId = foundry.utils.randomID();
  const recipientIds = users ?? playerUserIds();
  activeShares.set(shareId, {
    actorId: actor.id ?? '',
    level: options.level ?? 'full',
    users: recipientIds,
    filter: options.filter,
    createdAt: Date.now(),
  });

  if (options.postToChat ?? true) await createShareChatMessage(actor, shareId, recipientIds);
  return shareId;
}

export async function openSharedMonsterSheet(shareId: string): Promise<void> {
  const response = await dispatchRequest<ActorShareRequest, ActorShareResponse>(REQUEST_ACTOR, { shareId });
  const ActorClass = CONFIG.Actor.documentClass as new (data: ActorSourceLike, context?: Record<string, unknown>) => Actor;
  const actor = new ActorClass(response.actor, { strict: false });
  actor.sheet.render(true);
}

export function createMonsterShareApi(version: string): MonsterShareApi {
  return {
    version,
    share: (actor, users, options = {}) => shareMonsterSheet(actor, users, options),
    open: openSharedMonsterSheet,
    sanitize: sanitizeActorData,
  };
}

async function handleActorRequest(request: ActorShareRequest, requesterId: string): Promise<ActorShareResponse> {
  if (!game.user.isGM) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.gmOnly`));

  const share = activeShares.get(request.shareId);
  if (!share) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.shareExpired`));
  if (!share.users.includes(requesterId)) throw new Error(game.i18n.localize(`${MODULE_ID}.errors.notRecipient`));

  const actor = game.actors.get(share.actorId);
  if (!actor || actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorUnavailable`));

  const source = actor.toObject(true) as ActorSourceLike;
  return {
    actor: sanitizeActorData(source, {
      actorId: actor.id ?? undefined,
      level: share.level,
      requesterId,
    }, share.filter),
  };
}

async function createShareChatMessage(actor: Actor, shareId: string, users: string[]): Promise<void> {
  const link = `<a class="content-link pf2e-monster-sheet-sharing__link" ${LINK_DATA_ATTRIBUTE}="${shareId}"><i class="fas fa-paw"></i> ${escapeHtml(actor.name)}</a>`;
  const whisper = users.length > 0 ? users : undefined;
  await CONFIG.ChatMessage.documentClass.create({
    content: game.i18n.format(`${MODULE_ID}.chat.shareContent`, { link }),
    speaker: CONFIG.ChatMessage.documentClass.getSpeaker({ actor }),
    whisper,
  });
}

function blockTemporaryActorUpdates(actor: Actor): boolean | void {
  if (actor.getFlag(MODULE_ID, TEMPORARY_ACTOR_FLAG)) return false;
}

function blockTemporaryActorDeletes(actor: Actor): boolean | void {
  if (actor.getFlag(MODULE_ID, TEMPORARY_ACTOR_FLAG)) return false;
}

function playerUserIds(): string[] {
  return game.users.filter((user) => user.active && !user.isGM).map((user) => user.id);
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}
