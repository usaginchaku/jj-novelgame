import { activeCharacterId, ENDINGS, RELATION_KEYS } from './model.js';
import { createState, currentEvent, atChoices, availableChoices, formatText, revealScene, scenePageLines, recentMessageReply, choose, makeMemory } from './engine.js';
import { createStorage, SAVE_SLOTS } from './storage.js';
import { defaultWorlds, validateWorlds, loadWorldConfig } from './worlds.js';
import { PORTRAITS } from './portraits.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const dialog = document.querySelector('#save-dialog');
let config, events, storage, state = null;
let baseConfig, baseEvents, worlds, world;
let worldLoad = 0;
const worldName = () => config.characters[activeCharacterId(config)].name + 'の世界';
async function readJson(url, optional = false) {
  const response = await fetch(url);
  if (optional && response.status === 404) return undefined;
  if (!response.ok) throw new Error('読み込み失敗: ' + url);
  return response.json();
}
async function selectWorld(id) {
  if (!worlds.some(item => item.id === id)) throw new Error('未知の世界です');
  const request = ++worldLoad;
  const route = id === 'joseph' ? undefined : await readJson('data/routes/' + id + '.json');
  const loaded = loadWorldConfig(baseConfig, baseEvents, worlds, id, route);
  if (request !== worldLoad) return;
  // Commit the switch only after all input validates. Saved worlds stay intact.
  config = loaded.config;
  events = loaded.events;
  world = loaded.world;
  storage = createStorage(localStorage, config, events);
  state = null;
  document.querySelector('.edition').textContent = worldName();
  document.title = config.title + ' — ' + worldName();
  message();
  renderNavigation();
  renderHome();
  try { storage.readMeta(); } catch (error) { message(error.message); }
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(text = '') { notice.textContent = text; }
function guard(action) {
  return () => {
    try {
      const result = action();
      if (result?.catch) result.catch(error => message(error.message));
    } catch (error) { message(error.message); }
  };
}
function button(text, action, className = '') {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', guard(action));
  return node;
}
function heading(title, caption) {
  app.replaceChildren(el('p', worldName() + ' / ' + caption, 'eyebrow'), el('h2', title, 'page-title'));
}
function speakerName(id, player) {
  return id === 'narrator' ? '—' : id === 'player' ? player.displayName : config.characters[id].name;
}
function speakerLabel(id, player) {
  const label = el('p', undefined, 'speaker');
  const definition = Object.hasOwn(PORTRAITS, id) ? PORTRAITS[id] : undefined;
  if (definition) {
    const portrait = el('span', undefined, 'speaker-portrait');
    portrait.setAttribute('aria-hidden', 'true');
    portrait.style.setProperty('--portrait-image', `url("${definition.image}")`);
    portrait.style.setProperty('--portrait-size', definition.size);
    portrait.style.setProperty('--portrait-position', definition.position);
    label.append(portrait);
  }
  label.append(document.createTextNode(speakerName(id, player)));
  return label;
}
function lineText(line) {
  return formatText(line.text, state.player, state, config, line.speaker === 'narrator' ? activeCharacterId(config) : line.speaker);
}
function remember(previous, messageRecord) {
  const event = currentEvent(previous, events);
  if (event.message && !messageRecord) return;
  const memory = makeMemory(previous, config, events, messageRecord);
  const meta = storage.readMeta();
  let changed = false;
  if (!meta.memories.some(item => item.id === memory.id)) { meta.memories.push(memory); changed = true; }
  if (event.ending && !meta.endings.includes(event.ending)) { meta.endings.push(event.ending); changed = true; }
  if (changed) storage.writeMeta(meta);
}
function persist(previous = state, messageRecord) {
  const errors = [];
  try { storage.write('auto', state); }
  catch (error) { errors.push('オートセーブできませんでした: ' + error.message); }
  if (atChoices(previous, events)) {
    try { remember(previous, messageRecord); }
    catch (error) { errors.push('回想・エンド記録を保存できませんでした: ' + error.message); }
  }
  message(errors.join('\n'));
}
function renderNavigation() {
  let nav = document.querySelector('#navigation');
  if (!nav) {
    nav = el('nav', undefined, 'navigation');
    nav.id = 'navigation';
    document.querySelector('header').after(nav);
  }
  nav.replaceChildren(
    button('世界を選ぶ', renderHome),
    button('日々へ戻る', () => state ? renderStory() : renderHome()),
    button('メッセージ', renderMessages),
    button('回想', renderMemories),
    button('エンド一覧', renderEndings),
    button('人物', renderProfiles),
    button('設定', renderSettings),
    button('データ管理', renderData)
  );
}
function renderHome() {
  app.replaceChildren();
  const home = el('section', undefined, 'home');
  const intro = el('div');
  intro.append(
    el('p', 'CAMPUS DAYS, OUR OWN PACE', 'eyebrow'),
    el('h1', world.id === 'joseph' ? 'となりの、\nいつもの席' : config.title),
    el('div', undefined, 'rule'),
    el('p', world.intro, 'intro')
  );
  const chooser = el('label', '一緒に過ごす相手を選ぶ', 'world-picker');
  const select = el('select');
  select.id = 'world-select';
  for (const item of worlds) {
    const option = el('option', item.title);
    option.value = item.id;
    option.selected = item.id === world.id;
    select.append(option);
  }
  select.addEventListener('change', guard(async () => {
    select.disabled = true;
    try { await selectWorld(select.value); }
    finally { select.disabled = false; select.value = world.id; }
  }));
  chooser.append(select);
  intro.append(chooser, el('p', '世界ごとに、別の相手との日々と記録が残ります。', 'hint'));
  const card = el('form', undefined, 'start-card');
  card.append(el('h2', 'あなたの名前で、はじめる'));
  const row = el('div', undefined, 'name-row');
  for (const [id, caption, value] of [
    ['lastName', '姓', config.playerDefault.lastName],
    ['firstName', '名', config.playerDefault.firstName],
    ['displayName', '表示名', config.playerDefault.displayName ?? config.playerDefault.lastName + config.playerDefault.firstName]
  ]) {
    const label = el('label', caption);
    const input = document.createElement('input');
    Object.assign(input, { name: id, id, value, required: true, maxLength: 40, autocomplete: 'off' });
    label.append(input);
    (id === 'displayName' ? card : row).append(label);
  }
  card.insertBefore(row, card.children[1]);
  const start = el('button', '新しい日々をはじめる', 'primary');
  start.type = 'submit';
  card.append(start, button('記録からつづける', showSaves),
    el('p', '姓・名は呼びかけ、表示名は話者欄に使います。初周は関係値を表示しません。新しく始めるとオートセーブを更新します。残したい日々は手動枠へ保存してください。', 'hint'));
  card.addEventListener('submit', event => {
    event.preventDefault();
    guard(() => {
      const values = Object.fromEntries(new FormData(card));
      for (const key of Object.keys(values)) values[key] = values[key].trim();
      const meta = storage.readMeta();
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
      const next = createState(config, events, values, meta.playthroughCount + 1, seed);
      storage.read('auto');
      meta.playthroughCount += 1;
      storage.writeMeta(meta);
      state = next;
      renderStory(true);
    })();
  });
  home.append(intro, card);
  app.append(home);
}
function renderStory(scrollToTop = false) {
  if (!state) { renderHome(); return; }
  const previous = state;
  state = revealScene(state, config, events);
  const event = currentEvent(state, events);
  app.replaceChildren();

  const reply = recentMessageReply(state);
  if (reply) {
    const panel = el('section', undefined, 'message-card recent-reply');
    panel.append(el('h3', '返信が届きました', 'reply-heading'));
    for (const line of reply.lines.slice(-2)) {
      const bubble = el('div', undefined, 'bubble ' + line.speaker);
      bubble.append(speakerLabel(line.speaker, reply.player), el('p', line.text));
      panel.append(bubble);
    }
    app.append(panel);
  }

  const top = el('div', undefined, 'story-top');
  const title = el('div');
  const time = event.storyTime;
  const sceneMeta = el('div', undefined, 'scene-meta');
  sceneMeta.append(el('span', time.date + ' ・ ' + time.period, 'story-time'),
    el('span', event.location, 'location'));
  title.append(
    el('div', 'CHAPTER ' + String(event.chapter).padStart(2, '0'), 'chapter'),
    el('h2', event.title),
    sceneMeta
  );
  top.append(title, button('セーブ / ロード', showSaves));
  const layout = el('div', undefined, 'story-layout');
  const side = el('aside', undefined, 'scene-note');
  side.append(el('strong', event.message ? 'MESSAGE' : '今日も、ここで。'),
    el('p', event.message ? '言葉を選んで、\n返事を送る。' : '予定には書かない\n小さなひととき。'));
  const content = el('section');
  const card = el('div', undefined, event.message ? 'message-card' : 'text-card scene-page');
  let shownTime = time;
  for (const line of scenePageLines(state, events)) {
    if (line.storyTime && (line.storyTime.date !== shownTime.date || line.storyTime.period !== shownTime.period)) {
      shownTime = line.storyTime;
      card.append(el('p', shownTime.date + ' ・ ' + shownTime.period, 'scene-time-divider'));
    }
    if (!line.text) continue;
    const paragraph = el('div', undefined, event.message ? 'bubble ' + line.speaker : 'story-line ' + line.speaker);
    if (line.speaker !== 'narrator') paragraph.append(speakerLabel(line.speaker, state.player));
    paragraph.append(el('p', lineText(line), event.message ? undefined : 'story-text'));
    card.append(paragraph);
  }

  const actions = el('div', undefined, 'actions');
  if (event.ending) {
    const info = config.endingDescriptions[event.ending];
    const ending = el('div', undefined, 'ending');
    ending.append(el('p', event.ending + ' END', 'eyebrow'), el('h3', info.description),
      el('p', 'この日々も、一つのかけがえのない結末です。'),
      button('エンド一覧へ', renderEndings), button('タイトルへ', renderHome));
    actions.append(ending);
  } else {
    for (const choice of availableChoices(state, events)) {
      actions.append(button(formatText(choice.text, state.player, state, config), () => {
        const previous = state;
        state = choose(state, choice.id, config, events);
        const record = event.message ? state.messages.at(-1) : undefined;
        persist(previous, record);
        renderStory(true);
      }, 'choice'));
    }
  }
  const toolbar = el('div', undefined, 'toolbar');
  toolbar.append(button('タイトルへ', renderHome));
  content.append(card, actions, toolbar);
  layout.append(side, content);
  app.append(top, layout);
  if (state.settings.showValues && state.playthrough > 1 && storage.readMeta().endings.length) {
    const values = el('details', undefined, 'backlog');
    values.append(el('summary', '関係の記録を見る'));
    const labels = ['友情', '信頼', 'あなたの恋愛感情', config.characters[activeCharacterId(config)].name + 'の恋愛感情', '身体への意識', '私生活の親密さ', '生活の気楽さ'];
    RELATION_KEYS.forEach((key, index) => values.append(el('p', labels[index] + ': ' + state.relationships[activeCharacterId(config)][key])));
    app.append(values);
  }
  // The scene is now on the page. Reopening it must not duplicate unlocks.
  if (state !== previous) persist();
  else {
    try { remember(state); }
    catch (error) { message('回想・エンド記録を保存できませんでした: ' + error.message); }
  }
  if (scrollToTop) window.scrollTo({ top: 0, behavior: 'instant' });
}
function renderMessageRecord(record) {
  heading('あの日のやりとり', 'MESSAGES');
  const time = events.find(event => event.id === record.eventId)?.storyTime;
  if (time) app.append(el('p', time.date + ' ・ ' + time.period, 'story-time'));
  const panel = el('section', undefined, 'message-card archive');
  for (const line of record.lines) {
    const bubble = el('div', undefined, 'bubble ' + line.speaker);
    bubble.append(speakerLabel(line.speaker, record.player), el('p', line.text));
    panel.append(bubble);
  }
  app.append(panel, button('メッセージ一覧へ', renderMessages, 'primary'));
}
function renderMessages() {
  heading('ふたりのメッセージ', 'MESSAGES');
  app.append(el('p', '今プレイしている日々のやりとりです。過去の周回は「回想」から読み返せます。', 'hint'));
  if (!state?.messages.length) app.append(el('p', 'まだやりとりはありません。日々を重ねると届きます。', 'empty-state'));
  else for (const record of state.messages) {
    const event = events.find(e => e.id === record.eventId);
    app.append(button(event.title + ' ／ ' + record.player.displayName, () => renderMessageRecord(record), 'collection-item'));
  }
}
function renderMemories() {
  const meta = storage.readMeta();
  heading('日々のかけら', 'MEMORIES');
  app.append(el('p', '読んだ当時の名前と言葉を、そのまま残しています。読み返しても今のプレイは進みません。', 'hint'));
  if (!meta.memories.length) app.append(el('p', '場面を読み終えると、ここに記録されます。', 'empty-state'));
  for (const memory of [...meta.memories].reverse()) {
    const caption = memory.title + ' ／ ' + memory.playthrough + '周目・' + memory.player.displayName + ' ／ ' + new Date(memory.recordedAt).toLocaleDateString('ja-JP');
    app.append(button(caption, () => {
      heading(memory.title, 'MEMORY / ' + memory.playthrough + '周目');
      app.append(el('p', memory.location + ' ・ ' + new Date(memory.recordedAt).toLocaleString('ja-JP'), 'hint'));
      const article = el('article', undefined, 'memory-body');
      for (const line of memory.lines) {
        article.append(speakerLabel(line.speaker, memory.player), el('p', line.text));
      }
      app.append(article, button('回想一覧へ', renderMemories));
    }, 'collection-item'));
  }
}
function renderEndings() {
  const meta = storage.readMeta();
  heading('それぞれの、つづき', 'ENDINGS / ' + meta.endings.length + ' OF 6');
  app.append(el('p', 'どの結末も正規のエンドです。それぞれの関係の先に、日常が続いています。', 'hint'));
  const grid = el('div', undefined, 'collection-grid');
  for (const id of ENDINGS) {
    const info = config.endingDescriptions[id];
    const card = el('section', undefined, 'collection-card');
    card.append(el('p', id, 'eyebrow'), el('h3', info.title),
      el('p', meta.endings.includes(id) ? info.description : 'まだ、この日々を迎えていません。'),
      el('span', meta.endings.includes(id) ? '記録済み' : '未到達', 'hint'));
    grid.append(card);
  }
  app.append(grid);
}
function renderProfiles() {
  heading('いつもの顔ぶれ', 'PEOPLE');
  const grid = el('div', undefined, 'collection-grid');
  const present = new Set(['player', activeCharacterId(config), ...events.flatMap(event =>
    [event.characterId, ...event.body.map(line => line.speaker)])]);
  for (const [id, person] of Object.entries(config.characters)) {
    if (!present.has(id)) continue;
    const card = el('section', undefined, 'collection-card');
    card.append(el('p', config.auCharacters[id].role, 'eyebrow'),
      el('h3', id === 'player' ? state?.player.displayName ?? 'あなた' : person.name),
      el('p', Number.isFinite(person.heightCm) ? '身長 ' + person.heightCm + 'cm' + (id === 'player' ? '（既定値）' : '') : '身長 未確認', 'hint'),
      el('p', person.profile ?? 'ボードゲームのサークルとロボット教室のバイトを行き来する、大学生活の主人公。'),
      el('p', id === 'player' ? '主人公・20歳以上' : config.auCharacters[id].routeEnabled ? 'この世界の相手・20歳以上' : '大切な友人・20歳以上', 'hint'));
    grid.append(card);
  }
  app.append(grid);
}
function renderSettings() {
  heading('心地よい読み方', 'SETTINGS');
  if (!state) {
    app.append(el('p', '日々を始めるか記録を読み込むと、この周回の設定を変えられます。'));
    return;
  }
  const cleared = storage.readMeta().endings.length > 0 && state.playthrough > 1;
  const panel = el('section', undefined, 'settings-panel');
  for (const [key, caption, enabled] of [
    ['shortAfterglow', '暗転後の余韻を短くする（合意の場面は省略しません）', true],
    ['showValues', '関係値を任意で表示する（クリア後の2周目以降）', cleared]
  ]) {
    const label = el('label', undefined, 'check-label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.settings[key] && enabled;
    input.disabled = !enabled;
    input.addEventListener('change', guard(() => { state.settings[key] = input.checked; persist(); }));
    label.append(input, document.createTextNode(caption));
    panel.append(label);
  }
  panel.append(el('p', '初周の関係値は表示しません。設定はこのプレイのセーブに保存されます。', 'hint'));
  app.append(panel);
}
function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderData() {
  heading('日々の持ち運び', 'SAVE DATA');
  app.append(el('p', '手動3枠・オートセーブ・回想・エンド記録をまとめて保存します。復元は現在の全枠と周回記録を置き換えます。', 'intro'));
  const toolbar = el('div', undefined, 'toolbar');
  toolbar.append(button('JSONバックアップを書き出す', () => download(storage.exportBackup(), 'jojo-university-' + world.id + '-backup.json'), 'primary'),
    button('破損時の生データを救出する', () => download(storage.rawBackup(), 'jojo-university-' + world.id + '-raw-rescue.json')));
  app.append(toolbar, el('p', '生データ救出は壊れた内容もそのまま保存します。通常の復元用JSONとは別形式です。', 'hint'));
  const label = el('label', '復元するJSONバックアップ');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.id = 'import-file';
  label.append(input);
  const preview = el('section', undefined, 'import-preview');
  input.addEventListener('change', guard(async () => {
    preview.replaceChildren();
    const selectedWorld = world.id;
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('10MBを超えるファイルは復元できません');
    let value;
    try { value = JSON.parse(await file.text()); }
    catch { throw new Error('JSONを読み取れません。現在の記録は変更していません'); }
    if (world.id !== selectedWorld) return;
    storage.validateBackup(value);
    preview.append(el('p', Object.values(value.slots).filter(Boolean).length + '枠の保存、' + value.meta.memories.length + '件の回想、' + value.meta.endings.length + '件のエンド記録を復元します。'));
    preview.append(button('復元前データを保存して、全枠を復元する', () => {
      download(storage.rawBackup(), 'jojo-university-' + world.id + '-before-restore.json');
      storage.importBackup(value);
      state = null;
      message('バックアップを復元しました。記録を読み込んで再開できます。復元前の生データも保持しています。');
      preview.replaceChildren(el('p', '復元しました。'));
      showSaves();
    }, 'primary'));
  }));
  app.append(label, preview);
}
function showSaves() {
  document.querySelector('#save-title').textContent = worldName() + 'の日々の記録';
  const slots = document.querySelector('#slots');
  slots.replaceChildren();
  for (const slot of SAVE_SLOTS) {
    const row = el('section', undefined, 'slot');
    row.append(el('strong', slot === 'auto' ? 'オートセーブ' : '記録 ' + slot));
    let save = null, invalid = false;
    try {
      save = storage.read(slot);
      row.append(el('p', save
        ? save.state.player.displayName + ' / 第' + save.state.chapter + '章 ' + currentEvent(save.state, events).title + '\n' + new Date(save.savedAt).toLocaleString('ja-JP')
        : 'まだ記録がありません'));
    } catch (error) { invalid = true; row.append(el('p', error.message)); }
    if (slot !== 'auto') {
      const saveButton = button('ここに保存', () => {
        storage.write(slot, state);
        message('記録 ' + slot + ' に保存しました');
        showSaves();
      });
      saveButton.disabled = !state || invalid;
      row.append(saveButton);
    }
    const loadButton = button('読み込む', () => {
      const loaded = storage.read(slot);
      if (!loaded) throw new Error('記録がありません');
      state = structuredClone(loaded.state);
      dialog.close();
      message('記録を読み込みました');
      renderStory(true);
    });
    loadButton.disabled = !save;
    row.append(loadButton);
    slots.append(row);
  }
  if (!dialog.open) dialog.showModal();
}
document.querySelector('#close-saves').addEventListener('click', () => dialog.close());
document.querySelector('#home-link').addEventListener('click', event => {
  event.preventDefault();
  if (config) renderHome();
});
try {
  [baseConfig, baseEvents] = await Promise.all(['data/config.json', 'data/events.json'].map(url => readJson(url)));
  const listedWorlds = await readJson('data/worlds.json', true);
  worlds = listedWorlds === undefined ? defaultWorlds(baseConfig) : listedWorlds;
  validateWorlds(worlds);
  await selectWorld('joseph');
} catch (error) {
  app.replaceChildren(el('h1', '読み込みを完了できませんでした'), el('p', error.message));
}
