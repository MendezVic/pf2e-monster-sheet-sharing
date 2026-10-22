import { describe, expect, it, vi } from 'vitest';

import { createDiscoveredMonsterData } from '@/services/discoveredMonster';

vi.stubGlobal('foundry', {
  utils: {
    getProperty: (source: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((value, segment) => {
      return value && typeof value === 'object' && segment in value ? (value as Record<string, unknown>)[segment] : undefined;
    }, source),
    cleanHTML: (value: string) => value,
  },
});

vi.stubGlobal('game', {
  i18n: {
    localize: (key: string) => key,
  },
});

function createNpcActor(system: Record<string, unknown>): Actor {
  return {
    name: 'Test Creature',
    uuid: 'Actor.test',
    toObject: () => ({ name: 'Test Creature', items: [] }),
    system,
  } as unknown as Actor;
}

describe('createDiscoveredMonsterData', () => {
  it('shows current and maximum HP on the discovered monster sheet', () => {
    const actor = createNpcActor({
      attributes: {
        hp: { value: 35, max: 60 },
      },
    });

    const data = createDiscoveredMonsterData(actor, ['hp']);

    expect(data.sections.find(section => section.id === 'hp')?.rows).toEqual([{ label: 'HP', value: '35/60' }]);
  });

  it('splits resistance and weakness entries into label and value columns', () => {
    const actor = createNpcActor({
      attributes: {
        resistances: [{ label: 'acid 10', type: 'acid', value: 10 }],
        weaknesses: [{ label: 'fire 10', type: 'fire', value: 10 }],
      },
    });

    const data = createDiscoveredMonsterData(actor, ['resistance', 'weakness']);

    expect(data.sections.find(section => section.id === 'resistance')?.rows).toEqual([{ label: 'acid', value: '10' }]);
    expect(data.sections.find(section => section.id === 'weakness')?.rows).toEqual([{ label: 'fire', value: '10' }]);
  });

  it('formats raw resistance and weakness entries when labels are absent', () => {
    const actor = createNpcActor({
      attributes: {
        resistances: [{ type: 'cold', value: 5 }],
        weaknesses: [{ type: 'vitality', value: 8 }],
      },
    });

    const data = createDiscoveredMonsterData(actor, ['resistance', 'weakness']);

    expect(data.sections.find(section => section.id === 'resistance')?.rows).toEqual([{ label: 'cold', value: '5' }]);
    expect(data.sections.find(section => section.id === 'weakness')?.rows).toEqual([{ label: 'vitality', value: '8' }]);
  });

  it('pairs immunities across both columns', () => {
    const actor = createNpcActor({
      attributes: {
        immunities: [{ label: 'mental', type: 'mental' }, { label: 'acid', type: 'acid' }],
      },
    });

    const data = createDiscoveredMonsterData(actor, ['immunity', 'immunity']);

    expect(data.sections.find(section => section.id === 'immunity')?.rows).toEqual([{ label: 'mental', value: 'acid' }]);
  });

  it('wraps immunities onto additional rows when there are more than two', () => {
    const actor = createNpcActor({
      attributes: {
        immunities: [
          { type: 'mental' },
          { type: 'acid' },
          { type: 'fire' },
        ],
      },
    });

    const data = createDiscoveredMonsterData(actor, ['immunity', 'immunity', 'immunity']);

    expect(data.sections.find(section => section.id === 'immunity')?.rows).toEqual([
      { label: 'mental', value: 'acid' },
      { label: 'fire', value: '' },
    ]);
  });
});
