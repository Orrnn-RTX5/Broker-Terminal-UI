import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Cat, Flag, Heart, Lightbulb, Rocket, Smile, Trophy, Utensils, type LucideIcon } from 'lucide-react';
import { useUiTranslation } from '../hooks/useUiTranslation';
import { getPictographItems, PICTOGRAPH_CATEGORIES } from './pictographCatalog';
import './EmojiPicker.css';

type PickerTab = 'emojis' | 'stickers' | 'icons';
const TABS = [
  { id: 'emojis', label: 'Emojis', itemLabel: 'Emoji' },
  { id: 'stickers', label: 'Stickers', itemLabel: 'Sticker' },
  { id: 'icons', label: 'Icons', itemLabel: 'Icon' },
] as const;
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  smileys: Smile, nature: Cat, food: Utensils, activities: Trophy,
  travel: Rocket, objects: Lightbulb, symbols: Heart, flags: Flag,
};

export function EmojiPicker({ selectedSubtype, onSelect, ready = true }: {
  selectedSubtype?: string;
  onSelect: (subtype: string) => void;
  ready?: boolean;
}) {
  const tr = useUiTranslation();
  const id = useId();
  const [tab, setTab] = useState<PickerTab>(() => selectedSubtype?.startsWith('sticker:')
    ? 'stickers' : selectedSubtype?.startsWith('icon:') ? 'icons' : 'emojis');
  const [activeCategory, setActiveCategory] = useState<string>('smileys');
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const categories = PICTOGRAPH_CATEGORIES.filter(category => getPictographItems(tab, category.id).length > 0);
  const selectedCategory = categories.some(category => category.id === activeCategory)
    ? activeCategory : categories[0]?.id;
  const itemLabel = tr(TABS.find(item => item.id === tab)!.itemLabel);

  useEffect(() => {
    // The picker is a non-modal popover. Start on a category and let Escape
    // return focus to the rail; Tab can leave without trapping the user.
    // The rail positions its portal while hidden. Wait until it is visible,
    // otherwise browsers leave focus and its tooltip on the smiley trigger.
    if (ready) categoryRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }, [ready]);

  const switchTab = (nextTab: PickerTab) => {
    setTab(nextTab);
    setActiveCategory(PICTOGRAPH_CATEGORIES.find(category => getPictographItems(nextTab, category.id).length > 0)?.id ?? 'smileys');
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const selectCategory = (category: string) => {
    setActiveCategory(category);
    const scroll = scrollRef.current;
    const section = scroll?.querySelector<HTMLElement>(`[data-category="${category}"]`);
    if (scroll && section) {
      scroll.scrollTop += section.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    }
  };

  const navigateButtons = (event: KeyboardEvent<HTMLDivElement>, kind: 'category' | 'tab') => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const container = kind === 'category' ? categoryRef.current : tabRef.current;
    const buttons = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0 || !buttons.length) return;
    event.preventDefault();
    event.stopPropagation();
    const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = event.key === (isRtl ? 'ArrowLeft' : 'ArrowRight');
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (forward ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    if (kind === 'tab') switchTab(TABS[next].id);
    else selectCategory(categories[next].id);
  };

  const navigateGrid = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const gridStyle = getComputedStyle(event.currentTarget);
    const columns = gridStyle.gridTemplateColumns.split(' ').filter(Boolean).length || 8;
    const horizontal = (event.key === 'ArrowRight' ? 1 : -1) * (gridStyle.direction === 'rtl' ? -1 : 1);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current + (event.key === 'ArrowDown' ? columns : event.key === 'ArrowUp' ? -columns : horizontal);
    buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
  };

  return <div className="drawing-emoji-picker" data-picker-tab={tab}>
    <div className="drawing-emoji-picker__categories" role="toolbar" aria-label={tr('Emoji categories')}
      ref={categoryRef} onKeyDown={event => navigateButtons(event, 'category')}>
      {categories.map(category => {
        const CategoryIcon = CATEGORY_ICONS[category.id];
        return <button key={category.id} type="button" title={tr(category.label)} aria-label={tr(category.label)}
          aria-pressed={selectedCategory === category.id} tabIndex={selectedCategory === category.id ? 0 : -1}
          onClick={() => selectCategory(category.id)}>
          <CategoryIcon size={20} strokeWidth={1.25} aria-hidden="true" />
        </button>;
      })}
    </div>
    <div className="drawing-emoji-picker__scroll" ref={scrollRef} role="tabpanel"
      id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} onScroll={() => {
        const scroll = scrollRef.current;
        if (!scroll) return;
        const sections = Array.from(scroll.querySelectorAll<HTMLElement>('[data-category]'));
        const top = scroll.getBoundingClientRect().top;
        const atBottom = scroll.scrollTop > 0 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
        const current = atBottom ? sections.at(-1)
          : sections.filter(section => section.getBoundingClientRect().top <= top + 20).at(-1);
        if (current?.dataset.category) setActiveCategory(current.dataset.category);
      }}>
      {categories.map(category => <section key={category.id} data-category={category.id}
        aria-labelledby={`${id}-${category.id}-heading`}>
        <h3 id={`${id}-${category.id}-heading`}>{tr(category.label)}</h3>
        <div className="drawing-emoji-picker__grid" onKeyDown={navigateGrid}>
          {getPictographItems(tab, category.id).map((item, index, items) => <button key={item.id} type="button"
            data-pictograph-id={item.id} aria-label={`${itemLabel} ${item.glyph}`} title={`${itemLabel} ${item.glyph}`}
            tabIndex={focusedItem === item.id || (index === 0 && !items.some(candidate => candidate.id === focusedItem)) ? 0 : -1}
            onFocus={() => setFocusedItem(item.id)}
            aria-pressed={selectedSubtype === item.id} onClick={() => onSelect(item.id)}>
            <img src={item.assetUrl} alt="" width={28} height={28} draggable={false} />
          </button>)}
        </div>
      </section>)}
    </div>
    <div className="drawing-emoji-picker__tabs" ref={tabRef} role="tablist" aria-label={tr('Emoji picker')}
      onKeyDown={event => navigateButtons(event, 'tab')}>
      {TABS.map(item => <button type="button" key={item.id} id={`${id}-${item.id}`} role="tab"
        aria-selected={tab === item.id} aria-controls={`${id}-panel`} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => switchTab(item.id)}>{tr(item.label)}</button>)}
    </div>
    <div className="drawing-emoji-picker__credit">
      <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noopener noreferrer">Twemoji</a>
      <span aria-hidden="true"> · </span>
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>
    </div>
  </div>;
}
