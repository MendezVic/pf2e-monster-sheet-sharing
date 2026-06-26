import { describe, expect, it, vi } from 'vitest';
import { sanitizeActorData } from '@/services/sanitize';

vi.stubGlobal('foundry', {
  utils: {
    deepClone: structuredClone,
  },
});

describe('sanitizeActorData', () => {
  it('strips world identity and marks the shared actor temporary', () => {
    const actor = sanitizeActorData({
      _id: 'abc',
      name: 'Assassin Vine',
      type: 'npc',
      ownership: { default: 3 },
      folder: 'secret-folder',
      prototypeToken: { actorId: 'abc', actorLink: true },
    }, { level: 'full' });

    expect(actor).not.toHaveProperty('_id');
    expect(actor).not.toHaveProperty('ownership');
    expect(actor).not.toHaveProperty('folder');
    expect(actor.prototypeToken).toEqual({});
    expect(actor.flags).toEqual({ 'pf2e-monster-sheet-sharing': { temporary: true } });
  });

  it('removes mechanical combat data from public shares', () => {
    const actor = sanitizeActorData({
      name: 'Assassin Vine',
      type: 'npc',
      system: {
        attributes: {
          hp: { value: 60, max: 60 },
          ac: { value: 20 },
        },
        saves: { fortitude: { value: 14 } },
        details: { publicNotes: 'Plant ambusher' },
      },
      items: [
        { name: 'Vine', type: 'melee' },
        { name: 'Constrict', type: 'action', system: {} },
        { name: 'Secret Root', type: 'action', system: { visibility: 'gm' } },
      ],
    }, { level: 'public' });

    expect(actor.system).toEqual({ attributes: {}, details: { publicNotes: 'Plant ambusher' } });
    expect(actor.items).toEqual([{ name: 'Constrict', type: 'action', system: {} }]);
  });

  it('allows a custom filter to replace the sanitized data', () => {
    const actor = sanitizeActorData({ name: 'Original', type: 'npc' }, { level: 'full' }, () => ({
      name: 'Filtered',
      type: 'npc',
    }));

    expect(actor).toEqual({ name: 'Filtered', type: 'npc' });
  });
});
