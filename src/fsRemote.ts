import type { Entity } from "./baseTypes";
import { RemoteClient } from "./remote";
import { FakeFs } from "./fsAll";

export class FakeFsRemote extends FakeFs {
  client: RemoteClient;
  kind: string;

  constructor(client: RemoteClient) {
    super();
    this.client = client;
    this.kind = `remote(${client.serviceType})`;
  }

  async walk(): Promise<Entity[]> {
    const remoteItems = await this.client.listFromRemote();
    const entities: Entity[] = [];

    for (const item of remoteItems.Contents) {
      entities.push({
        path: item.key,
        type: item.key.endsWith("/") ? 'folder' : 'file',
        key: item.key,
        keyRaw: item.key,
        mtimeCli: item.lastModified,
        mtimeSvr: item.lastModified,
        size: item.size,
        sizeRaw: item.size,
        hash: item.etag,
        synthesizedFolder: false,
      });
    }

    return entities;
  }

  async walkPartial(): Promise<Entity[]> {
    return await this.walk();
  }

  async stat(key: string): Promise<Entity> {
    // This is a simplified implementation
    // In a real implementation, you might want to cache this or use a more efficient method
    const items = await this.client.listFromRemote(key);
    const item = items.Contents.find((i) => i.key === key);
    if (!item) {
      throw new Error(`File not found: ${key}`);
    }

    return {
      path: item.key,
      type: item.key.endsWith("/") ? 'folder' : 'file',
      key: item.key,
      keyRaw: item.key,
      mtimeCli: item.lastModified,
      mtimeSvr: item.lastModified,
      size: item.size,
      sizeRaw: item.size,
      hash: item.etag,
      synthesizedFolder: false,
    };
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    // For most remote services, creating a folder is done by uploading a file with a trailing slash
    // or by creating the parent directories when uploading a file
    // This is a simplified implementation
    const now = Date.now();
    return {
      path: key,
      type: 'folder',
      key: key,
      keyRaw: key,
      mtimeCli: mtime ?? now,
      mtimeSvr: mtime ?? now,
      size: 0,
      sizeRaw: 0,
      hash: undefined,
      synthesizedFolder: true,
    };
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    const remoteObjMeta = await this.client.uploadToRemote(
      key,
      null as any, // vault is not needed for raw content
      false, // isRecursively
      "", // password
      "", // remoteEncryptedKey
      undefined, // foldersCreatedBefore
      true, // uploadRaw
      content // rawContent
    );

    return {
      path: key,
      type: 'file',
      key: key,
      keyRaw: key,
      mtimeCli: mtime,
      mtimeSvr: remoteObjMeta.lastModified,
      size: remoteObjMeta.size,
      sizeRaw: remoteObjMeta.size,
      hash: remoteObjMeta.etag,
      synthesizedFolder: false,
    };
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    // This is a simplified implementation
    // In a real implementation, you would need to handle password and remoteEncryptedKey
    const buffer = await this.client.downloadFromRemote(
      key,
      null as any, // vault is not needed for skipSaving
      0, // mtime
      "", // password
      "", // remoteEncryptedKey
      true // skipSaving
    );

    return buffer;
  }

  async rename(key1: string, key2: string): Promise<void> {
    // This is a simplified implementation
    // In a real implementation, you would need to handle this properly
    // For most remote services, this would involve downloading the file and re-uploading it
    const content = await this.readFile(key1);
    await this.writeFile(key2, content, Date.now(), Date.now());
    await this.rm(key1);
  }

  async rm(key: string): Promise<void> {
    await this.client.deleteFromRemote(key, "", "");
  }

  async checkConnect(callbackFunc?: any): Promise<boolean> {
    return await this.client.checkConnectivity(callbackFunc);
  }

  async getUserDisplayName(): Promise<string> {
    try {
      return await this.client.getUser();
    } catch (error) {
      return "Unknown User";
    }
  }

  async revokeAuth(): Promise<any> {
    return await this.client.revokeAuth();
  }

  allowEmptyFile(): boolean {
    return true;
  }
}
