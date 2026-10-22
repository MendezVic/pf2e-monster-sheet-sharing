import { MODULE_ID, SOURCE_ACTOR_UUID_FLAG } from '@/constants';
import { requestDiscoveredMonsterShare, shareDiscoveredMonsterSheet, shareMonsterSheet } from '@/services/monsterShare';

interface ActorSheetLike {
  actor?: Actor;
}

type HookHtml = HTMLElement | HTMLElement[] | { 0?: HTMLElement };

export function registerNpcSheetButtonHooks(): void {
  const addButton = (app: ActorSheetLike, html: HookHtml) => {
    addShareButton(app, html);
  };

  Hooks.on('renderActorSheet', addButton);
  Hooks.on('renderNPCSheetPF2e', addButton);
  Hooks.on('renderSimpleNPCSheet', addButton);
}

function addShareButton(app: ActorSheetLike, html: HookHtml): void {
  const actor = app.actor;
  if (actor?.type !== 'npc') return;

  const root = normalizeHtml(html);
  if (!root) return;

  const sheetElement = root.closest<HTMLElement>('.app, .window-app, .application') ?? root;
  if (sheetElement.querySelector('[data-action="pf2e-monster-share"]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pf2e-monster-sheet-sharing__sheet-button';
  button.dataset.action = 'pf2e-monster-share';
  button.ariaLabel = game.i18n.localize(`${MODULE_ID}.buttons.shareSheet`);
  button.title = game.i18n.localize(`${MODULE_ID}.buttons.shareSheet`);
  button.innerHTML = '<i class="fas fa-share-nodes"></i>';
  button.addEventListener('click', (event) => {
    const share = game.user.isGM
      ? event.shiftKey ? shareMonsterSheet(actor) : shareDiscoveredMonsterSheet(actor)
      : requestDiscoveredMonsterShare(getShareActorUuid(actor));

    void share.then(() => {
      ui.notifications.info(game.i18n.format(`${MODULE_ID}.notifications.shared`, { name: actor.name }));
    }).catch((error) => {
      ui.notifications.error(error instanceof Error ? error.message : game.i18n.localize(`${MODULE_ID}.errors.shareFailed`));
    });
  });

  const headerTarget = sheetElement.querySelector<HTMLElement>('.window-title') ?? sheetElement.querySelector<HTMLElement>('.window-header');
  headerTarget?.append(button);
}

function getShareActorUuid(actor: Actor): string {
  const sourceActorUuid = actor.getFlag(MODULE_ID, SOURCE_ACTOR_UUID_FLAG);
  if (typeof sourceActorUuid === 'string' && sourceActorUuid.length > 0) return sourceActorUuid;
  return actor.uuid;
}

function normalizeHtml(html: HookHtml): HTMLElement | null {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  return html[0] ?? null;
}
