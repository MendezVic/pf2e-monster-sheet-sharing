import { describe, expect, it, vi } from 'vitest';

import { createRecallKnowledgeFilter, getRecallKnowledgeChoiceViews, getRecallKnowledgeDiscoveryChoiceCount } from '@/services/recallKnowledgeChoices';

vi.stubGlobal('foundry', {
  utils: {
    deepClone: structuredClone,
    getProperty: (source: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((value, segment) => {
      return value && typeof value === 'object' && segment in value ? (value as Record<string, unknown>)[segment] : undefined;
    }, source),
  },
});

vi.stubGlobal('game', {
  i18n: {
    lang: 'en',
    localize: (key: string) => key,
  },
});

function createActor(items: Array<{ name?: string; slug?: string }> = [], source: Record<string, unknown> = {}): Actor {
  return {
    items,
    toObject: () => ({ items, ...source }),
  } as unknown as Actor;
}

describe('getRecallKnowledgeDiscoveryChoiceCount', () => {
  it('returns one choice for a successful recall knowledge roll', () => {
    expect(getRecallKnowledgeDiscoveryChoiceCount(null, 2)).toBe(1);
  });

  it('returns two choices for a critical success', () => {
    expect(getRecallKnowledgeDiscoveryChoiceCount(null, 3)).toBe(2);
  });

  it('returns zero when the roll did not succeed', () => {
    expect(getRecallKnowledgeDiscoveryChoiceCount(null, 1)).toBe(0);
  });

  it('adds one choice for Unmistakable Lore when using a master lore skill', () => {
    expect(getRecallKnowledgeDiscoveryChoiceCount(createActor([{ name: 'Unmistakable Lore', slug: 'unmistakable-lore' }]), 2, { isLoreSkill: true, loreRank: 3 })).toBe(2);
  });

  it('adds one choice for Thorough Research on a success and two on a critical success', () => {
    expect(getRecallKnowledgeDiscoveryChoiceCount(createActor([{ name: 'Thorough Research', slug: 'thorough-research' }]), 2)).toBe(2);
    expect(getRecallKnowledgeDiscoveryChoiceCount(createActor([{ name: 'Thorough Research', slug: 'thorough-research' }]), 3)).toBe(4);
  });

  it('forces a single selection when Reason Rapidly is chosen', () => {
    expect(getRecallKnowledgeDiscoveryChoiceCount(createActor([{ name: 'Reason Rapidly', slug: 'reason-rapidly' }]), 3, { useReasonRapidly: true })).toBe(1);
  });

  it('tracks remaining discoveries for repeatable list choices', () => {
    const actor = createActor([], {
      system: {
        attributes: {
          weaknesses: [{ type: 'fire' }, { type: 'cold' }, { type: 'vitality' }],
        },
      },
    });

    const weakness = getRecallKnowledgeChoiceViews(actor, ['weakness']).find(choice => choice.id === 'weakness');

    expect(weakness).toMatchObject({ disabled: false, remaining: 2 });
  });

  it('reveals one list entry for each duplicate choice', () => {
    const source = {
      system: {
        attributes: {
          weaknesses: [{ type: 'fire' }, { type: 'cold' }, { type: 'vitality' }],
        },
      },
    };

    createRecallKnowledgeFilter(['weakness', 'weakness'])(source, { level: 'full' });

    expect(source.system.attributes.weaknesses).toEqual([{ type: 'fire' }, { type: 'cold' }]);
  });
});
