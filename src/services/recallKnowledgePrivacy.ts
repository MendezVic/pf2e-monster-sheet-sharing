import { MODULE_ID } from '@/constants';

export const RECALL_KNOWLEDGE_PRIVATE_SETTING = 'recallKnowledgePrivate';

let originalRecallKnowledgeTraits: string[] | null = null;

export function registerRecallKnowledgePrivacySetting(): void {
  game.settings.register(MODULE_ID, RECALL_KNOWLEDGE_PRIVATE_SETTING, {
    name: `${MODULE_ID}.settings.recallKnowledgePrivate.name`,
    hint: `${MODULE_ID}.settings.recallKnowledgePrivate.hint`,
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => applyRecallKnowledgePrivacySetting(),
  });
}

export function applyRecallKnowledgePrivacySetting(): void {
  const action = getRecallKnowledgeAction();
  if (!action) return;

  originalRecallKnowledgeTraits ??= [...action.traits];

  const privateRecallKnowledge = game.settings.get(MODULE_ID, RECALL_KNOWLEDGE_PRIVATE_SETTING) !== false;
  const traits = privateRecallKnowledge ? restoreSecretTrait(action.traits) : action.traits.filter(trait => trait !== 'secret');

  action.traits = traits;
}

function restoreSecretTrait(currentTraits: string[]): string[] {
  const traits = [...currentTraits];
  if (originalRecallKnowledgeTraits?.includes('secret') && !traits.includes('secret')) {
    traits.push('secret');
  }
  return traits;
}

function getRecallKnowledgeAction(): { traits: string[] } | null {
  const actions = game.pf2e?.actions as unknown as { get?: (slug: string) => unknown } | undefined;
  const action = actions?.get?.('recall-knowledge');

  return action && typeof action === 'object' && Array.isArray((action as { traits?: unknown }).traits)
    ? (action as { traits: string[] })
    : null;
}
