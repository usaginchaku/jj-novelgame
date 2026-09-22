/**
 * Canonical runtime contract. State/save v1 remain compatible with milestone B.
 * @typedef {{lastName:string,firstName:string,displayName:string}} Player
 * @typedef {{friendship:number,trust:number,romancePlayer:number,romanceChar:number,desire:number,intimacy:number,comfort:number}} Relationship
 * @typedef {{min?:Object<string,number>,flags?:string[],notFlags?:string[],route?:string|null}} Condition
 * @typedef {{date:string,period:'朝'|'昼'|'夕方'|'夜'}} StoryTime
 * @typedef {{speaker:string,text:string,when?:Condition,storyTime?:StoryTime}} Line
 * @typedef {{id:string,text:string,next:string,effect?:string,when?:Condition,setFlags?:string[],lockRoute?:string,randomNext?:string[],replyVariants?:Array<{text:string,when?:Condition}>}} Choice
 * @typedef {{id:string,chapter:number,title:string,location:string,storyTime:StoryTime,characterId:string,rating:'general'|'fade',tags:string[],body:Line[],choices:Choice[],when?:Condition,ending?:string,message?:boolean}} Event
 * @typedef {{eventId:string,choiceId:string,player:Player,playthrough:number,recordedAt:string,lines:Line[]}} MessageRecord
 * @typedef {{id:string,eventId:string,title:string,location:string,player:Player,playthrough:number,recordedAt:string,lines:Line[]}} Memory
 * @typedef {{version:number,player:Player,chapter:number,eventId:string,textPosition:number,worldId?:string,route:null|string,relationships:Object<string,Relationship>,flags:Object<string,boolean>,readEvents:string[],choiceLog:Array<{eventId:string,choiceId:string}>,messages:MessageRecord[],seed:number,rngState:number,playthrough:number,settings:{shortAfterglow:boolean,showValues:boolean}}} State
 * @typedef {{formatVersion:number,scenarioVersion:string,savedAt:string,state:State}} Save
 * @typedef {{formatVersion:number,playthroughCount:number,endings:string[],memories:Memory[]}} Meta
 * @typedef {{kind:'jojo-university-backup',worldId?:string,formatVersion:number,exportedAt:string,slots:Object<string,Save|null>,meta:Meta}} Backup
 */
export const FORMAT_VERSION = 1;
export const RELATION_KEYS = ['friendship', 'trust', 'romancePlayer', 'romanceChar', 'desire', 'intimacy', 'comfort'];
export const ENDINGS = ['FRIEND', 'LOVE_A', 'LOVE_B', 'FWB', 'FWB_TO_LOVE', 'SPECIAL'];
export const CHARACTER_IDS = ['player', 'joseph', 'caesar', 'kakyoin'];
export function assert(ok, message) {
  if (!ok) throw new Error(message);
}
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const text = (v, max = 20000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const safeId = v => text(v, 100) && !['__proto__', 'constructor', 'prototype'].includes(v);
export const activeCharacterId = config => config?.activeCharacterId ?? 'joseph';
export const characterIds = config => [...new Set([...CHARACTER_IDS, activeCharacterId(config), ...(config?.supportingCharacterIds ?? [])])];
export function condition(value, config) {
  if (value === undefined) return;
  assert(object(value), '条件が不正です');
  assert(Object.keys(value).every(k => ['min', 'flags', 'notFlags', 'route'].includes(k)), '未知の条件です');
  if (value.min !== undefined) assert(object(value.min), '数値条件が不正です');
  for (const [key, min] of Object.entries(value.min ?? {})) assert(RELATION_KEYS.includes(key) && integer(min, 0, 100), '関係条件が不正です');
  for (const key of ['flags', 'notFlags']) if (value[key] !== undefined) assert(Array.isArray(value[key]) && value[key].every(safeId), 'フラグ条件が不正です');
  if ('route' in value) assert(value.route === null || value.route === activeCharacterId(config), 'ルート条件が不正です');
}
function validateStoryTime(value) {
  assert(object(value) && text(value.date, 32) && ['朝', '昼', '夕方', '夜'].includes(value.period), '物語の日付・時間帯が不正です');
}
function validateLine(line, snapshot = false, config) {
  assert(object(line) && [...characterIds(config), 'narrator'].includes(line.speaker) && text(line.text), '本文の話者・内容が不正です');
  if (!snapshot) {
    condition(line.when, config);
    if (line.storyTime !== undefined) validateStoryTime(line.storyTime);
    for (const token of line.text.match(/\{[^}]+\}/g) ?? []) assert(/^\{(address|player\.(lastName|firstName|displayName))\}$/.test(token), '未知の本文トークンです');
  }
}
export function validateScenario(config, events) {
  assert(object(config) && text(config.scenarioVersion), 'シナリオ設定が不正です');
  const active = activeCharacterId(config);
  assert(/^[a-z][a-z0-9_]*$/.test(active) && safeId(active) && !['player', 'narrator'].includes(active), '世界の人物IDが不正です');
  assert(config.supportingCharacterIds === undefined || Array.isArray(config.supportingCharacterIds)
    && config.supportingCharacterIds.every(id => /^[a-z][a-z0-9_]*$/.test(id) && safeId(id) && !['player', 'narrator', active].includes(id)), '友情人物IDが不正です');
  const characters = characterIds(config);
  assert(Array.isArray(events) && events.length > 0, 'イベントがありません');
  assert(JSON.stringify(Object.keys(config.characters).sort()) === JSON.stringify([...characters].sort()), '登場人物が対象外です');
  for (const c of Object.values(config.characters)) assert(c.adult === true, '成人設定が必要です');
  assert(object(config.auCharacters) && Object.keys(config.auCharacters).length === characters.length && characters.every(id => config.auCharacters[id]?.routeEnabled === (id === active)), '攻略対象が不正です');
  for (const id of characters) {
    const au = config.auCharacters[id];
    assert(object(au) && text(au.role) && Array.isArray(au.addressing) && au.addressing.length > 0, 'AU設定が不正です');
    assert(!au.addressing.at(-1).when, '呼称の既定値がありません');
    for (const rule of au.addressing) {
      condition(rule.when, config);
      assert(text(rule.text, 100), '呼称が不正です');
    }
  }
  const ids = new Set(events.map(e => e.id));
  assert(ids.size === events.length && ids.has(config.startEvent), 'イベントIDが重複または開始先が不正です');
  for (const changes of Object.values(config.effects)) for (const [character, values] of Object.entries(changes)) {
    assert(characters.includes(character) && character !== 'player', '効果の人物が不正です');
    for (const [key, value] of Object.entries(values)) {
      assert(RELATION_KEYS.includes(key) && integer(value, -100, 100), '効果の数値が不正です');
      assert(character === active || !['romancePlayer', 'romanceChar', 'desire', 'intimacy'].includes(key), 'NPCへの恋愛効果は禁止です');
    }
  }
  for (const event of events) {
    assert(safeId(event.id) && text(event.title) && text(event.location) && integer(event.chapter, 1, 100), 'イベント情報が不正です');
    assert(characters.includes(event.characterId) && ['general', 'fade'].includes(event.rating), 'イベント人物・区分が不正です');
    assert(Array.isArray(event.tags) && event.tags.every(safeId), 'タグが不正です');
    condition(event.when, config);
    validateStoryTime(event.storyTime);
    assert(Array.isArray(event.body) && event.body.length > 0 && event.body.some(l => !l.when), '本文がありません');
    event.body.forEach(l => validateLine(l, false, config));
    assert(Array.isArray(event.choices), '選択肢が不正です');
    assert(event.ending ? ENDINGS.includes(event.ending) && event.choices.length === 0 : event.choices.length > 0, '終端または選択肢が不正です');
    if (event.message) assert(event.choices.length >= 2 && event.choices.length <= 4, 'メッセージ返信数が不正です');
    assert(new Set(event.choices.map(c => c.id)).size === event.choices.length, '選択肢IDが重複しています');
    for (const c of event.choices) {
      assert(safeId(c.id) && text(c.text) && ids.has(c.next), '選択肢の遷移先が不正です');
      condition(c.when, config);
      assert(c.effect === undefined || Object.hasOwn(config.effects, c.effect), '未定義の数値効果です');
      assert(c.lockRoute === undefined || c.lockRoute === active, 'ルート確定先が不正です');
      assert(c.setFlags === undefined || Array.isArray(c.setFlags) && c.setFlags.every(safeId), 'フラグが不正です');
      if (c.randomNext !== undefined) assert(Array.isArray(c.randomNext) && c.randomNext.length > 0 && c.randomNext.every(id => ids.has(id)) && c.randomNext.includes(c.next), '偶発遷移が不正です');
      if (c.replyVariants !== undefined) {
        assert(event.message && Array.isArray(c.replyVariants) && c.replyVariants.length > 0 && !c.replyVariants.at(-1).when, '返信の既定値がありません');
        for (const reply of c.replyVariants) {
          condition(reply.when, config);
          validateLine({
            speaker: active,
            text: reply.text
          }, false, config);
        }
      }
      if (event.message) assert(c.replyVariants, '返信本文がありません');
    }
  }
  const seen = new Set();
  function visit(id, stack) {
    assert(!stack.has(id), 'イベントに循環があります');
    if (seen.has(id)) return;
    const nextStack = new Set(stack).add(id);
    seen.add(id);
    for (const c of events.find(e => e.id === id).choices) for (const target of c.randomNext ?? [c.next]) visit(target, nextStack);
  }
  visit(config.startEvent, new Set());
  assert(seen.size === events.length, '開始から参照されないイベントがあります');
  return true;
}
export function validatePlayer(player) {
  assert(object(player), '主人公名が不正です');
  for (const key of ['lastName', 'firstName', 'displayName']) assert(text(player[key], 40) && player[key].trim() === player[key] && !/[\u0000-\u001f\u007f]/.test(player[key]), '姓・名・表示名は各1〜40文字で入力してください');
}
export function meets(state, when) {
  if (!when) return true;
  return Object.entries(when.min ?? {}).every(([key, min]) => state.relationships[state.worldId ?? 'joseph'][key] >= min) && (when.flags ?? []).every(f => state.flags[f] === true) && (when.notFlags ?? []).every(f => !state.flags[f]) && (!Object.hasOwn(when, 'route') || state.route === when.route);
}
function validateRecord(record, config) {
  assert(object(record) && safeId(record.eventId) && integer(record.playthrough, 1, Number.MAX_SAFE_INTEGER) && date(record.recordedAt), '記録情報が不正です');
  validatePlayer(record.player);
  assert(Array.isArray(record.lines) && record.lines.length > 0 && record.lines.length <= 100, '記録本文が不正です');
  record.lines.forEach(l => validateLine(l, true, config));
}
export function validateState(state, config, events) {
  assert(object(state) && state.version === FORMAT_VERSION, '未対応のプレイデータ形式です');
  const active = activeCharacterId(config);
  assert(active === 'joseph' ? state.worldId === undefined || state.worldId === 'joseph' : state.worldId === active, '異なる世界のプレイデータです');
  validatePlayer(state.player);
  const event = events.find(e => e.id === state.eventId);
  assert(event && state.chapter === event.chapter, '保存されたイベントが見つかりません');
  assert(state.route === null || state.route === active, '保存されたルートが不正です');
  assert(object(state.relationships), '関係データが不正です');
  assert(Object.keys(state.relationships).sort().join(',') === characterIds(config).filter(id => id !== 'player').sort().join(','), '未知の関係人物です');
  for (const character of characterIds(config).filter(id => id !== 'player')) {
    const values = state.relationships[character];
    assert(object(values), '関係データが不足しています');
    for (const key of RELATION_KEYS) {
      assert(integer(values[key], 0, 100), '関係値が範囲外です');
      assert(character === active || !['romancePlayer', 'romanceChar', 'desire', 'intimacy'].includes(key) || values[key] === 0, 'NPCの恋愛値が不正です');
    }
  }
  assert(object(state.flags) && Object.entries(state.flags).every(([k, v]) => safeId(k) && typeof v === 'boolean'), 'フラグが不正です');
  assert(meets(state, event.when), 'イベントの条件を満たしていません');
  const lines = event.body.filter(l => meets(state, l.when));
  assert(integer(state.textPosition, 0, lines.length - 1), '本文位置が不正です');
  assert(Array.isArray(state.readEvents) && state.readEvents.every(id => events.some(e => e.id === id)), '既読情報が不正です');
  assert(Array.isArray(state.choiceLog) && state.choiceLog.length <= events.length && state.choiceLog.every(item => object(item) && events.some(e => e.id === item.eventId && e.choices.some(c => c.id === item.choiceId))), '選択履歴が不正です');
  assert(Array.isArray(state.messages) && state.messages.length <= events.length, 'メッセージ履歴が不正です');
  for (const record of state.messages) {
    validateRecord(record, config);
    assert(safeId(record.choiceId) && events.some(e => e.id === record.eventId && e.message && e.choices.some(c => c.id === record.choiceId)), 'メッセージ参照が不正です');
  }
  assert(integer(state.seed, 1, 0xffffffff) && integer(state.rngState, 1, 0xffffffff), '乱数状態が不正です');
  assert(integer(state.playthrough, 1, Number.MAX_SAFE_INTEGER), '周回番号が不正です');
  assert(object(state.settings) && typeof state.settings.shortAfterglow === 'boolean' && typeof state.settings.showValues === 'boolean', '設定が不正です');
  return true;
}
export function validateSave(save, config, events) {
  assert(object(save) && save.formatVersion === FORMAT_VERSION, '未対応のセーブ形式です。元データは保持しています');
  assert(save.scenarioVersion === config.scenarioVersion, '異なるシナリオ版のセーブです。元データは保持しています');
  assert(date(save.savedAt), '保存日時が不正です');
  validateState(save.state, config, events);
  return true;
}
export function validateMeta(meta, config) {
  assert(object(meta) && meta.formatVersion === FORMAT_VERSION, '未対応の周回記録です。元データは保持しています');
  assert(integer(meta.playthroughCount, 0, Number.MAX_SAFE_INTEGER) && Array.isArray(meta.endings) && meta.endings.every(id => ENDINGS.includes(id)) && Array.isArray(meta.memories) && meta.memories.length <= 10000, '周回記録が不正です');
  for (const memory of meta.memories) {
    validateRecord(memory, config);
    assert(text(memory.id, 220) && text(memory.title, 200) && text(memory.location, 200), '回想情報が不正です');
  }
  assert(new Set(meta.memories.map(m => m.id)).size === meta.memories.length, '回想IDが重複しています');
  return true;
}
