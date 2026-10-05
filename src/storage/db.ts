import fs from 'fs';
import path from 'path';

export interface StorageData {
  positions: any[];
  trades: any[];
  settings: Record<string, any>;
}

export class JsonStorage {
  private filePath: string;
  private memoryData: StorageData = {
    positions: [],
    trades: [],
    settings: {},
  };
  private isMemory: boolean;

  constructor(filePath: string = './data/store.json') {
    this.filePath = filePath;
    this.isMemory = filePath === ':memory:';
    if (!this.isMemory) {
      this.initFile();
    }
  }

  private initFile(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.memoryData = {
          positions: Array.isArray(parsed.positions) ? parsed.positions : [],
          trades: Array.isArray(parsed.trades) ? parsed.trades : [],
          settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
        };
      } catch {
        this.save();
      }
    } else {
      this.save();
    }
  }

  private save(): void {
    if (this.isMemory) return;
    const tempPath = `${this.filePath}.tmp`;
    const serialized = JSON.stringify(this.memoryData, null, 2);
    try {
      fs.writeFileSync(tempPath, serialized, 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch {
      // Fallback in case of Windows file locking or antivirus interference
      fs.writeFileSync(this.filePath, serialized, 'utf-8');
    }
  }

  public getData(): StorageData {
    return this.memoryData;
  }

  public update(updater: (data: StorageData) => void): void {
    updater(this.memoryData);
    this.save();
  }
}
