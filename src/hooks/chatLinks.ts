import { LINK_DATA_ATTRIBUTE, MODULE_ID } from '@/constants';
import { openSharedMonsterSheet } from '@/services/monsterShare';

export function registerChatLinkHooks(): void {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const link = target.closest<HTMLElement>(`[${LINK_DATA_ATTRIBUTE}]`);
    if (!link) return;

    event.preventDefault();
    event.stopPropagation();

    const shareId = link.getAttribute(LINK_DATA_ATTRIBUTE);
    if (!shareId) return;

    void openSharedMonsterSheet(shareId).catch((error) => {
      ui.notifications.error(error instanceof Error ? error.message : game.i18n.localize(`${MODULE_ID}.errors.openFailed`));
    });
  });
}
