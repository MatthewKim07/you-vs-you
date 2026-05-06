import { LevelData } from './level';
import { PlayerProfile } from './telemetry';

export function introMessage(): string {
  return 'This game learns how you play and adapts to beat you.';
}

export function levelStartMessage(level: LevelData, profile: PlayerProfile, levelNum: number): string {
  const notes = level.aiDebug?.notes ?? [];
  const counters = level.aiDebug?.counterTargets ?? [];

  if (counters.includes('overusesChoiceJump')) return 'You always jump at choices. I added ceilings after them.';
  if (counters.includes('overusesChoiceCrouch')) return 'You always crouch at choices. I placed spikes after them.';
  if (counters.includes('jumpBiased')) return 'You jump too often. I built this around that.';
  if (counters.includes('crouchBiased')) return 'You rely on crouching. I added gaps to fix that.';
  if (counters.includes('diesToGaps') || counters.includes('platformWeak')) return 'Gaps keep killing you. More of them this time.';
  if (counters.includes('diesToSpikes')) return 'You keep hitting spikes. Same plan, more pressure.';
  if (counters.includes('lateReactor')) return 'Your reactions are slow. I tightened the windows.';
  if (counters.includes('predictablePattern')) return 'Your route is predictable. I switched it up.';

  const landingNote = notes.find((n) => n.includes('near landing'));
  const deathNote = notes.find((n) => n.includes('near death'));

  const landingX = extractPx(landingNote);
  if (landingX !== null) {
    return `You landed safely near ${landingX}px. I changed it.`;
  }

  const deathX = extractPx(deathNote);
  if (deathX !== null) {
    return `You died near ${deathX}px. I remembered that.`;
  }

  if (profile.jumpStyle === 'early') return "You jump early. Let's test that.";
  if (profile.jumpStyle === 'late') return 'You jump late. I shifted the timing.';
  if (profile.jumpStyle === 'balanced') return 'Too predictable. I mixed the spacing.';
  return `Level ${levelNum}. I am adapting from your last run.`;
}

export function levelCompleteMessage(lastLandingX: number | undefined, style: PlayerProfile['jumpStyle']): string {
  if (lastLandingX !== undefined) {
    return `You landed safely near ${Math.round(lastLandingX)}px. I will change that.`;
  }
  if (style === 'early') return 'You jump early. I noticed.';
  if (style === 'late') return 'You wait late. I noticed.';
  return 'You avoided that easily. I am adapting.';
}

export function deathMessage(
  reason: 'spike' | 'gap',
  deathX: number,
  style: PlayerProfile['jumpStyle'],
): string {
  const x = Math.round(deathX);
  if (reason === 'gap') return `You fell near ${x}px. I will pressure that lane.`;
  if (style === 'early') return `Hit near ${x}px. Early jumps are risky now.`;
  return `You hit danger near ${x}px. I am learning that spot.`;
}

function extractPx(note: string | undefined): number | null {
  if (!note) return null;
  const match = note.match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}
