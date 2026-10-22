import { MODULE_ID } from '@/constants';
import { getRecallKnowledgeChoiceViews, getRecallKnowledgeDiscoveryChoiceCount, RecallKnowledgeChoiceView, isRecallKnowledgeChoiceId, RecallKnowledgeChoiceId } from '@/services/recallKnowledgeChoices';
import { isDiscoveredMonsterData } from '@/services/discoveredMonster';
import { getKnownRecallKnowledgeChoices, openDiscoveredMonsterWindow, openSharedMonsterSheet, requestTargetMonsterShare } from '@/services/monsterShare';

type DegreeOfSuccess = 0 | 1 | 2 | 3;

const DICE_SO_NICE_TIMEOUT_MS = 10_000;
const OTHER_RECALL_KNOWLEDGE_CHOICE_ID = '__other';
let recallKnowledgeHooksRegistered = false;

interface DiceSoNiceApi {
  waitFor3DAnimationByMessageID?: (messageId: string) => Promise<void>;
}

interface HookControls {
  on: (hook: string, callback: (...args: unknown[]) => void) => number;
  off: (hook: string, callback: (...args: unknown[]) => void) => void;
}

interface RecallKnowledgeMessage {
  actor?: Actor | null;
  item?: {
    name?: string;
    slug?: string | null;
  } | null;
  speakerActor?: Actor | null;
  target?: {
    actor: Actor;
    token?: TokenDocument;
  } | null;
  token?: TokenDocument | null;
}

interface RecallKnowledgeContext {
  action?: string | null;
  domains?: string[];
  identifier?: string | null;
  options?: string[];
  slug?: string | null;
  title?: string | null;
  type?: string | null;
}

interface RollWithCheckOptions {
  degreeOfSuccess?: DegreeOfSuccess | null;
  options?: {
    action?: string | null;
    domains?: string[];
    degreeOfSuccess?: DegreeOfSuccess;
    identifier?: string | null;
    isReroll?: boolean;
    slug?: string | null;
  };
}

export function registerRecallKnowledgeHooks(): void {
  if (recallKnowledgeHooksRegistered) return;
  recallKnowledgeHooksRegistered = true;

  Hooks.on('createChatMessage', (message: ChatMessage, _options: object, userId: string) => {
    if (userId !== game.user.id) return;

    const result = getSuccessfulRecallKnowledgeResult(message);
    if (!result) return;

    void handleSuccessfulRecallKnowledge(message, result).catch(error => {
      ui.notifications.error(error instanceof Error ? error.message : game.i18n.localize(`${MODULE_ID}.errors.shareFailed`));
    });
  });
}

function getSuccessfulRecallKnowledgeResult(message: ChatMessage): { actor: Actor; actorUuid: string; degreeOfSuccess: DegreeOfSuccess } | null {
  const target = getRecallKnowledgeTarget(message);
  const targetActor = target?.actor;
  if (!targetActor || targetActor.type !== 'npc') return null;

  const roll = getCheckRoll(message);
  const degreeOfSuccess = roll?.degreeOfSuccess ?? roll?.options?.degreeOfSuccess ?? null;
  if (degreeOfSuccess !== 2 && degreeOfSuccess !== 3) return null;
  if (roll?.options?.isReroll) return null;
  if (!isRecallKnowledgeMessage(message, roll)) return null;

  return {
    actor: targetActor,
    actorUuid: target.tokenUuid ?? targetActor.uuid,
    degreeOfSuccess,
  };
}

async function handleSuccessfulRecallKnowledge(message: ChatMessage, result: { actor: Actor; actorUuid: string; degreeOfSuccess: DegreeOfSuccess }): Promise<void> {
  await waitForDiceSoNice(message);

  const recallActor = getRecallKnowledgeActor(message);
  const choiceCount = getRecallKnowledgeDiscoveryChoiceCount(recallActor, result.degreeOfSuccess, {
    isLoreSkill: isRecallKnowledgeLoreSkill(message),
    loreRank: getRecallKnowledgeLoreRank(message),
  });
  if (choiceCount === 0) return;

  const choices = await promptRecallKnowledgeChoices(choiceCount, result.actor, recallActor);
  if (choices.length === 0) return;

  const response = await requestTargetMonsterShare(result.actorUuid, choices);
  if (isDiscoveredMonsterData(response.discovered)) {
    openDiscoveredMonsterWindow(response.discovered);
    return;
  }

  await openSharedMonsterSheet(response.shareId, {
    actorUuid: result.actorUuid,
    mode: 'discovered',
  });
}

async function promptRecallKnowledgeChoices(choiceCount: number, actor: Actor, recallActor: Actor | null): Promise<RecallKnowledgeChoiceId[]> {
  const choices = getRecallKnowledgeChoiceViews(actor, getKnownRecallKnowledgeChoices(actor));
  const availableChoices = choices.filter(choice => !choice.disabled);
  const count = Math.min(choiceCount, availableChoices.reduce((total, choice) => total + choice.remaining, 1));
  if (count === 0) {
    ui.notifications.info(game.i18n.localize(`${MODULE_ID}.recallKnowledge.noMoreDiscoveries`));
    return [];
  }

  const actorHasReasonRapidly = hasFeat(recallActor, 'reason-rapidly');

  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: game.i18n.localize(`${MODULE_ID}.recallKnowledge.title`),
    },
    modal: true,
    content: buildChoiceDialogContent(count, choices, actorHasReasonRapidly),
    render: (_event, app) => {
      initializeRecallKnowledgeDialog((app as { element?: HTMLElement }).element ?? null);
    },
    buttons: [
      {
        action: 'cancel',
        label: game.i18n.localize(`${MODULE_ID}.recallKnowledge.buttons.cancel`),
        icon: 'fas fa-xmark',
        callback: () => 'cancel',
      },
      {
        action: 'share',
        label: game.i18n.localize(`${MODULE_ID}.recallKnowledge.buttons.reveal`),
        icon: 'fas fa-eye',
        default: true,
        callback: (_event, button) => {
          const form = button.form;
          if (!form) return [];

          const formData = new FormData(form);
          const useReasonRapidly = formData.get('reason-rapidly') === 'on';
          const limit = useReasonRapidly ? 1 : count;
          const selected = Array.from(form.querySelectorAll<HTMLInputElement>('.pf2e-monster-sheet-sharing__rk-option input[name="choice"]'))
            .flatMap(input => {
              if (!isRecallKnowledgeChoiceId(input.value) && input.value !== OTHER_RECALL_KNOWLEDGE_CHOICE_ID) return [];

              const selectedCount = Math.max(Number(input.dataset.count ?? '0'), 0);
              return Array.from({ length: selectedCount }, () => input.value);
            })
            .slice(0, limit);

          return { selected, useReasonRapidly };
        },
      },
    ],
  });

  if (result === 'cancel') return [];
  if (!result || typeof result !== 'object' || !('selected' in result) || !('useReasonRapidly' in result)) return [];
  const payload = result as { selected: unknown; useReasonRapidly: boolean };
  const selectedValues = Array.isArray(payload.selected) ? payload.selected : [];
  const selectedChoices = selectedValues.filter((choice): choice is RecallKnowledgeChoiceId => {
    return typeof choice === 'string' && isRecallKnowledgeChoiceId(choice);
  });
  const hasOtherChoice = selectedValues.includes(OTHER_RECALL_KNOWLEDGE_CHOICE_ID);
  if (selectedChoices.length === 0 && !hasOtherChoice) {
    ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.errors.invalidRecallKnowledgeChoice`));
    return promptRecallKnowledgeChoices(choiceCount, actor, recallActor);
  }

  if (selectedChoices.length === 0) return [];

  if (payload.useReasonRapidly) {
    return [selectedChoices[0]];
  }

  return selectedChoices.slice(0, choiceCount);
}

function buildChoiceDialogContent(choiceCount: number, choices: RecallKnowledgeChoiceView[], actorHasReasonRapidly: boolean): string {
  const otherLabel = localizeWithFallback(`${MODULE_ID}.recallKnowledge.choices.other`, 'Other');
  const optionButtons = choices
    .map(choice => {
      const disabledClass = choice.disabled ? ' pf2e-monster-sheet-sharing__rk-option--disabled' : '';
      const maxCount = Math.max(choice.remaining, 0);
      const optionClass = maxCount > 1 ? ' pf2e-monster-sheet-sharing__rk-option--counted' : '';
      const content = maxCount > 1
        ? `
          <button type="button" class="pf2e-monster-sheet-sharing__rk-count-button" data-count-action="decrease" aria-label="Decrease ${escapeHtml(choice.label)}">-</button>
          <span class="pf2e-monster-sheet-sharing__rk-option-label">
            <span class="pf2e-monster-sheet-sharing__rk-option-count" data-count-label>0</span>
            ${escapeHtml(choice.label)}
          </span>
          <button type="button" class="pf2e-monster-sheet-sharing__rk-count-button" data-count-action="increase" aria-label="Increase ${escapeHtml(choice.label)}">+</button>
        `
        : `<span class="pf2e-monster-sheet-sharing__rk-option-label">${escapeHtml(choice.label)}</span>`;

      return `
        <div class="pf2e-monster-sheet-sharing__rk-option${optionClass}${disabledClass}" role="button" tabindex="${choice.disabled ? '-1' : '0'}">
          <input type="hidden" name="choice" value="${escapeHtml(choice.id)}" data-count="0" data-max="${maxCount}" disabled />
          ${content}
        </div>
      `;
    })
    .join('');
  const otherButton = `
    <div class="pf2e-monster-sheet-sharing__rk-option pf2e-monster-sheet-sharing__rk-option--wide" role="button" tabindex="0">
      <input type="hidden" name="choice" value="${OTHER_RECALL_KNOWLEDGE_CHOICE_ID}" data-count="0" data-max="1" disabled />
      <span class="pf2e-monster-sheet-sharing__rk-option-label">${escapeHtml(otherLabel)}</span>
    </div>
  `;

  const reasonRapidlyToggle = actorHasReasonRapidly
    ? `
      <label class="pf2e-monster-sheet-sharing__rk-toggle">
        <input type="checkbox" name="reason-rapidly" />
        <span class="pf2e-monster-sheet-sharing__rk-option-label">${escapeHtml(game.i18n.localize(`${MODULE_ID}.recallKnowledge.reasonRapidlyLabel`))}</span>
      </label>
    `
    : '';

  return `
    <div class="pf2e-monster-sheet-sharing__rk-form" data-choice-limit="${choiceCount}">
      <p>${escapeHtml(game.i18n.localize(`${MODULE_ID}.recallKnowledge.prompt`))}</p>
      <div class="pf2e-monster-sheet-sharing__rk-count">
        ${escapeHtml(game.i18n.format(`${MODULE_ID}.recallKnowledge.choiceCount`, { count: choiceCount }))}
        <span class="pf2e-monster-sheet-sharing__rk-remaining"></span>
      </div>
      ${reasonRapidlyToggle}
      <div class="pf2e-monster-sheet-sharing__rk-option-grid">${optionButtons}${otherButton}</div>
    </div>
  `;
}

function initializeRecallKnowledgeDialog(element: HTMLElement | null): void {
  const form = element?.querySelector<HTMLElement>('.pf2e-monster-sheet-sharing__rk-form') ?? document.querySelector<HTMLElement>('.pf2e-monster-sheet-sharing__rk-form');
  if (!form) return;

  const limit = Number(form.dataset.choiceLimit ?? '1');
  const counter = form.querySelector<HTMLElement>('.pf2e-monster-sheet-sharing__rk-remaining');
  const choiceInputs = Array.from(form.querySelectorAll<HTMLInputElement>('.pf2e-monster-sheet-sharing__rk-option input[name="choice"]'));
  const reasonRapidlyToggle = form.querySelector<HTMLInputElement>('input[name="reason-rapidly"]');

  function getEffectiveLimit(): number {
    return reasonRapidlyToggle?.checked ? 1 : limit;
  }

  function getChoiceCount(input: HTMLInputElement): number {
    return Math.max(Number(input.dataset.count ?? '0'), 0);
  }

  function getChoiceMax(input: HTMLInputElement): number {
    return Math.max(Number(input.dataset.max ?? '1'), 0);
  }

  function getSelectedCount(): number {
    return choiceInputs.reduce((total, input) => total + getChoiceCount(input), 0);
  }

  function setChoiceCount(input: HTMLInputElement, count: number): void {
    const max = getChoiceMax(input);
    input.dataset.count = String(Math.min(Math.max(count, 0), max));
  }

  function updateCounter(): void {
    const selectedCount = getSelectedCount();
    const remaining = Math.max(getEffectiveLimit() - selectedCount, 0);
    if (counter) {
      counter.textContent = game.i18n.format(`${MODULE_ID}.recallKnowledge.remaining`, { count: remaining });
    }
  }

  function updateChoiceStates(): void {
    const selectedCount = getSelectedCount();
    const effectiveLimit = getEffectiveLimit();
    const atLimit = selectedCount >= effectiveLimit;
    choiceInputs.forEach(input => {
      const option = input.closest<HTMLElement>('.pf2e-monster-sheet-sharing__rk-option');
      const count = getChoiceCount(input);
      const max = getChoiceMax(input);
      const canAdd = max > 0 && count < max && !atLimit;
      const canRemove = count > 0;
      const countLabel = option?.querySelector<HTMLElement>('[data-count-label]');
      const increaseButton = option?.querySelector<HTMLButtonElement>('[data-count-action="increase"]');
      const decreaseButton = option?.querySelector<HTMLButtonElement>('[data-count-action="decrease"]');

      input.disabled = count <= 0;

      if (countLabel) {
        countLabel.textContent = String(count);
        countLabel.hidden = count <= 0;
      }

      if (increaseButton) increaseButton.disabled = !canAdd;
      if (decreaseButton) decreaseButton.disabled = !canRemove;

      if (option) {
        option.classList.toggle('pf2e-monster-sheet-sharing__rk-option--disabled', max <= 0);
        option.classList.toggle('pf2e-monster-sheet-sharing__rk-option--selected', count > 0);
        option.classList.toggle('pf2e-monster-sheet-sharing__rk-option--capped', max > 0 && count <= 0 && atLimit);
        option.tabIndex = max <= 0 ? -1 : 0;
      }
    });

    reasonRapidlyToggle?.closest('.pf2e-monster-sheet-sharing__rk-toggle')?.classList.toggle('pf2e-monster-sheet-sharing__rk-option--selected', reasonRapidlyToggle.checked);
  }

  function trimSelections(): void {
    const effectiveLimit = getEffectiveLimit();
    let selectedCount = getSelectedCount();
    if (selectedCount <= effectiveLimit) return;

    for (const input of [...choiceInputs].reverse()) {
      if (selectedCount <= effectiveLimit) break;

      const count = getChoiceCount(input);
      const reduction = Math.min(count, selectedCount - effectiveLimit);
      setChoiceCount(input, count - reduction);
      selectedCount -= reduction;
    }
  }

  function changeChoiceCount(input: HTMLInputElement, direction: 1 | -1): void {
    const count = getChoiceCount(input);
    const max = getChoiceMax(input);
    if (max <= 0) return;

    if (direction > 0 && (count >= max || getSelectedCount() >= getEffectiveLimit())) return;
    if (direction < 0 && count <= 0) return;

    setChoiceCount(input, count + direction);
    updateCounter();
    updateChoiceStates();
  }

  function getChoiceInput(target: EventTarget | null): HTMLInputElement | null {
    return target instanceof HTMLElement
      ? target.closest<HTMLElement>('.pf2e-monster-sheet-sharing__rk-option')?.querySelector<HTMLInputElement>('input[name="choice"]') ?? null
      : null;
  }

  function onClick(event: MouseEvent): void {
    const actionButton = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('[data-count-action]') : null;
    const input = getChoiceInput(event.target);
    if (!input) return;

    if (actionButton?.dataset.countAction === 'decrease') {
      changeChoiceCount(input, -1);
      return;
    }

    if (actionButton?.dataset.countAction === 'increase') {
      changeChoiceCount(input, 1);
      return;
    }

    const count = getChoiceCount(input);
    changeChoiceCount(input, getChoiceMax(input) <= 1 && count > 0 ? -1 : 1);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target instanceof HTMLElement && event.target.closest('[data-count-action]')) return;

    const input = getChoiceInput(event.target);
    if (!input) return;

    event.preventDefault();
    const count = getChoiceCount(input);
    changeChoiceCount(input, getChoiceMax(input) <= 1 && count > 0 ? -1 : 1);
  }

  function onChange(): void {
    trimSelections();
    updateCounter();
    updateChoiceStates();
  }

  form.addEventListener('click', onClick);
  form.addEventListener('keydown', onKeydown);
  form.addEventListener('change', onChange);
  onChange();
}

function getCheckRoll(message: ChatMessage): RollWithCheckOptions | null {
  for (const roll of message.rolls) {
    const candidate = roll as RollWithCheckOptions;
    if ('degreeOfSuccess' in candidate || typeof candidate.options?.degreeOfSuccess === 'number') return candidate;
  }
  return null;
}

function getRecallKnowledgeTarget(message: ChatMessage): { actor: Actor; tokenUuid?: string } | null {
  const messageTarget = (message as RecallKnowledgeMessage).target;
  if (messageTarget?.actor) {
    return {
      actor: messageTarget.actor,
      tokenUuid: messageTarget.token?.uuid,
    };
  }

  if (game.user.targets.size !== 1) return null;

  const target = Array.from(game.user.targets)[0];
  const actor = target?.actor;
  if (!actor) return null;

  return {
    actor,
    tokenUuid: target.document.uuid,
  };
}

function getRecallKnowledgeActor(message: ChatMessage): Actor | null {
  const pf2eMessage = message as RecallKnowledgeMessage;
  const messageActor = pf2eMessage.speakerActor ?? pf2eMessage.actor ?? pf2eMessage.token?.actor ?? null;
  if (messageActor instanceof Actor) return messageActor;

  const speakerActor = getSpeakerActor(message.speaker);
  if (speakerActor) return speakerActor;

  const speakerActorId = message.speaker?.actor;
  if (speakerActorId) {
    const actor = speakerActorId.includes('.') ? fromUuidSync(speakerActorId) : game.actors.get(speakerActorId);
    if (actor instanceof Actor) return actor;
  }

  return game.user.character ?? null;
}

function isRecallKnowledgeLoreSkill(message: ChatMessage): boolean {
  const context = foundry.utils.getProperty(message.flags, 'pf2e.context') as RecallKnowledgeContext | undefined;
  const markers = [context?.identifier, context?.slug, context?.title, context?.type, context?.action, ...(context?.options ?? [])].filter((value): value is string => typeof value === 'string');

  return markers.some(marker => normalizeText(marker).includes('lore'));
}

function getRecallKnowledgeLoreRank(message: ChatMessage): number | undefined {
  const context = foundry.utils.getProperty(message.flags, 'pf2e.context') as RecallKnowledgeContext | undefined;
  const identifier = [context?.identifier, context?.slug, context?.title, context?.type].find((value): value is string => typeof value === 'string');
  if (!identifier) return undefined;

  const actor = getRecallKnowledgeActor(message);
  if (!actor) return undefined;

  const skills = foundry.utils.getProperty(actor, 'system.skills') as Record<string, unknown> | undefined;
  const rank = findSkillRank(skills, normalizeText(identifier));
  return typeof rank === 'number' ? rank : undefined;
}

function findSkillRank(value: unknown, identifier: string): number | undefined {
  if (!value || typeof value !== 'object') return undefined;

  if (Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = normalizeText(key);
    if (normalizedKey === identifier || normalizedKey.includes(identifier) || identifier.includes(normalizedKey)) {
      const rank = getSkillRank(entry);
      if (typeof rank === 'number') return rank;
    }

    const nested = findSkillRank(entry, identifier);
    if (typeof nested === 'number') return nested;
  }

  return undefined;
}

function getSkillRank(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.rank === 'number') return record.rank;
  if (record.system && typeof (record.system as Record<string, unknown>).rank === 'number') {
    return (record.system as Record<string, unknown>).rank as number;
  }
  return undefined;
}

function hasFeat(actor: Actor | null | undefined, slug: string): boolean {
  const normalizedSlug = normalizeText(slug);
  if (getActorRollOptions(actor).some(option => normalizeText(option) === `selffeat${normalizedSlug}` || normalizeText(option).endsWith(`feat${normalizedSlug}`))) return true;

  return getActorItems(actor).some(item => {
    const itemSlug = normalizeText(getItemString(item, 'slug') ?? getItemString(item, 'system.slug') ?? getItemString(item, 'name') ?? '');
    const itemName = normalizeText(getItemString(item, 'name') ?? '');
    return itemSlug === normalizedSlug || itemName === normalizedSlug;
  });
}

function getSpeakerActor(speaker: foundry.documents.ChatSpeakerData | undefined): Actor | null {
  if (!speaker) return null;

  const ChatMessageClass = CONFIG.ChatMessage.documentClass as unknown as typeof ChatMessage & {
    getSpeakerActor?: (speaker: foundry.documents.ChatSpeakerData) => Actor | null;
  };
  const actor = ChatMessageClass.getSpeakerActor?.(speaker);
  return actor instanceof Actor ? actor : null;
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

function isRecallKnowledgeMessage(message: ChatMessage, roll: RollWithCheckOptions | null): boolean {
  const context = foundry.utils.getProperty(message.flags, 'pf2e.context') as RecallKnowledgeContext | undefined;
  const item = (message as RecallKnowledgeMessage).item;
  const markers = [context?.action, context?.identifier, context?.slug, context?.title, context?.type, item?.name, item?.slug, roll?.options?.action, roll?.options?.identifier, roll?.options?.slug, ...(context?.domains ?? []), ...(context?.options ?? []), ...(roll?.options?.domains ?? [])].filter((value): value is string => typeof value === 'string');

  if (markers.some(marker => normalizeText(marker).includes('recallknowledge'))) return true;

  return normalizeText(stripHtml(message.content)).includes('recallknowledge');
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripHtml(value: string): string {
  const element = document.createElement('div');
  element.innerHTML = value;
  return element.textContent ?? '';
}

async function waitForDiceSoNice(message: ChatMessage): Promise<void> {
  if (!game.modules.get('dice-so-nice')?.active || !message.id) return;

  const dice3d = (game as unknown as { dice3d?: DiceSoNiceApi }).dice3d;
  if (typeof dice3d?.waitFor3DAnimationByMessageID === 'function') {
    await withTimeout(dice3d.waitFor3DAnimationByMessageID(message.id), DICE_SO_NICE_TIMEOUT_MS).catch(() => undefined);
    return;
  }

  await waitForDiceSoNiceHook(message.id);
}

async function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  await Promise.race([
    promise,
    new Promise<void>(resolve => {
      timeout = globalThis.setTimeout(resolve, timeoutMs);
    }),
  ]);

  if (timeout !== undefined) globalThis.clearTimeout(timeout);
}

async function waitForDiceSoNiceHook(messageId: string): Promise<void> {
  const hooks = Hooks as unknown as HookControls;
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;

  await new Promise<void>(resolve => {
    const cleanup = () => {
      hooks.off('diceSoNiceRollComplete', onComplete);
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      resolve();
    };
    const onComplete = (completedMessageId: unknown) => {
      if (completedMessageId === messageId) cleanup();
    };

    timeout = globalThis.setTimeout(cleanup, DICE_SO_NICE_TIMEOUT_MS);
    hooks.on('diceSoNiceRollComplete', onComplete);
  });
}

function escapeHtml(value: string): string {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function localizeWithFallback(key: string, fallback: string): string {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}
