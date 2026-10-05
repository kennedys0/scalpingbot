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
    const record: PostMortemEntry = {
      ...entry,
      timestamp: entry.timestamp || Date.now(),
    };

    this.storage.update((data) => {
      if (!data.settings.memory) data.settings.memory = [];
      data.settings.memory.unshift(record);
      // Keep most recent 50 trade lessons
      if (data.settings.memory.length > 50) {
        data.settings.memory = data.settings.memory.slice(0, 50);
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
