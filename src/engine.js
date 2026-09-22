import { FORMAT_VERSION, RELATION_KEYS, activeCharacterId, characterIds, assert, meets, validatePlayer, validateState } from './model.js';
export function createState(config, events, player, playthrough = 1, seed = 1) {
  validatePlayer(player);
  const event = events.find(e => e.id === config.startEvent);
  const state = {
    version: FORMAT_VERSION,
    player: {
      ...player
    },
    chapter: event.chapter,
    eventId: event.id,
    textPosition: 0,
    route: null,
    relationships: Object.fromEntries(characterIds(config).filter(id => id !== 'player').map(id => [id,
      id === activeCharacterId(config) ? {...config.initialRelationship} : Object.fromEntries(RELATION_KEYS.map(key => [key, 0]))
    ])),
    flags: {},
    readEvents: [],
    choiceLog: [],
    messages: [],
    seed,
    rngState: seed,
    playthrough,
    settings: {
      shortAfterglow: false,
      showValues: false
    }
  };
  if (activeCharacterId(config) !== 'joseph') state.worldId = activeCharacterId(config);
  validateState(state, config, events);
  return state;
}
export const currentEvent = (state, events) => events.find(e => e.id === state.eventId);
export const visibleLines = (state, events) => currentEvent(state, events).body.filter(l => meets(state, l.when));
// Resolve from already-read lines so loading and shortened aftermath preserve the scene clock.
export function currentStoryTime(state, events) {
  let time = currentEvent(state, events).storyTime;
  for (const line of visibleLines(state, events).slice(0, state.textPosition + 1)) {
    if (line.storyTime) time = line.storyTime;
  }
  return time;
}
export const atChoices = (state, events) => state.textPosition === visibleLines(state, events).length - 1;
export const availableChoices = (state, events) => atChoices(state, events) ? currentEvent(state, events).choices.filter(c => meets(state, c.when)) : [];
export function formatText(text, player, state, config, character = activeCharacterId(config)) {
  const address = state && config ? config.auCharacters[character].addressing.find(rule => meets(state, rule.when)).text : '{player.firstName}';
  return text.replaceAll('{address}', address).replace(/\{player\.(lastName|firstName|displayName)\}/g, (_, key) => player[key]);
}
export function snapshotLines(state, config, events) {
  return visibleLines(state, events).map(l => ({
    speaker: l.speaker,
    text: formatText(l.text, state.player, state, config, l.speaker === 'narrator' ? activeCharacterId(config) : l.speaker)
  }));
}
export function makeMemory(state, config, events, messageRecord) {
  const event = currentEvent(state, events);
  return {
    id: state.playthrough + ':' + event.id + (messageRecord ? ':' + messageRecord.choiceId : ''),
    eventId: event.id,
    title: event.title,
    location: event.location,
    player: {
      ...state.player
    },
    playthrough: state.playthrough,
    recordedAt: messageRecord?.recordedAt ?? new Date().toISOString(),
    lines: messageRecord?.lines ?? snapshotLines(state, config, events)
  };
}
// Page reading completes only the current scene; choices keep all game effects.
export function revealScene(state, config, events) {
  const position = visibleLines(state, events).length - 1;
  if (state.textPosition === position && state.readEvents.includes(state.eventId)) return state;
  const next = structuredClone(state);
  next.textPosition = position;
  if (!next.readEvents.includes(next.eventId)) next.readEvents.push(next.eventId);
  validateState(next, config, events);
  return next;
}

// Time-only entries preserve transitions even when the aftermath text is shortened.
export function scenePageLines(state, events) {
  const lines = visibleLines(state, events);
  if (!state.settings.shortAfterglow || currentEvent(state, events).rating !== 'fade') return lines;
  const fade = lines.findIndex(line => line.text === '——暗転——');
  if (fade < 0) return lines;
  return lines.flatMap((line, index) => {
    if (index <= fade || index === lines.length - 1) return [line];
    return line.storyTime ? [{ storyTime: line.storyTime }] : [];
  });
}

export function recentMessageReply(state) {
  const choice = state.choiceLog.at(-1);
  const record = state.messages.at(-1);
  return choice && record && choice.eventId === record.eventId && choice.choiceId === record.choiceId
    ? record : null;
}

export function advance(state, config, events) {
  assert(!atChoices(state, events), '本文は最後まで表示されています');
  const next = structuredClone(state);
  next.textPosition += 1;
  // Shortening changes only the displayed aftermath, never consent or choices.
  if (next.settings.shortAfterglow && currentEvent(next, events).rating === 'fade') {
    const lines = visibleLines(next, events);
    const fade = lines.findIndex(l => l.text === '——暗転——');
    if (fade >= 0 && state.textPosition === fade) next.textPosition = lines.length - 1;
  }
  if (atChoices(next, events) && !next.readEvents.includes(next.eventId)) next.readEvents.push(next.eventId);
  validateState(next, config, events);
  return next;
}
export function choose(state, choiceId, config, events) {
  const choice = availableChoices(state, events).find(c => c.id === choiceId);
  assert(choice, '現在選べない選択肢です');
  const next = structuredClone(state);
  if (currentEvent(state, events).message) {
    const reply = choice.replyVariants.find(r => meets(state, r.when));
    next.messages.push({
      eventId: state.eventId,
      choiceId,
      player: {
        ...state.player
      },
      playthrough: state.playthrough,
      recordedAt: new Date().toISOString(),
      lines: [...snapshotLines(state, config, events), {
        speaker: 'player',
        text: formatText(choice.text, state.player, state, config)
      }, {
        speaker: activeCharacterId(config),
        text: formatText(reply.text, state.player, state, config)
      }]
    });
  }
  for (const [character, values] of Object.entries(config.effects[choice.effect] ?? {})) for (const [key, delta] of Object.entries(values)) next.relationships[character][key] = Math.max(0, Math.min(100, next.relationships[character][key] + delta));
  for (const flag of choice.setFlags ?? []) next.flags[flag] = true;
  if (choice.lockRoute) next.route = choice.lockRoute;
  next.choiceLog.push({
    eventId: state.eventId,
    choiceId
  });
  if (!next.readEvents.includes(state.eventId)) next.readEvents.push(state.eventId);
  let target = choice.next;
  if (choice.randomNext) {
    // xorshift32: the saved current state determines the same encounter on load.
    let x = next.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    next.rngState = x >>> 0;
    target = choice.randomNext[next.rngState % choice.randomNext.length];
  }
  const event = events.find(e => e.id === target);
  assert(meets(next, event.when), '次のイベントの条件を満たしていません');
  next.eventId = event.id;
  next.chapter = event.chapter;
  next.textPosition = 0;
  validateState(next, config, events);
  return next;
}
