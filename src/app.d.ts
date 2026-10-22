declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<Record<string, unknown>>;
  export default component;
}

declare global {
  var MonsterShare: import('@/services/monsterShare').MonsterShareApi | undefined;
}
