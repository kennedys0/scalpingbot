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
        this.memoryData = JSON.parse(raw);
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
    fs.writeFileSync(tempPath, JSON.stringify(this.memoryData, null, 2), 'utf-8');
    fs.renameSync(tempPath, this.filePath);
  }

  public getData(): StorageData {
    return this.memoryData;
  }

  public update(updater: (data: StorageData) => void): void {
    updater(this.memoryData);
    this.save();
  }
}
