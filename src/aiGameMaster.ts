import { LevelData } from './level';
import { PlayerProfile } from './telemetry';

export function introMessage(): string {
  return "I'm watching. 👀";
}

export function levelStartMessage(level: LevelData, profile: PlayerProfile, levelNum: number): string {
  const notes = level.aiDebug?.notes ?? [];
  const counters = level.aiDebug?.counterTargets ?? [];

  if (counters.includes('overusesChoiceJump')) return 'Jump again. Ceilings await. 😏';
  if (counters.includes('overusesChoiceCrouch')) return 'Crouch again. Spikes await. 😈';
  if (counters.includes('jumpBiased')) return 'Jump first, think never. 😂';
  if (counters.includes('crouchBiased')) return 'Gaps ahead. Good luck. 🕳️';
  if (counters.includes('diesToGaps') || counters.includes('platformWeak')) return "More gaps. You're welcome. 🕳️";
  if (counters.includes('diesToSpikes')) return 'Spikes again. Just for you. 🔺';
  if (counters.includes('lateReactor')) return 'Tighter windows. Stay sharp. ⏱️';
  if (counters.includes('predictablePattern')) return 'Boring pattern. I changed it. 😴';

  const landingNote = notes.find((n) => n.includes('near landing'));
  const deathNote = notes.find((n) => n.includes('near death'));

  if (extractPx(landingNote) !== null) return 'I moved that safe spot. 😉';
  if (extractPx(deathNote) !== null) return 'I remember where you died. 🧠';

  if (profile.jumpStyle === 'early') return 'You jump too early. 🐇';
  if (profile.jumpStyle === 'late') return 'You wait too long. 🐢';
  if (profile.jumpStyle === 'balanced') return 'I mixed up the rhythm. 🎵';
  return `Level ${levelNum}. Adapting. 🤖`;
}

export function levelCompleteMessage(_lastLandingX: number | undefined, style: PlayerProfile['jumpStyle']): string {
  if (style === 'early') return "Lucky. Won't happen again. 😤";
  if (style === 'late') return 'Got away this time. 😒';
  return 'You avoided it. Adjusting. 🤖';
}

export function deathMessage(
  reason: 'spike' | 'gap',
  _deathX: number,
  style: PlayerProfile['jumpStyle'],
): string {
  if (reason === 'gap') return 'Fell again! Ha! 🕳️';
  if (style === 'early') return 'Too early! 😂';
  return 'Got you! 😈';
}

function extractPx(note: string | undefined): number | null {
  if (!note) return null;
  const match = note.match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}
