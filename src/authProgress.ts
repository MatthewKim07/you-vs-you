import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { RunData } from './telemetry';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const PROGRESS_TABLE = 'player_progress';

export interface StoredProgress {
  highestLevelUnlocked: number;
  runs: RunData[];
}

interface ProgressRow {
  highest_level_unlocked: number | null;
  runs_json: RunData[] | null;
}

export class AuthProgressClient {
  private client: SupabaseClient | null;

  constructor() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      this.client = null;
      return;
    }
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getClient(): SupabaseClient | null {
    return this.client;
  }

  async createProfile(userId: string, username: string): Promise<void> {
    if (!this.client) throw new Error('Auth is not configured');
    const { error } = await this.client.from('profiles').insert({ id: userId, username });
    if (error) throw error;
  }

  async checkUsernameAvailable(username: string): Promise<boolean> {
    if (!this.client) return true;
    const { data } = await this.client
      .from('profiles')
      .select('id')
      .ilike('username', username)
      .maybeSingle();
    return data === null;
  }

  async getEmailByUsername(username: string): Promise<string | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.rpc('get_email_by_username', { p_username: username });
    if (error || !data) return null;
    return data as string;
  }

  async getUsername(userId: string): Promise<string | null> {
    if (!this.client) return null;
    const { data } = await this.client
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle<{ username: string }>();
    return data?.username ?? null;
  }

  async getCurrentUser(): Promise<User | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getUser();
    if (error) throw error;
    return data.user ?? null;
  }

  onAuthStateChange(callback: (user: User | null) => void): () => void {
    if (!this.client) return () => undefined;
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp(email: string, password: string): Promise<{ emailAlreadyExists: boolean }> {
    if (!this.client) throw new Error('Auth is not configured');
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    // Supabase sets identities=[] when email is already registered (prevents enumeration).
    const emailAlreadyExists = Array.isArray(data.user?.identities) && data.user.identities.length === 0;
    return { emailAlreadyExists };
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!this.client) throw new Error('Auth is not configured');
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  async loadProgress(userId: string): Promise<StoredProgress | null> {
    if (!this.client) return null;
    const { data, error } = await this.client
      .from(PROGRESS_TABLE)
      .select('highest_level_unlocked, runs_json')
      .eq('user_id', userId)
      .maybeSingle<ProgressRow>();
    if (error) throw error;
    if (!data) return null;
    return {
      highestLevelUnlocked: Math.max(1, data.highest_level_unlocked ?? 1),
      runs: Array.isArray(data.runs_json) ? data.runs_json : [],
    };
  }

  async saveProgress(userId: string, progress: StoredProgress): Promise<void> {
    if (!this.client) return;
    const payload = {
      user_id: userId,
      highest_level_unlocked: Math.max(1, progress.highestLevelUnlocked),
      runs_json: progress.runs,
      updated_at: new Date().toISOString(),
    };
    const { error } = await this.client.from(PROGRESS_TABLE).upsert(payload, {
      onConflict: 'user_id',
      ignoreDuplicates: false,
    });
    if (error) throw error;
  }
}
