import { JsonStorage } from '../../storage/db.js';

export interface PostMortemEntry {
  tokenSymbol: string;
  outcome: 'WIN' | 'LOSS';
  pnlPct: number;
  lessonLearned: string;
  timestamp?: number;
}

export class SelfReflectiveMemory {
  private storage: JsonStorage;

  constructor(storage: JsonStorage) {
    this.storage = storage;
    this.initStorage();
  }

  private initStorage(): void {
    this.storage.update((data) => {
      if (!data.settings.memory) {
        data.settings.memory = [];
      }
    });
  }

  public async recordPostMortem(entry: PostMortemEntry): Promise<void> {
    // Truncate overly long lessons to max 140 chars to save LLM tokens and avoid hallucination
    const sanitizedLesson = entry.lessonLearned.length > 140
      ? `${entry.lessonLearned.substring(0, 137)}...`
      : entry.lessonLearned;

    const record: PostMortemEntry = {
      ...entry,
      lessonLearned: sanitizedLesson,
      timestamp: entry.timestamp || Date.now(),
    };

    this.storage.update((data) => {
      if (!data.settings.memory) data.settings.memory = [];
      data.settings.memory.unshift(record);
      // Sliding window: Keep only the 10 most recent trade lessons
      if (data.settings.memory.length > 10) {
        data.settings.memory = data.settings.memory.slice(0, 10);
      }
    });
  }

  public getRecentLessons(limit: number = 5): string[] {
    const memory = (this.storage.getData().settings.memory || []) as PostMortemEntry[];
    return memory.slice(0, limit).map((m) => {
      const icon = m.outcome === 'WIN' ? '✅' : '⚠️';
      return `${icon} [$${m.tokenSymbol} (${m.pnlPct > 0 ? '+' : ''}${m.pnlPct.toFixed(1)}%)]: ${m.lessonLearned}`;
    });
  }

  public formatLessonsForPrompt(): string {
    const lessons = this.getRecentLessons(4);
    if (lessons.length === 0) return '';

    return `\n\nPAST LESSONS LEARNED (DO NOT REPEAT PAST MISTAKES):\n${lessons.join('\n')}\n`;
  }
}
