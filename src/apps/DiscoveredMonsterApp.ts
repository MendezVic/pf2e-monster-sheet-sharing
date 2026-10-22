import { MODULE_ID } from '@/constants';
import { DiscoveredMonsterData, DiscoveredMonsterSection, isDiscoveredMonsterData } from '@/services/discoveredMonster';
import { getRecallKnowledgeChoiceViews, type RecallKnowledgeChoiceId } from '@/services/recallKnowledgeChoices';
import { requestDiscoveredMonsterShare, setRecallKnowledgeDiscoveryCount, shareDiscoveredMonsterSheet } from '@/services/monsterShare';

const { ApplicationV2 } = foundry.applications.api;
const openDiscoveredApps = new Map<string, DiscoveredMonsterApp>();

export class DiscoveredMonsterApp extends ApplicationV2 {
  static override DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-discovered-monster`,
    classes: ['pf2e', MODULE_ID, 'pf2e-monster-sheet-sharing__discovered-app'],
    window: {
      title: 'Discovered Monster Info',
      icon: 'fa-solid fa-eye',
      resizable: true,
    },
    position: {
      width: 860,
      height: 'auto' as const,
    },
  };

  #data: DiscoveredMonsterData;
  #appKey: string;
  #activeTab: string | null = null;

  constructor(data: unknown) {
    if (!isDiscoveredMonsterData(data)) {
      throw new Error(game.i18n.localize(`${MODULE_ID}.errors.discoveredUnavailable`));
    }

    super({
      id: `${MODULE_ID}-discovered-${foundry.utils.randomID()}`,
      window: { title: data.name || game.i18n.localize(`${MODULE_ID}.discovered.title`) },
    });
    this.#data = data;
    this.#appKey = getDiscoveredAppKey(data);
  }

  static open(data: unknown): DiscoveredMonsterApp {
    if (!isDiscoveredMonsterData(data)) {
      throw new Error(game.i18n.localize(`${MODULE_ID}.errors.discoveredUnavailable`));
    }

    const appKey = getDiscoveredAppKey(data);
    const existing = openDiscoveredApps.get(appKey);
    if (existing) {
      void existing.updateData(data);
      return existing;
    }

    const app = new DiscoveredMonsterApp(data);
    openDiscoveredApps.set(appKey, app);
    void app.render({ force: true });
    return app;
  }

  static updateOpen(data: DiscoveredMonsterData): void {
    const existing = openDiscoveredApps.get(getDiscoveredAppKey(data));
    if (existing) void existing.updateData(data, { bringToFront: false });
  }

  async updateData(data: DiscoveredMonsterData, options: { bringToFront?: boolean } = {}): Promise<void> {
    this.#data = data;
    await this.render({ force: true });
    if (options.bringToFront ?? true) this.bringToFront();
  }

  protected override async _renderHTML(): Promise<HTMLElement> {
    const root = document.createElement('section');
    root.className = 'pf2e-monster-sheet-sharing__discovered';

    if (this.#data.sections.length === 0) {
      root.append(this.#renderSidebar([]));

      const main = document.createElement('main');
      main.className = 'pf2e-monster-sheet-sharing__discovered-main';
      main.append(this.#renderMainHeader());
      const gmControls = await this.#renderGmRevealControls();
      if (gmControls) main.append(gmControls);

      const empty = document.createElement('p');
      empty.className = 'pf2e-monster-sheet-sharing__empty';
      empty.textContent = game.i18n.localize(`${MODULE_ID}.discovered.empty`);
      main.append(empty);

      root.append(main);
      return root;
    }

    const rowSections = this.#data.sections.filter(section => section.rows.length > 0);
    const itemSections = this.#data.sections.filter(section => section.items.length > 0);
    const sidebarSections = groupSavesSections(rowSections.filter(section => SIDEBAR_SECTION_IDS.has(section.id)));
    const mainRowSections = rowSections.filter(section => !SIDEBAR_SECTION_IDS.has(section.id));
    root.append(this.#renderSidebar(sidebarSections));

    const main = document.createElement('main');
    main.className = 'pf2e-monster-sheet-sharing__discovered-main';
    main.append(this.#renderMainHeader());
    const gmControls = await this.#renderGmRevealControls();
    if (gmControls) main.append(gmControls);

    if (itemSections.length > 0) {
      main.append(await this.#renderTabbedSections(mainRowSections, orderItemSections(itemSections)));
    } else {
      for (const section of mainRowSections) {
        main.append(await this.#renderSection(section));
      }
    }

    root.append(main);

    return root;
  }

  protected override _replaceHTML(result: HTMLElement, content: HTMLElement): void {
    content.replaceChildren(result);
  }

  protected override async _onRender(context: object, options: unknown): Promise<void> {
    await super._onRender(context, options as never);
    this.#renderShareHeaderButton(this.element);
  }

  protected override _onClose(options: unknown): void {
    openDiscoveredApps.delete(this.#appKey);
    super._onClose(options as never);
  }

  #renderSidebar(sections: DiscoveredMonsterSection[]): HTMLElement {
    const sidebar = document.createElement('aside');
    sidebar.className = 'pf2e-monster-sheet-sharing__discovered-sidebar';

    if (this.#data.image) {
      const image = document.createElement('img');
      image.className = 'pf2e-monster-sheet-sharing__portrait';
      image.src = this.#data.image;
      image.alt = this.#data.name;
      sidebar.append(image);
    }

    for (const section of sections) {
      sidebar.append(this.#renderRowsSection(section, true));
    }

    return sidebar;
  }

  #renderMainHeader(): HTMLElement {
    const header = document.createElement('header');
    header.className = 'pf2e-monster-sheet-sharing__discovered-main-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'pf2e-monster-sheet-sharing__title-group';

    const title = document.createElement('h1');
    title.textContent = this.#data.name;
    titleGroup.append(title);

    const meta = document.createElement('div');
    meta.className = 'pf2e-monster-sheet-sharing__title-meta';

    const subtitle = document.createElement('p');
    subtitle.textContent = game.i18n.localize(`${MODULE_ID}.discovered.subtitle`);
    meta.append(subtitle);

    const traits = this.#findRowValue('Traits');
    if (traits) {
      meta.append(renderTraitList(traits));
    }

    titleGroup.append(meta);
    header.append(titleGroup);

    const level = this.#findRowValue('Level');
    if (level) {
      const headerActions = document.createElement('div');
      headerActions.className = 'pf2e-monster-sheet-sharing__discovered-header-actions';

      const badge = document.createElement('div');
      badge.className = 'pf2e-monster-sheet-sharing__creature-badge';
      const label = document.createElement('span');
      label.textContent = localizeWithFallback(`${MODULE_ID}.discovered.creature`, 'Creature');
      const value = document.createElement('strong');
      value.textContent = level;
      badge.append(label, value);
      headerActions.append(badge);

      header.append(headerActions);
    }

    return header;
  }

  async #renderSection(section: DiscoveredMonsterSection): Promise<HTMLElement> {
    if (section.items.length === 0) return this.#renderRowsSection(section, false);

    const sectionElement = document.createElement('section');
    sectionElement.className = 'pf2e-monster-sheet-sharing__discovered-section';

    const title = document.createElement('h2');
    title.textContent = section.label;
    sectionElement.append(title);

    for (const item of section.items) {
      const article = document.createElement('details');
      article.className = 'pf2e-monster-sheet-sharing__discovered-item';

      const itemTitle = document.createElement('summary');
      itemTitle.textContent = item.name;
      article.append(itemTitle);

      if (item.description) {
        const description = document.createElement('div');
        description.className = 'pf2e-monster-sheet-sharing__item-description';
        description.innerHTML = await enrichDescription(item.description);
        article.append(description);
      }

      sectionElement.append(article);
    }

    return sectionElement;
  }

  async #renderTabbedSections(rowSections: DiscoveredMonsterSection[], itemSections: DiscoveredMonsterSection[]): Promise<HTMLElement> {
    const tabs = document.createElement('section');
    tabs.className = 'pf2e-monster-sheet-sharing__discovered-tabs';

    const tabList = document.createElement('nav');
    tabList.className = 'pf2e-monster-sheet-sharing__tab-list';
    tabList.setAttribute('aria-label', game.i18n.localize(`${MODULE_ID}.discovered.tabs.label`));

    const panels = document.createElement('div');
    panels.className = 'pf2e-monster-sheet-sharing__tab-panels';

    const hasOverview = rowSections.length > 0;
    const tabIds = [
      ...(hasOverview ? ['overview'] : []),
      ...itemSections.map(section => section.id),
    ];
    const activeTab = this.#activeTab && tabIds.includes(this.#activeTab)
      ? this.#activeTab
      : tabIds[0] ?? null;
    this.#activeTab = activeTab;

    if (hasOverview) {
      const overviewPanel = document.createElement('div');
      overviewPanel.className = 'pf2e-monster-sheet-sharing__tab-panel';
      overviewPanel.dataset.tabPanel = 'overview';
      for (const section of rowSections) {
        overviewPanel.append(this.#renderRowsSection(section, false));
      }
      overviewPanel.hidden = activeTab !== 'overview';
      panels.append(overviewPanel);
      tabList.append(createTabButton('overview', game.i18n.localize(`${MODULE_ID}.discovered.tabs.overview`), activeTab === 'overview'));
    }

    for (const section of itemSections) {
      const tabId = section.id;
      const active = activeTab === tabId;
      const panel = document.createElement('div');
      panel.className = 'pf2e-monster-sheet-sharing__tab-panel';
      panel.dataset.tabPanel = tabId;
      panel.hidden = !active;
      panel.append(await this.#renderSection(section));
      panels.append(panel);
      tabList.append(createTabButton(tabId, section.label, active));
    }

    tabList.addEventListener('click', event => {
      if (!(event.target instanceof HTMLElement)) return;
      const button = event.target.closest<HTMLButtonElement>('[data-tab]');
      if (!button) return;
      const activeTab = button.dataset.tab;
      if (!activeTab) return;
      this.#activeTab = activeTab;

      for (const tabButton of tabList.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
        const active = tabButton.dataset.tab === activeTab;
        tabButton.classList.toggle('pf2e-monster-sheet-sharing__tab-button--active', active);
        tabButton.setAttribute('aria-selected', String(active));
      }

      for (const panel of panels.querySelectorAll<HTMLElement>('[data-tab-panel]')) {
        panel.hidden = panel.dataset.tabPanel !== activeTab;
      }
    });

    tabs.append(tabList, panels);
    return tabs;
  }

  #renderRowsSection(section: DiscoveredMonsterSection, compact: boolean): HTMLElement {
    const sectionElement = document.createElement('section');
    sectionElement.className = compact ? 'pf2e-monster-sheet-sharing__discovered-section pf2e-monster-sheet-sharing__discovered-section--compact' : 'pf2e-monster-sheet-sharing__discovered-section';

    const title = document.createElement('h2');
    title.textContent = section.label;
    sectionElement.append(title);

    const dl = document.createElement('dl');
    for (const row of section.rows) {
      const dt = document.createElement('dt');
      dt.textContent = row.label;
      const dd = document.createElement('dd');
      if (row.label === 'Traits') {
        dd.append(renderTraitList(row.value, true));
      } else if (row.kind === 'size-scale') {
        dd.append(renderSizeScale(row.value));
      } else {
        dd.textContent = row.value;
      }
      dl.append(dt, dd);
    }
    sectionElement.append(dl);

    return sectionElement;
  }

  async #renderGmRevealControls(): Promise<HTMLElement | null> {
    if (!game.user.isGM || !this.#data.actorUuid) return null;

    const actor = await resolveActorFromUuid(this.#data.actorUuid);
    if (!actor || actor.type !== 'npc') return null;

    const currentCounts = countChoices(this.#data.choices);
    const controls = document.createElement('section');
    controls.className = 'pf2e-monster-sheet-sharing__gm-reveal-controls';

    const title = document.createElement('h2');
    title.textContent = localizeWithFallback(`${MODULE_ID}.discovered.gmControls`, 'GM Reveal Controls');
    controls.append(title);

    const list = document.createElement('div');
    list.className = 'pf2e-monster-sheet-sharing__gm-reveal-list';
    const maxCounts = new Map<RecallKnowledgeChoiceId, number>();

    for (const choice of getRecallKnowledgeChoiceViews(actor, []).filter(choice => choice.remaining > 0)) {
      const currentCount = currentCounts.get(choice.id) ?? 0;
      const maxCount = choice.remaining;
      maxCounts.set(choice.id, maxCount);

      const row = document.createElement('div');
      row.className = [
        'pf2e-monster-sheet-sharing__gm-reveal-row',
        maxCount > 1 ? 'pf2e-monster-sheet-sharing__gm-reveal-row--counted' : '',
        currentCount > 0 ? 'pf2e-monster-sheet-sharing__gm-reveal-row--revealed' : '',
      ].filter(Boolean).join(' ');

      const toggle = createIconButton(currentCount > 0 ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash', currentCount > 0 ? 'Hide' : 'Reveal');
      toggle.addEventListener('click', () => {
        void this.#setRevealCount(choice.id, currentCount > 0 ? 0 : maxCount);
      });

      const label = document.createElement('span');
      label.className = 'pf2e-monster-sheet-sharing__gm-reveal-label';
      label.textContent = choice.label;

      row.append(toggle, label);

      if (maxCount > 1) {
        const decrease = createIconButton('fa-solid fa-minus', 'Reveal less');
        decrease.disabled = currentCount <= 0;
        decrease.addEventListener('click', () => {
          void this.#setRevealCount(choice.id, currentCount - 1);
        });

        const count = document.createElement('span');
        count.className = 'pf2e-monster-sheet-sharing__gm-reveal-count';
        count.textContent = `${currentCount}/${maxCount}`;

        const increase = createIconButton('fa-solid fa-plus', 'Reveal more');
        increase.disabled = currentCount >= maxCount;
        increase.addEventListener('click', () => {
          void this.#setRevealCount(choice.id, currentCount + 1);
        });

        row.append(decrease, count, increase);
      }

      list.append(row);
    }

    controls.append(list);
    const strategicAssessment = this.#renderStrategicAssessmentControls(actor, currentCounts, maxCounts);
    if (strategicAssessment) controls.append(strategicAssessment);
    return controls;
  }

  #renderStrategicAssessmentControls(actor: Actor, currentCounts: Map<RecallKnowledgeChoiceId, number>, maxCounts: Map<RecallKnowledgeChoiceId, number>): HTMLElement | null {
    const options = getStrategicAssessmentOptions(actor, currentCounts, maxCounts);
    if (options.length === 0) return null;

    const section = document.createElement('section');
    section.className = 'pf2e-monster-sheet-sharing__strategic-assessment';

    const title = document.createElement('h3');
    title.textContent = localizeWithFallback(`${MODULE_ID}.discovered.strategicAssessment.title`, 'Strategic Assessment');
    section.append(title);

    const list = document.createElement('div');
    list.className = 'pf2e-monster-sheet-sharing__strategic-assessment-list';

    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pf2e-monster-sheet-sharing__strategic-assessment-button';
      button.disabled = option.disabled;
      button.addEventListener('click', () => {
        void this.#setRevealCount(option.choice, option.nextCount);
      });

      const icon = document.createElement('i');
      icon.className = option.icon;
      const label = document.createElement('span');
      label.textContent = option.label;
      button.append(icon, label);
      list.append(button);
    }

    section.append(list);
    return section;
  }

  async #setRevealCount(choice: RecallKnowledgeChoiceId, count: number): Promise<void> {
    if (!this.#data.actorUuid) return;

    try {
      await setRecallKnowledgeDiscoveryCount(this.#data.actorUuid, choice, count);
    } catch (error) {
      ui.notifications.error(error instanceof Error ? error.message : game.i18n.localize(`${MODULE_ID}.errors.shareFailed`));
    }
  }

  async #shareDiscoveredSheet(): Promise<void> {
    if (!this.#data.actorUuid) return;

    try {
      if (game.user.isGM) {
        const actor = await resolveActorFromUuid(this.#data.actorUuid);
        if (!actor || actor.type !== 'npc') throw new Error(game.i18n.localize(`${MODULE_ID}.errors.actorUnavailable`));

        await shareDiscoveredMonsterSheet(actor, { actorUuid: this.#data.actorUuid });
      } else {
        await requestDiscoveredMonsterShare(this.#data.actorUuid);
      }

      ui.notifications.info(game.i18n.format(`${MODULE_ID}.notifications.shared`, { name: this.#data.name }));
    } catch (error) {
      ui.notifications.error(error instanceof Error ? error.message : game.i18n.localize(`${MODULE_ID}.errors.shareFailed`));
    }
  }

  #renderShareHeaderButton(content: HTMLElement): void {
    if (!this.#data.actorUuid) return;

    const frame = content.closest<HTMLElement>('.app, .window-app, .application') ?? content;
    if (!frame || frame.querySelector('[data-action="pf2e-monster-share-discovered"]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pf2e-monster-sheet-sharing__sheet-button';
    button.dataset.action = 'pf2e-monster-share-discovered';
    button.ariaLabel = game.i18n.localize(`${MODULE_ID}.buttons.shareSheet`);
    button.title = game.i18n.localize(`${MODULE_ID}.buttons.shareSheet`);
    button.innerHTML = '<i class="fas fa-share-nodes"></i>';
    button.addEventListener('click', () => {
      void this.#shareDiscoveredSheet();
    });

    const headerTarget = frame.querySelector<HTMLElement>('.window-title') ?? frame.querySelector<HTMLElement>('.window-header');
    headerTarget?.append(button);
  }

  #findRowValue(label: string): string | null {
    for (const section of this.#data.sections) {
      const row = section.rows.find(candidate => candidate.label === label);
      if (row) return row.value;
    }

    return null;
  }
}

function getDiscoveredAppKey(data: DiscoveredMonsterData): string {
  return data.name.trim().toLocaleLowerCase();
}

async function resolveActorFromUuid(uuid: string): Promise<Actor | null> {
  const document = await foundry.utils.fromUuid(uuid);
  if (document instanceof CONFIG.Actor.documentClass) return document;
  if (document instanceof CONFIG.Token.documentClass) return document.actor ?? null;
  return null;
}

function countChoices(choices: RecallKnowledgeChoiceId[]): Map<RecallKnowledgeChoiceId, number> {
  const counts = new Map<RecallKnowledgeChoiceId, number>();
  for (const choice of choices) {
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }
  return counts;
}

function createIconButton(iconClass: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pf2e-monster-sheet-sharing__gm-reveal-button';
  button.setAttribute('aria-label', label);

  const icon = document.createElement('i');
  icon.className = iconClass;
  button.append(icon);

  return button;
}

function createTabButton(tab: string, label: string, active: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = active ? 'pf2e-monster-sheet-sharing__tab-button pf2e-monster-sheet-sharing__tab-button--active' : 'pf2e-monster-sheet-sharing__tab-button';
  button.dataset.tab = tab;
  button.setAttribute('aria-selected', String(active));
  button.textContent = label;
  return button;
}

const SIDEBAR_SECTION_IDS = new Set<RecallKnowledgeChoiceId>(['ac', 'hp', 'speed', 'fortitude', 'reflex', 'will', 'immunity', 'resistance', 'weakness']);
const SAVE_SECTION_IDS = new Set<RecallKnowledgeChoiceId>(['fortitude', 'reflex', 'will']);
const STRATEGIC_ASSESSMENT_CHOICES = ['weakness', 'resistance', 'immunity'] as const satisfies readonly RecallKnowledgeChoiceId[];

interface StrategicAssessmentOption {
  choice: RecallKnowledgeChoiceId;
  disabled: boolean;
  icon: string;
  label: string;
  nextCount: number;
}

function orderItemSections(sections: DiscoveredMonsterSection[]): DiscoveredMonsterSection[] {
  const order: Record<string, number> = {
    attack: 0,
    action: 1,
    passive: 2,
  };

  return [...sections].sort((a, b) => {
    return (order[a.id] ?? Number.MAX_SAFE_INTEGER) - (order[b.id] ?? Number.MAX_SAFE_INTEGER);
  });
}

function getStrategicAssessmentOptions(actor: Actor, currentCounts: Map<RecallKnowledgeChoiceId, number>, maxCounts: Map<RecallKnowledgeChoiceId, number>): StrategicAssessmentOption[] {
  const options: StrategicAssessmentOption[] = [];

  for (const choice of STRATEGIC_ASSESSMENT_CHOICES) {
    const maxCount = maxCounts.get(choice) ?? 0;
    const currentCount = currentCounts.get(choice) ?? 0;
    options.push({
      choice,
      disabled: maxCount <= 0 || currentCount >= maxCount,
      icon: getStrategicAssessmentIcon(choice),
      label: getStrategicAssessmentLabel(choice),
      nextCount: maxCount <= 0 ? 0 : currentCount + 1,
    });
  }

  const lowestSave = getLowestSaveChoice(actor);
  if (lowestSave) {
    const maxCount = maxCounts.get(lowestSave.choice) ?? 0;
    const currentCount = currentCounts.get(lowestSave.choice) ?? 0;
    options.push({
      choice: lowestSave.choice,
      disabled: maxCount <= 0 || currentCount >= maxCount,
      icon: 'fa-solid fa-shield-halved',
      label: game.i18n.format(`${MODULE_ID}.discovered.strategicAssessment.lowestSave`, { save: lowestSave.label }),
      nextCount: maxCount <= 0 ? 0 : currentCount + 1,
    });
  }

  return options;
}

function getStrategicAssessmentLabel(choice: (typeof STRATEGIC_ASSESSMENT_CHOICES)[number]): string {
  const labels: Record<(typeof STRATEGIC_ASSESSMENT_CHOICES)[number], [string, string]> = {
    immunity: [`${MODULE_ID}.discovered.strategicAssessment.immunity`, 'One immunity'],
    resistance: [`${MODULE_ID}.discovered.strategicAssessment.resistance`, 'Highest resistance'],
    weakness: [`${MODULE_ID}.discovered.strategicAssessment.weakness`, 'Highest weakness'],
  };
  const [key, fallback] = labels[choice];
  return localizeWithFallback(key, fallback);
}

function getStrategicAssessmentIcon(choice: (typeof STRATEGIC_ASSESSMENT_CHOICES)[number]): string {
  const icons: Record<(typeof STRATEGIC_ASSESSMENT_CHOICES)[number], string> = {
    immunity: 'fa-solid fa-ban',
    resistance: 'fa-solid fa-shield',
    weakness: 'fa-solid fa-burst',
  };
  return icons[choice];
}

function getLowestSaveChoice(actor: Actor): { choice: 'fortitude' | 'reflex' | 'will'; label: string } | null {
  const saves = [
    { choice: 'fortitude' as const, label: localizeWithFallback(`${MODULE_ID}.recallKnowledge.choices.fortitude`, 'Fortitude'), value: getNumericProperty(actor, 'system.saves.fortitude.value') },
    { choice: 'reflex' as const, label: localizeWithFallback(`${MODULE_ID}.recallKnowledge.choices.reflex`, 'Reflex'), value: getNumericProperty(actor, 'system.saves.reflex.value') },
    { choice: 'will' as const, label: localizeWithFallback(`${MODULE_ID}.recallKnowledge.choices.will`, 'Will'), value: getNumericProperty(actor, 'system.saves.will.value') },
  ].filter((save): save is { choice: 'fortitude' | 'reflex' | 'will'; label: string; value: number } => typeof save.value === 'number');

  if (saves.length === 0) return null;
  return saves.sort((a, b) => a.value - b.value)[0];
}

function getNumericProperty(source: object, path: string): number | null {
  const value = foundry.utils.getProperty(source, path);
  return typeof value === 'number' ? value : null;
}

function groupSavesSections(sections: DiscoveredMonsterSection[]): DiscoveredMonsterSection[] {
  const saves = sections.filter(section => SAVE_SECTION_IDS.has(section.id));
  if (saves.length === 0) return sections;

  const groupedSaves: DiscoveredMonsterSection = {
    id: 'fortitude',
    label: localizeWithFallback(`${MODULE_ID}.discovered.saves`, 'Saves'),
    rows: saves.flatMap(section => section.rows),
    items: [],
  };

  let savesInserted = false;
  return sections.flatMap(section => {
    if (!SAVE_SECTION_IDS.has(section.id)) return [section];
    if (savesInserted) return [];

    savesInserted = true;
    return [groupedSaves];
  });
}

async function enrichDescription(description: string): Promise<string> {
  return CONFIG.ux.TextEditor.implementation.enrichHTML(description, {
    custom: true,
    documents: true,
    embeds: false,
    links: true,
    rolls: true,
    secrets: false,
  });
}

function localizeWithFallback(key: string, fallback: string): string {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

function renderSizeScale(activeSize: string): HTMLElement {
  const list = document.createElement('ol');
  list.className = 'pf2e-monster-sheet-sharing__size-scale';

  const sizes = [
    ['tiny', 'Tiny'],
    ['sm', 'Small'],
    ['med', 'Medium'],
    ['lg', 'Large'],
    ['huge', 'Huge'],
    ['grg', 'Gargantuan'],
  ] as const;

  for (const [id, label] of sizes) {
    const item = document.createElement('li');
    item.textContent = label;
    item.dataset.size = id;
    if (id === activeSize) {
      item.className = 'pf2e-monster-sheet-sharing__size-scale-current';
      item.setAttribute('aria-current', 'true');
    }
    list.append(item);
  }

  return list;
}

function renderTraitList(value: string, compact = false): HTMLElement {
  const list = document.createElement('ul');
  list.className = compact ? 'tags pf2e-monster-sheet-sharing__trait-list pf2e-monster-sheet-sharing__trait-list--compact' : 'tags pf2e-monster-sheet-sharing__trait-list';

  for (const trait of value
    .split(',')
    .map(traitValue => traitValue.trim())
    .filter(Boolean)) {
    const tag = document.createElement('li');
    tag.className = `tag trait ${slugifyTrait(trait)}`;
    tag.textContent = trait;
    tag.dataset.trait = slugifyTrait(trait);
    list.append(tag);
  }

  return list;
}

function slugifyTrait(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
