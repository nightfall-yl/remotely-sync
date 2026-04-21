import { Vault, TFile, TFolder } from "obsidian";
import type { Entity } from "./baseTypes";
import { FakeFs } from "./fsAll";

export class FakeFsLocal extends FakeFs {
  vault: Vault;
  syncConfigDir: boolean;
  syncBookmarks: boolean;
  configDir: string;
  pluginId: string;
  kind: string;

  constructor(
    vault: Vault,
    syncConfigDir: boolean,
    syncBookmarks: boolean,
    configDir: string,
    pluginId: string
  ) {
    super();
    this.vault = vault;
    this.syncConfigDir = syncConfigDir;
    this.syncBookmarks = syncBookmarks;
    this.configDir = configDir;
    this.pluginId = pluginId;
    this.kind = "local";
  }

  async walk(): Promise<Entity[]> {
    const entities: Entity[] = [];
    await this._walkRecursive("", entities);
    return entities;
  }

  async walkPartial(): Promise<Entity[]> {
    return await this.walk();
  }

  private async _walkRecursive(path: string, entities: Entity[]): Promise<void> {
    const allFiles = this.vault.getAllLoadedFiles();

    // Add files and folders
    for (const item of allFiles) {
      if (item instanceof TFile) {
        // Add file
        if (this._shouldSyncPath(item.path)) {
          entities.push({
            path: item.path,
            type: 'file',
            key: item.path,
            keyRaw: item.path,
            mtimeCli: Math.max(item.stat.mtime ?? 0, item.stat.ctime ?? 0),
            mtimeSvr: Math.max(item.stat.mtime ?? 0, item.stat.ctime ?? 0),
            size: item.stat.size,
            sizeRaw: item.stat.size,
            hash: undefined,
            synthesizedFolder: false,
          });
        }
      } else if (item instanceof TFolder) {
        // Add folder
        if (this._shouldSyncPath(item.path)) {
          entities.push({
            path: item.path,
            type: 'folder',
            key: item.path + "/",
            keyRaw: item.path + "/",
            mtimeCli: 0,
            mtimeSvr: 0,
            size: 0,
            sizeRaw: 0,
            hash: undefined,
            synthesizedFolder: false,
          });
        }
      }
    }
  }

  async stat(key: string): Promise<Entity> {
    if (key.endsWith("/")) {
      // Folder
      const folderPath = key.slice(0, -1);
      const folder = this.vault.getFolderByPath(folderPath);
      if (!folder) {
        throw new Error(`Folder not found: ${folderPath}`);
      }

      return {
        path: folderPath,
        type: 'folder',
        key: key,
        keyRaw: key,
        mtimeCli: 0,
        mtimeSvr: 0,
        size: 0,
        sizeRaw: 0,
        hash: undefined,
        synthesizedFolder: false,
      };
    } else {
      // File
      const file = this.vault.getFileByPath(key);
      if (!file) {
        throw new Error(`File not found: ${key}`);
      }

      return {
        path: key,
        type: 'file',
        key: key,
        keyRaw: key,
        mtimeCli: Math.max(file.stat.mtime ?? 0, file.stat.ctime ?? 0),
        mtimeSvr: Math.max(file.stat.mtime ?? 0, file.stat.ctime ?? 0),
        size: file.stat.size,
        sizeRaw: file.stat.size,
        hash: undefined,
        synthesizedFolder: false,
      };
    }
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    const folderPath = key.slice(0, -1);
    await this.vault.createFolder(folderPath);

    return {
      path: folderPath,
      type: 'folder',
      key: key,
      keyRaw: key,
      mtimeCli: mtime ?? Date.now(),
      mtimeSvr: mtime ?? Date.now(),
      size: 0,
      sizeRaw: 0,
      hash: undefined,
      synthesizedFolder: false,
    };
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    const file = this.vault.getFileByPath(key);
    if (file) {
      await this.vault.modifyBinary(file, content);
    } else {
      // Create parent folders if they don't exist
      const parentPath = key.substring(0, key.lastIndexOf("/"));
      if (parentPath) {
        await this.vault.createFolder(parentPath);
      }
      await this.vault.createBinary(key, content);
    }

    const newFile = this.vault.getFileByPath(key);
    if (!newFile) {
      throw new Error(`Failed to create file: ${key}`);
    }

    return {
      path: key,
      type: 'file',
      key: key,
      keyRaw: key,
      mtimeCli: mtime,
      mtimeSvr: mtime,
      size: content.byteLength,
      sizeRaw: content.byteLength,
      hash: undefined,
      synthesizedFolder: false,
    };
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    const file = this.vault.getFileByPath(key);
    if (!file) {
      throw new Error(`File not found: ${key}`);
    }

    return await this.vault.readBinary(file);
  }

  async rename(key1: string, key2: string): Promise<void> {
    const file = this.vault.getFileByPath(key1);
    if (file) {
      await this.vault.rename(file, key2);
    } else {
      const folder = this.vault.getFolderByPath(key1.slice(0, -1));
      if (folder) {
        await this.vault.rename(folder, key2.slice(0, -1));
      } else {
        throw new Error(`File or folder not found: ${key1}`);
      }
    }
  }

  async rm(key: string): Promise<void> {
    if (key.endsWith("/")) {
      const folder = this.vault.getFolderByPath(key.slice(0, -1));
      if (folder) {
        await this.vault.delete(folder, true);
      }
    } else {
      const file = this.vault.getFileByPath(key);
      if (file) {
        await this.vault.delete(file, true);
      }
    }
  }

  async checkConnect(callbackFunc?: any): Promise<boolean> {
    // Local file system is always available
    return true;
  }

  async getUserDisplayName(): Promise<string> {
    return "Local User";
  }

  async revokeAuth(): Promise<any> {
    return undefined;
  }

  allowEmptyFile(): boolean {
    return true;
  }

  private _shouldSyncPath(path: string): boolean {
    // Skip plugin settings file to avoid endless syncing
    if (path === `${this.configDir}/plugins/${this.pluginId}/data.json`) {
      return false;
    }

    // Skip config directory if not syncing config
    if (!this.syncConfigDir && path.startsWith(this.configDir)) {
      return false;
    }

    // Skip bookmarks if not syncing bookmarks
    if (!this.syncBookmarks && path === `${this.configDir}/bookmarks.json`) {
      return false;
    }

    return true;
  }
}
