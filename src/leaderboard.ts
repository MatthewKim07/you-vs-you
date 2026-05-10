import { SupabaseClient } from '@supabase/supabase-js';

export interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  isMe: boolean;
}

export interface LeaderboardResult {
  top: LeaderboardEntry[];
  myEntry: LeaderboardEntry | null;
}

export async function fetchLeaderboard(
  client: SupabaseClient,
  myUserId: string | null,
): Promise<LeaderboardResult> {
  // Step 1: fetch top 10 scores
  const { data: scores, error: scoresErr } = await client
    .from('infinite_scores')
    .select('user_id, best_score')
    .order('best_score', { ascending: false })
    .limit(10);

  if (scoresErr) throw new Error(`scores fetch: ${scoresErr.message}`);
  if (!scores || scores.length === 0) return { top: [], myEntry: null };

  // Step 2: fetch usernames for those user_ids in one query
  const ids = (scores as { user_id: string; best_score: number }[]).map((r) => r.user_id);
  const { data: profiles } = await client
    .from('profiles')
    .select('id, username')
    .in('id', ids);

  const nameMap: Record<string, string> = {};
  for (const p of (profiles ?? []) as { id: string; username: string }[]) {
    nameMap[p.id] = p.username;
  }

  const top: LeaderboardEntry[] = (scores as { user_id: string; best_score: number }[]).map(
    (row, i) => ({
      rank: i + 1,
      username: nameMap[row.user_id] ?? '???',
      score: row.best_score,
      isMe: row.user_id === myUserId,
    }),
  );

  const myInTop = myUserId ? (top.find((e) => e.isMe) ?? null) : null;

  if (myUserId && !myInTop) {
    const { data: myRow } = await client
      .from('infinite_scores')
      .select('best_score')
      .eq('user_id', myUserId)
      .maybeSingle<{ best_score: number }>();

    if (myRow) {
      const { count } = await client
        .from('infinite_scores')
        .select('*', { count: 'exact', head: true })
        .gt('best_score', myRow.best_score);
      return {
        top,
        myEntry: {
          rank: (count ?? 0) + 1,
          username: nameMap[myUserId] ?? 'You',
          score: myRow.best_score,
          isMe: true,
        },
      };
    }
  }

  return { top, myEntry: myInTop };
}

export async function submitScoreIfBetter(
  client: SupabaseClient,
  userId: string,
  score: number,
): Promise<void> {
  const { data: existing } = await client
    .from('infinite_scores')
    .select('best_score')
    .eq('user_id', userId)
    .maybeSingle<{ best_score: number }>();

  if (existing && existing.best_score >= score) return;

  const { error } = await client.from('infinite_scores').upsert(
    { user_id: userId, best_score: score, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`score upsert: ${error.message}`);
}
