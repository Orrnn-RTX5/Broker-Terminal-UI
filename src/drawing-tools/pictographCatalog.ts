export type PictographTab = 'emojis' | 'stickers' | 'icons';
export type PictographCategory = 'smileys' | 'nature' | 'food' | 'activities' | 'travel' | 'objects' | 'symbols' | 'flags';

export type PictographStamp = Readonly<{
  id: string;
  glyph: string;
  label: string;
  assetUrl: string;
  size: number;
}>;

export const PICTOGRAPH_CATEGORIES: ReadonlyArray<Readonly<{ id: PictographCategory; label: string }>> = [
  { id: 'smileys', label: 'Smileys & people' },
  { id: 'nature', label: 'Animals & nature' },
  { id: 'food', label: 'Food & drink' },
  { id: 'activities', label: 'Activities' },
  { id: 'travel', label: 'Travel & places' },
  { id: 'objects', label: 'Objects' },
  { id: 'symbols', label: 'Signs & symbols' },
  { id: 'flags', label: 'Flags' },
];

// Emoji artwork ships as same-origin hashed assets fetched on demand, keeping
// hundreds of SVGs out of the startup-critical JavaScript. Saved charts stay
// independent of platform emoji fonts and of any external image service; image
// exports and print previews (which rasterize the overlay in a context that
// cannot fetch URLs) go through resolvePictographDataUrl() below.
const emojiAssets = import.meta.glob<string>('../assets/pictographs/twemoji/*.svg', {
  eager: true,
  // '?no-inline' keeps even sub-4KB artwork out of the JavaScript bundle;
  // a plain '?url' would still inline those as data URIs.
  query: '?no-inline',
  import: 'default',
});

const emojiEntries: Record<PictographCategory, ReadonlyArray<readonly [string, string]>> = {
  smileys: [
    ['😀', 'Grinning face'], ['😃', 'Grinning face with big eyes'], ['😄', 'Grinning face with smiling eyes'],
    ['😁', 'Beaming face'], ['😆', 'Laughing face'], ['😅', 'Smiling face with sweat'], ['🤣', 'Rolling on the floor laughing'],
    ['😂', 'Face with tears of joy'], ['🙂', 'Slightly smiling face'], ['🙃', 'Upside-down face'], ['😉', 'Winking face'],
    ['😊', 'Smiling face with smiling eyes'], ['😇', 'Smiling face with halo'], ['🥰', 'Smiling face with hearts'],
    ['😍', 'Smiling face with heart eyes'], ['🤩', 'Star-struck face'], ['😘', 'Face blowing a kiss'], ['😋', 'Face savoring food'],
    ['😛', 'Face with tongue'], ['😜', 'Winking face with tongue'], ['🤪', 'Zany face'], ['😝', 'Squinting face with tongue'],
    ['🤑', 'Money-mouth face'], ['🤗', 'Hugging face'], ['🤭', 'Face with hand over mouth'], ['🤫', 'Shushing face'],
    ['🤔', 'Thinking face'], ['🤐', 'Zipper-mouth face'], ['🤨', 'Face with raised eyebrow'], ['😐', 'Neutral face'],
    ['😑', 'Expressionless face'], ['😶', 'Face without mouth'], ['😏', 'Smirking face'], ['😒', 'Unamused face'],
    ['🙄', 'Face with rolling eyes'], ['😬', 'Grimacing face'], ['😌', 'Relieved face'], ['😔', 'Pensive face'],
    ['😴', 'Sleeping face'], ['😷', 'Face with medical mask'], ['🤒', 'Face with thermometer'], ['🤕', 'Face with head bandage'],
    ['🤢', 'Nauseated face'], ['🤧', 'Sneezing face'], ['🥵', 'Hot face'], ['🥶', 'Cold face'], ['🥴', 'Woozy face'],
    ['😵', 'Dizzy face'], ['🤯', 'Exploding head'], ['🤠', 'Cowboy hat face'], ['🥳', 'Partying face'], ['😎', 'Smiling face with sunglasses'],
    ['🤓', 'Nerd face'], ['🧐', 'Face with monocle'], ['😕', 'Confused face'], ['😟', 'Worried face'], ['🙁', 'Slightly frowning face'],
    ['😮', 'Face with open mouth'], ['😲', 'Astonished face'], ['🥺', 'Pleading face'], ['😢', 'Crying face'],
    ['😭', 'Loudly crying face'], ['😱', 'Face screaming in fear'], ['😤', 'Face with steam from nose'], ['😡', 'Angry face'],
    ['🤬', 'Face with symbols on mouth'], ['😈', 'Smiling face with horns'], ['💀', 'Skull'], ['👻', 'Ghost'],
    ['👽', 'Alien'], ['🤖', 'Robot'], ['😺', 'Grinning cat'], ['😸', 'Grinning cat with smiling eyes'],
    ['😹', 'Cat with tears of joy'], ['😻', 'Smiling cat with heart eyes'], ['🙈', 'See-no-evil monkey'],
    ['🙉', 'Hear-no-evil monkey'], ['🙊', 'Speak-no-evil monkey'], ['👋', 'Waving hand'], ['👌', 'OK hand'],
    ['✌️', 'Victory hand'], ['🤞', 'Crossed fingers'], ['👍', 'Thumbs up'], ['👎', 'Thumbs down'],
    ['👏', 'Clapping hands'], ['🙌', 'Raising hands'], ['🙏', 'Folded hands'], ['💪', 'Flexed biceps'],
  ],
  nature: [
    ['🐶', 'Dog face'], ['🐱', 'Cat face'], ['🐭', 'Mouse face'], ['🐹', 'Hamster'], ['🐰', 'Rabbit face'],
    ['🦊', 'Fox'], ['🐻', 'Bear'], ['🐼', 'Panda'], ['🐨', 'Koala'], ['🐯', 'Tiger face'], ['🦁', 'Lion'],
    ['🐮', 'Cow face'], ['🐷', 'Pig face'], ['🐸', 'Frog'], ['🐵', 'Monkey face'], ['🐔', 'Chicken'],
    ['🐧', 'Penguin'], ['🐦', 'Bird'], ['🐤', 'Baby chick'], ['🦆', 'Duck'], ['🦅', 'Eagle'], ['🦉', 'Owl'],
    ['🦋', 'Butterfly'], ['🐝', 'Honeybee'], ['🐞', 'Lady beetle'], ['🐢', 'Turtle'], ['🐬', 'Dolphin'],
    ['🐳', 'Spouting whale'], ['🐟', 'Fish'], ['🐙', 'Octopus'], ['🌵', 'Cactus'], ['🌲', 'Evergreen tree'],
    ['🌴', 'Palm tree'], ['🌱', 'Seedling'], ['🍀', 'Four-leaf clover'], ['🌹', 'Rose'], ['🌻', 'Sunflower'],
    ['🌼', 'Blossom'], ['🌷', 'Tulip'], ['🍁', 'Maple leaf'],
  ],
  food: [
    ['🍏', 'Green apple'], ['🍎', 'Red apple'], ['🍐', 'Pear'], ['🍊', 'Tangerine'], ['🍋', 'Lemon'],
    ['🍌', 'Banana'], ['🍉', 'Watermelon'], ['🍇', 'Grapes'], ['🍓', 'Strawberry'], ['🍒', 'Cherries'],
    ['🍑', 'Peach'], ['🍍', 'Pineapple'], ['🥥', 'Coconut'], ['🥝', 'Kiwi fruit'], ['🥑', 'Avocado'],
    ['🥦', 'Broccoli'], ['🌽', 'Ear of corn'], ['🥕', 'Carrot'], ['🍞', 'Bread'], ['🥐', 'Croissant'],
    ['🧀', 'Cheese wedge'], ['🍳', 'Cooking'], ['🥞', 'Pancakes'], ['🍔', 'Hamburger'], ['🍟', 'French fries'],
    ['🍕', 'Pizza'], ['🌮', 'Taco'], ['🍣', 'Sushi'], ['🍜', 'Steaming bowl'], ['🍿', 'Popcorn'],
    ['🍩', 'Doughnut'], ['🍪', 'Cookie'], ['🎂', 'Birthday cake'], ['🍫', 'Chocolate bar'], ['🍭', 'Lollipop'],
    ['🍦', 'Soft ice cream'], ['☕', 'Hot beverage'], ['🍵', 'Teacup'], ['🍹', 'Tropical drink'], ['🥤', 'Cup with straw'],
  ],
  activities: [
    ['⚽', 'Soccer ball'], ['🏀', 'Basketball'], ['🏈', 'American football'], ['⚾', 'Baseball'], ['🎾', 'Tennis'],
    ['🏐', 'Volleyball'], ['🏉', 'Rugby football'], ['🎱', 'Pool eight ball'], ['🏓', 'Ping pong'], ['🏸', 'Badminton'],
    ['🏒', 'Ice hockey'], ['🏏', 'Cricket game'], ['⛳', 'Flag in hole'], ['🏹', 'Bow and arrow'], ['🎣', 'Fishing pole'],
    ['🥊', 'Boxing glove'], ['🎿', 'Skis'], ['🛹', 'Skateboard'], ['🏆', 'Trophy'], ['🥇', 'First place medal'],
    ['🥈', 'Second place medal'], ['🥉', 'Third place medal'], ['🏅', 'Sports medal'], ['🎯', 'Bullseye'],
    ['🎮', 'Video game'], ['🎲', 'Game die'], ['🎭', 'Performing arts'], ['🎨', 'Artist palette'],
    ['🎤', 'Microphone'], ['🎧', 'Headphone'], ['🎸', 'Guitar'], ['🎹', 'Musical keyboard'],
  ],
  travel: [
    ['🚗', 'Automobile'], ['🚕', 'Taxi'], ['🚌', 'Bus'], ['🚎', 'Trolleybus'], ['🏎️', 'Racing car'],
    ['🚓', 'Police car'], ['🚑', 'Ambulance'], ['🚒', 'Fire engine'], ['🚚', 'Delivery truck'], ['🚲', 'Bicycle'],
    ['🛵', 'Motor scooter'], ['🚂', 'Locomotive'], ['🚄', 'High-speed train'], ['✈️', 'Airplane'], ['🚀', 'Rocket'],
    ['🚁', 'Helicopter'], ['⛵', 'Sailboat'], ['🚢', 'Ship'], ['⚓', 'Anchor'], ['⛽', 'Fuel pump'],
    ['🗽', 'Statue of Liberty'], ['🗼', 'Tokyo tower'], ['🏰', 'Castle'], ['🏠', 'House'], ['🏢', 'Office building'],
    ['🏖️', 'Beach with umbrella'], ['🏝️', 'Desert island'], ['🌋', 'Volcano'], ['🌅', 'Sunrise'], ['🌈', 'Rainbow'],
    ['☀️', 'Sun'], ['🌙', 'Crescent moon'],
  ],
  objects: [
    ['⌚', 'Watch'], ['📱', 'Mobile phone'], ['💻', 'Laptop'], ['⌨️', 'Keyboard'], ['🖥️', 'Desktop computer'],
    ['🖨️', 'Printer'], ['📷', 'Camera'], ['📺', 'Television'], ['📻', 'Radio'], ['⏰', 'Alarm clock'],
    ['💡', 'Light bulb'], ['🔦', 'Flashlight'], ['🔋', 'Battery'], ['🔌', 'Electric plug'], ['💰', 'Money bag'],
    ['💵', 'Dollar banknote'], ['💳', 'Credit card'], ['💎', 'Gem stone'], ['⚖️', 'Balance scale'], ['🔧', 'Wrench'],
    ['🔨', 'Hammer'], ['⚙️', 'Gear'], ['🔑', 'Key'], ['🔒', 'Locked'], ['🔓', 'Unlocked'], ['🛡️', 'Shield'],
    ['📦', 'Package'], ['📚', 'Books'], ['📖', 'Open book'], ['📝', 'Memo'], ['📌', 'Pushpin'], ['📎', 'Paperclip'],
    ['✂️', 'Scissors'], ['📅', 'Calendar'], ['📈', 'Chart increasing'], ['📉', 'Chart decreasing'],
    ['📊', 'Bar chart'], ['🔍', 'Magnifying glass'], ['🔔', 'Bell'], ['🎁', 'Wrapped gift'],
  ],
  symbols: [
    ['❤️', 'Red heart'], ['🧡', 'Orange heart'], ['💛', 'Yellow heart'], ['💚', 'Green heart'], ['💙', 'Blue heart'],
    ['💜', 'Purple heart'], ['🖤', 'Black heart'], ['🤍', 'White heart'], ['💔', 'Broken heart'], ['💕', 'Two hearts'],
    ['💯', 'Hundred points'], ['💢', 'Anger symbol'], ['💥', 'Collision'], ['💫', 'Dizzy'], ['💦', 'Sweat droplets'],
    ['⭐', 'Star'], ['🌟', 'Glowing star'], ['✨', 'Sparkles'], ['🔥', 'Fire'], ['✅', 'Check mark button'],
    ['❌', 'Cross mark'], ['❓', 'Question mark'], ['❗', 'Exclamation mark'], ['⚠️', 'Warning'], ['🚫', 'Prohibited'],
    ['♻️', 'Recycling symbol'], ['🔴', 'Red circle'], ['🟢', 'Green circle'], ['🔵', 'Blue circle'], ['🟡', 'Yellow circle'],
  ],
  flags: [
    ['🏁', 'Chequered flag'], ['🚩', 'Triangular flag'], ['🏳️', 'White flag'], ['🏴', 'Black flag'],
    ['🇦🇺', 'Australia flag'], ['🇧🇷', 'Brazil flag'], ['🇨🇦', 'Canada flag'], ['🇨🇳', 'China flag'],
    ['🇫🇷', 'France flag'], ['🇩🇪', 'Germany flag'], ['🇮🇳', 'India flag'], ['🇮🇩', 'Indonesia flag'],
    ['🇮🇹', 'Italy flag'], ['🇯🇵', 'Japan flag'], ['🇲🇽', 'Mexico flag'], ['🇳🇱', 'Netherlands flag'],
    ['🇳🇿', 'New Zealand flag'], ['🇸🇦', 'Saudi Arabia flag'], ['🇸🇬', 'Singapore flag'], ['🇿🇦', 'South Africa flag'],
    ['🇰🇷', 'South Korea flag'], ['🇨🇭', 'Switzerland flag'], ['🇬🇧', 'United Kingdom flag'], ['🇺🇸', 'United States flag'],
  ],
};

const toAssetId = (glyph: string): string => Array.from(glyph)
  .filter((character) => character.codePointAt(0) !== 0xfe0f)
  .map((character) => character.codePointAt(0)!.toString(16))
  .join('-');

// Stickers are a distinct, larger collection of expressive artwork, not a
// duplicate unimplemented tab. All choices retain stable sticker:* identities.
const stickerGlyphs: Record<PictographCategory, readonly string[]> = {
  smileys: ['😂', '🤣', '😍', '🤩', '🥳', '😎', '🤔', '🤯', '😭', '😱', '🤖', '👻', '👍', '👏', '💪', '🙏'],
  nature: ['🦊', '🦁', '🐼', '🦋', '🌻', '🍀'],
  food: ['🍕', '🍔', '🎂', '🍩', '☕', '🍹'],
  activities: ['🏆', '🥇', '🎯', '🎮', '🎨', '🎸'],
  travel: ['🚀', '🏎️', '✈️', '🏝️', '🌈', '🌙'],
  objects: ['💰', '💎', '💡', '📈', '📉', '🎁'],
  symbols: ['❤️', '💯', '🔥', '⭐', '✨', '✅', '❌', '⚠️'],
  flags: ['🏁', '🚩', '🇮🇳', '🇬🇧', '🇺🇸'],
};

const makeEmoji = (tab: 'emojis' | 'stickers', glyph: string, label: string): PictographStamp => {
  const assetId = toAssetId(glyph);
  const assetUrl = emojiAssets[`../assets/pictographs/twemoji/${assetId}.svg`];
  if (!assetUrl) throw new Error(`Missing bundled pictograph asset: ${assetId}`);
  return Object.freeze({ id: `${tab === 'emojis' ? 'emoji' : 'sticker'}:${assetId}`, glyph, label, assetUrl, size: tab === 'emojis' ? 32 : 48 });
};

const iconSvg = (body: string): string => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
)}`;

// Original, fixed SVG artwork. It uses no injected text, URLs or platform fonts.
const iconEntries: ReadonlyArray<readonly [PictographCategory, string, string, string, string]> = [
  ['symbols', 'arrow-up', '↑', 'Arrow up', '<path d="M12 20V4m-6 6 6-6 6 6"/>'],
  ['symbols', 'arrow-down', '↓', 'Arrow down', '<path d="M12 4v16m-6-6 6 6 6-6"/>'],
  ['symbols', 'arrow-left', '←', 'Arrow left', '<path d="M20 12H4m6-6-6 6 6 6"/>'],
  ['symbols', 'arrow-right', '→', 'Arrow right', '<path d="M4 12h16m-6-6 6 6-6 6"/>'],
  ['symbols', 'plus', '+', 'Plus', '<path d="M12 5v14M5 12h14"/>'],
  ['symbols', 'minus', '−', 'Minus', '<path d="M5 12h14"/>'],
  ['symbols', 'check', '✓', 'Check mark', '<path d="m4 12 5 5L20 6"/>'],
  ['symbols', 'cross', '×', 'Cross', '<path d="m6 6 12 12M6 18 18 6"/>'],
  ['symbols', 'warning', '!', 'Warning', '<path d="m12 3 10 18H2Z M12 9v5m0 3v.1"/>'],
  ['symbols', 'information', 'i', 'Information', '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>'],
  ['symbols', 'question', '?', 'Question', '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 2.8c-.8.3-1 1.2-1 2.2m0 3v.1"/>'],
  ['symbols', 'circle', '○', 'Circle', '<circle cx="12" cy="12" r="8"/>'],
  ['symbols', 'square', '□', 'Square', '<rect x="4" y="4" width="16" height="16" rx="1"/>'],
  ['symbols', 'triangle', '△', 'Triangle', '<path d="m12 3 10 18H2Z"/>'],
  ['symbols', 'diamond', '◇', 'Diamond', '<path d="m12 2 10 10-10 10L2 12Z"/>'],
  ['nature', 'sun', '☀', 'Sun', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'],
  ['nature', 'moon', '☾', 'Moon', '<path d="M20 15.3A8.5 8.5 0 0 1 8.7 4a8.5 8.5 0 1 0 11.3 11.3Z"/>'],
  ['nature', 'bolt', 'ϟ', 'Lightning bolt', '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>'],
  ['activities', 'star', '☆', 'Star', '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"/>'],
  ['activities', 'target', '◎', 'Target', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'],
  ['activities', 'trophy', '♜', 'Trophy', '<path d="M8 3h8v7a4 4 0 0 1-8 0Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 1h8"/>'],
  ['smileys', 'heart', '♡', 'Heart', '<path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-9.3a5 5 0 0 0 0-7.1Z"/>'],
  ['smileys', 'smile', '☺', 'Smile', '<circle cx="12" cy="12" r="9"/><path d="M8 9h.1m7.8 0h.1M7.5 14a5 5 0 0 0 9 0"/>'],
  ['food', 'cup', '☕', 'Cup', '<path d="M4 7h13v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Zm13 1h2a3 3 0 0 1 0 6h-2M3 22h16M8 2v2m5-2v2"/>'],
  ['travel', 'pin', '⌖', 'Location pin', '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>'],
  ['travel', 'home', '⌂', 'Home', '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>'],
  ['objects', 'clock', '◷', 'Clock', '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'],
  ['objects', 'shield', '◇', 'Shield', '<path d="m12 2 8 3v6c0 5-8 11-8 11S4 16 4 11V5Z"/>'],
  ['objects', 'lock', '♙', 'Lock', '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>'],
  ['objects', 'bookmark', '♧', 'Bookmark', '<path d="M6 3h12v18l-6-4-6 4Z"/>'],
  ['objects', 'trend-up', '↗', 'Trend up', '<path d="m3 17 6-6 4 4 8-10m-6 0h6v6"/>'],
  ['objects', 'trend-down', '↘', 'Trend down', '<path d="m3 7 6 6 4-4 8 10m-6 0h6v-6"/>'],
  ['flags', 'flag', '⚑', 'Flag', '<path d="M5 22V3m0 1c5-4 9 4 14 0v11c-5 4-9-4-14 0"/>'],
];

const catalog: Record<PictographTab, Record<PictographCategory, readonly PictographStamp[]>> = {
  emojis: {} as Record<PictographCategory, readonly PictographStamp[]>,
  stickers: {} as Record<PictographCategory, readonly PictographStamp[]>,
  icons: {} as Record<PictographCategory, readonly PictographStamp[]>,
};
const stampsById = new Map<string, PictographStamp>();

for (const { id: category } of PICTOGRAPH_CATEGORIES) {
  catalog.emojis[category] = Object.freeze(emojiEntries[category].map(([glyph, label]) => makeEmoji('emojis', glyph, label)));
  catalog.stickers[category] = Object.freeze(stickerGlyphs[category].map((glyph) => {
    const entry = emojiEntries[category].find(([candidate]) => candidate === glyph);
    if (!entry) throw new Error(`Unknown curated sticker: ${category}`);
    return makeEmoji('stickers', glyph, entry[1]);
  }));
  catalog.icons[category] = Object.freeze(iconEntries
    .filter(([iconCategory]) => iconCategory === category)
    .map(([, id, glyph, label, svg]) => Object.freeze({ id: `icon:${id}`, glyph, label, assetUrl: iconSvg(svg), size: 28 })));
  for (const tab of ['emojis', 'stickers', 'icons'] as const) {
    for (const stamp of catalog[tab][category]) stampsById.set(stamp.id, stamp);
  }
}

const EMPTY_ITEMS: readonly PictographStamp[] = Object.freeze([]);

export const getPictographItems = (tab: PictographTab, category: string): readonly PictographStamp[] => (
  Object.hasOwn(catalog[tab], category) ? catalog[tab][category as PictographCategory] : EMPTY_ITEMS
);

/** Resolve only a curated subtype; persisted drawing data cannot inject URLs. */
export const getPictographStamp = (subtype: string | undefined): PictographStamp | undefined => (
  typeof subtype === 'string' ? stampsById.get(subtype) : undefined
);

const pendingDataUrls = new Map<string, Promise<string>>();
const resolvedDataUrls = new Map<string, string>();

/** Synchronous data-URI lookup for stamps whose artwork already resolved. */
export const getResolvedPictographDataUrl = (stamp: PictographStamp): string | undefined => (
  stamp.assetUrl.startsWith('data:') ? stamp.assetUrl : resolvedDataUrls.get(stamp.assetUrl)
);

/**
 * Inline a stamp's artwork as a data URI. Image exports and print previews
 * rasterize the drawing overlay through an SVG-in-image context that cannot
 * fetch URLs, so chart stamps swap their href to this once resolved.
 */
export const resolvePictographDataUrl = (stamp: PictographStamp): Promise<string> => {
  const resolved = getResolvedPictographDataUrl(stamp);
  if (resolved !== undefined) return Promise.resolve(resolved);

  let pending = pendingDataUrls.get(stamp.assetUrl);
  if (!pending) {
    pending = Promise.resolve()
      .then(() => fetch(stamp.assetUrl, { credentials: 'omit' }))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((svgText) => {
        const dataUrl = `data:image/svg+xml,${encodeURIComponent(svgText)}`;
        resolvedDataUrls.set(stamp.assetUrl, dataUrl);
        pendingDataUrls.delete(stamp.assetUrl);
        return dataUrl;
      })
      .catch((error) => {
        pendingDataUrls.delete(stamp.assetUrl);
        throw error;
      });
    pendingDataUrls.set(stamp.assetUrl, pending);
  }
  return pending;
};

export const isPictographStamp = (subtype: string | undefined): boolean => Boolean(getPictographStamp(subtype));
