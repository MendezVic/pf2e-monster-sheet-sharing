import './styles.css';
import { MODULE_ID } from './constants';
import { registerChatLinkHooks } from '@/hooks/chatLinks';
import { registerNpcSheetButtonHooks } from '@/hooks/npcSheetButton';
import { registerRecallKnowledgeHooks } from '@/hooks/recallKnowledge';
import { createMonsterShareApi, registerMonsterShare, registerMonsterShareSettings } from '@/services/monsterShare';
import { applyRecallKnowledgePrivacySetting } from '@/services/recallKnowledgePrivacy';
import { registerSocket } from '@/services/socket';

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | init`);
  registerMonsterShareSettings();
  registerChatLinkHooks();
  registerNpcSheetButtonHooks();
  registerRecallKnowledgeHooks();
});

Hooks.once('ready', () => {
  registerSocket();
  registerMonsterShare();
  applyRecallKnowledgePrivacySetting();

  const module = game.modules.get(MODULE_ID);
  const version = module?.version ?? '0.0.0';
  const api = createMonsterShareApi(version);
  // `api` is the Foundry convention for a public API, but isn't a typed field on Module.
  if (module) (module as { api?: typeof api }).api = api;
  (globalThis as { MonsterShare?: typeof api }).MonsterShare = api;
  console.log(`${MODULE_ID} | ready (v${version})`);
});
