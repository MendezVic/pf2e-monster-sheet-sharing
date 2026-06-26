import { MODULE_ID } from '@/constants';
import { shareMonsterSheet } from '@/services/monsterShare';

interface ActorSheetLike {
  actor?: Actor;
}

type HookHtml = HTMLElement | JQuery<HTMLElement> | HTMLElement[];

export function registerNpcSheetButtonHooks(): void {
  Hooks.on('renderActorSheet', (app: ActorSheetLike, html: HookHtml) => {
    const actor = app.actor;
    if (!game.user.isGM || actor?.type !== 'npc') return;

    const root = normalizeHtml(html);
    if (!root || root.querySelector('[data-action="pf2e-monster-share"]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pf2e-monster-sheet-sharing__sheet-button';
    button.dataset.action = 'pf2e-monster-share';
    button.innerHTML = `<i class="fas fa-share-nodes"></i><span>${game.i18n.localize(`${MODULE_ID}.buttons.shareSheet`)}</span>`;
    button.addEventListener('click', () => {
      void shareMonsterSheet(actor).then(() => {
        ui.notifications.info(game.i18n.format(`${MODULE_ID}.notifications.shared`, { name: actor.name }));
      }).catch((error) => {
        ui.notifications.error(error instanceof Error ? error.message : game.i18n.localize(`${MODULE_ID}.errors.shareFailed`));
      });
    });

    const target = root.querySelector('.window-content') ?? root;
    target.prepend(button);
  });
}

function normalizeHtml(html: HookHtml): HTMLElement | null {
  if (html instanceof HTMLElement) return html;
  if (Array.isArray(html)) return html[0] ?? null;
  return html[0] ?? null;
}
