import { LevelData } from './level';
import { PlayerProfile } from './telemetry';

export function introMessage(): string {
  return 'This game learns how you play and adapts to beat you.';
}

export function levelStartMessage(level: LevelData, profile: PlayerProfile, levelNum: number): string {
  const notes = level.aiDebug?.notes ?? [];
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

  if (profile.jumpStyle === 'early') return 'You jump early. Let’s test that.';
  if (profile.jumpStyle === 'late') return 'You jump late. I shifted the timing.';
  if (profile.jumpStyle === 'balanced') return 'Too predictable. I mixed the spacing.';
  return `Level ${levelNum}. I’m adapting from your last run.`;
}

export function levelCompleteMessage(lastLandingX: number | undefined, style: PlayerProfile['jumpStyle']): string {
  if (lastLandingX !== undefined) {
    return `You landed safely near ${Math.round(lastLandingX)}px. I’ll change that.`;
  }
  if (style === 'early') return 'You jump early. I noticed.';
  if (style === 'late') return 'You wait late. I noticed.';
  return 'You avoided that easily. I’m adapting.';
}

export function deathMessage(
  reason: 'spike' | 'gap',
  deathX: number,
  style: PlayerProfile['jumpStyle'],
): string {
  const x = Math.round(deathX);
  if (reason === 'gap') return `You fell near ${x}px. I’ll pressure that lane.`;
  if (style === 'early') return `Hit near ${x}px. Early jumps are risky now.`;
  return `You hit danger near ${x}px. I’m learning that spot.`;
}

function extractPx(note: string | undefined): number | null {
  if (!note) return null;
  const match = note.match(/(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}
