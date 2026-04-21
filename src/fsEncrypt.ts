import type { CipherMethodType, Entity } from "./baseTypes";
import * as openssl from "./encrypt";
import { FakeFs } from "./fsAll";
import cloneDeep from "lodash/cloneDeep";

export class FakeFsEncrypt extends FakeFs {
  innerFs: FakeFs;
  readonly password: string;
  readonly method: CipherMethodType;
  cacheMapOrigToEnc: Record<string, string>;
  hasCacheMap: boolean;
  kind: string;

  constructor(innerFs: FakeFs, password: string, method: CipherMethodType) {
    super();
    this.innerFs = innerFs;
    this.password = password ?? "";
    this.method = method;
    this.cacheMapOrigToEnc = {};
    this.hasCacheMap = false;

    this.kind = `encrypt(${this.innerFs.kind},${
      this.password !== "" ? method : "no password"
    })`;
  }

  isPasswordEmpty() {
    return this.password === "";
  }

  isFolderAware() {
    if (this.method === "openssl-base64") {
      return false;
    }
    return true;
  }

  async walk(): Promise<Entity[]> {
    const innerWalkResult = await this.innerFs.walk();
    return await this._dealWithWalk(innerWalkResult);
  }

  async walkPartial(): Promise<Entity[]> {
    const innerWalkResult = await this.innerFs.walkPartial();
    return await this._dealWithWalk(innerWalkResult);
  }

  async _dealWithWalk(innerWalkResult: Entity[]): Promise<Entity[]> {
    const res: Entity[] = [];

    if (this.isPasswordEmpty()) {
      for (const innerEntity of innerWalkResult) {
        res.push(this._copyEntityAndCopyKeyEncSizeEnc(innerEntity));
        this.cacheMapOrigToEnc[innerEntity.key!] = innerEntity.key!;
      }
      this.hasCacheMap = true;
      return res;
    } else {
      for (const innerEntity of innerWalkResult) {
        const key = await this._decryptName(innerEntity.key!);
        const size = key.endsWith("/") ? 0 : undefined;
        res.push({
          path: key,
          type: key.endsWith("/") ? 'folder' : 'file',
          key: key,
          keyRaw: innerEntity.key!,
          keyEnc: innerEntity.key!,
          mtimeCli: innerEntity.mtimeCli,
          mtimeSvr: innerEntity.mtimeSvr,
          size: size,
          sizeEnc: innerEntity.size!,
          sizeRaw: innerEntity.size!,
          hash: undefined,
          synthesizedFolder: innerEntity.synthesizedFolder,
        });

        this.cacheMapOrigToEnc[key] = innerEntity.key!;
      }
      this.hasCacheMap = true;
      return res;
    }
  }

  async stat(key: string): Promise<Entity> {
    if (!this.hasCacheMap) {
      throw new Error("You have to build the cacheMap firstly for stat");
    }
    const keyEnc = this.cacheMapOrigToEnc[key];
    if (keyEnc === undefined) {
      throw new Error(`no encrypted key ${key} before!`);
    }

    const innerEntity = await this.innerFs.stat(keyEnc);
    if (this.isPasswordEmpty()) {
      return this._copyEntityAndCopyKeyEncSizeEnc(innerEntity);
    } else {
      return {
        path: key,
        type: key.endsWith("/") ? 'folder' : 'file',
        key: key,
        keyRaw: innerEntity.keyRaw,
        keyEnc: innerEntity.key!,
        mtimeCli: innerEntity.mtimeCli,
        mtimeSvr: innerEntity.mtimeSvr,
        size: undefined,
        sizeEnc: innerEntity.size!,
        sizeRaw: innerEntity.sizeRaw,
        hash: undefined,
        synthesizedFolder: innerEntity.synthesizedFolder,
      };
    }
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    if (!this.hasCacheMap) {
      throw new Error("You have to build the cacheMap firstly for mkdir");
    }

    if (!key.endsWith("/")) {
      throw new Error(`should not call mkdir on ${key}`);
    }

    let keyEnc = this.cacheMapOrigToEnc[key];
    if (keyEnc === undefined) {
      if (this.isPasswordEmpty()) {
        keyEnc = key;
      } else {
        keyEnc = await this._encryptName(key);
      }
      this.cacheMapOrigToEnc[key] = keyEnc;
    }

    if (this.isPasswordEmpty() || this.isFolderAware()) {
      const innerEntity = await this.innerFs.mkdir(keyEnc, mtime, ctime);
      return this._copyEntityAndCopyKeyEncSizeEnc(innerEntity);
    } else {
      const now = Date.now();
      let content = new ArrayBuffer(0);
      if (!this.innerFs.allowEmptyFile()) {
        content = new ArrayBuffer(1);
      }
      const innerEntity = await this.innerFs.writeFile(
        keyEnc,
        content,
        mtime ?? now,
        ctime ?? now
      );
      return {
        path: key,
        type: 'folder',
        key: key,
        keyRaw: innerEntity.keyRaw,
        keyEnc: innerEntity.key!,
        mtimeCli: innerEntity.mtimeCli,
        mtimeSvr: innerEntity.mtimeSvr,
        size: 0,
        sizeEnc: innerEntity.size!,
        sizeRaw: innerEntity.sizeRaw,
        hash: undefined,
        synthesizedFolder: innerEntity.synthesizedFolder,
      };
    }
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    if (!this.hasCacheMap) {
      throw new Error("You have to build the cacheMap firstly for writeFile");
    }
    let keyEnc = this.cacheMapOrigToEnc[key];
    if (keyEnc === undefined) {
      if (this.isPasswordEmpty()) {
        keyEnc = key;
      } else {
        keyEnc = await this._encryptName(key);
      }
      this.cacheMapOrigToEnc[key] = keyEnc;
    }

    if (this.isPasswordEmpty()) {
      const innerEntity = await this.innerFs.writeFile(
        keyEnc,
        content,
        mtime,
        ctime
      );
      return this._copyEntityAndCopyKeyEncSizeEnc(innerEntity);
    } else {
      const contentEnc = await this._encryptContent(content);
      const innerEntity = await this.innerFs.writeFile(
        keyEnc,
        contentEnc,
        mtime,
        ctime
      );
      return {
        path: key,
        type: 'file',
        key: key,
        keyRaw: innerEntity.keyRaw,
        keyEnc: innerEntity.key!,
        mtimeCli: innerEntity.mtimeCli,
        mtimeSvr: innerEntity.mtimeSvr,
        size: undefined,
        sizeEnc: innerEntity.size!,
        sizeRaw: innerEntity.sizeRaw,
        hash: undefined,
        synthesizedFolder: innerEntity.synthesizedFolder,
      };
    }
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    if (!this.hasCacheMap) {
      throw new Error("You have to build the cacheMap firstly for readFile");
    }
    const keyEnc = this.cacheMapOrigToEnc[key];
    if (keyEnc === undefined) {
      throw new Error(`no encrypted key ${key} before! cannot readFile`);
    }

    const contentEnc = await this.innerFs.readFile(keyEnc);
    if (this.isPasswordEmpty()) {
      return contentEnc;
    } else {
      const res = await this._decryptContent(contentEnc);
      return res;
    }
  }

  async rename(key1: string, key2: string): Promise<void> {
    if (!this.hasCacheMap) {
      throw new Error("You have to build the cacheMap firstly for rename");
    }
    let key1Enc = this.cacheMapOrigToEnc[key1];
    if (key1Enc === undefined) {
      if (this.isPasswordEmpty()) {
        key1Enc = key1;
      } else {
        key1Enc = await this._encryptName(key1);
      }
      this.cacheMapOrigToEnc[key1] = key1Enc;
    }
    let key2Enc = this.cacheMapOrigToEnc[key2];
    if (key2Enc === undefined) {
      if (this.isPasswordEmpty()) {
        key2Enc = key2;
      } else {
        key2Enc = await this._encryptName(key2);
      }
      this.cacheMapOrigToEnc[key2] = key2Enc;
    }
    return await this.innerFs.rename(key1Enc, key2Enc);
  }

  async rm(key: string): Promise<void> {
    if (!this.hasCacheMap) {
      throw new Error("You have to build the cacheMap firstly for rm");
    }
    const keyEnc = this.cacheMapOrigToEnc[key];
    if (keyEnc === undefined) {
      throw new Error(`no encrypted key ${key} before! cannot rm`);
    }
    return await this.innerFs.rm(keyEnc);
  }

  async checkConnect(callbackFunc?: any): Promise<boolean> {
    return await this.innerFs.checkConnect(callbackFunc);
  }

  async getUserDisplayName(): Promise<string> {
    return await this.innerFs.getUserDisplayName();
  }

  async revokeAuth(): Promise<any> {
    return await this.innerFs.revokeAuth();
  }

  allowEmptyFile(): boolean {
    return this.innerFs.allowEmptyFile();
  }

  async encryptEntity(input: Entity): Promise<Entity> {
    if (input.key === undefined) {
      throw Error(`input ${input.keyRaw} is abnormal without key`);
    }

    if (this.isPasswordEmpty()) {
      return this._copyEntityAndCopyKeyEncSizeEnc(input);
    }

    const local = cloneDeep(input);
    if (local.sizeEnc === undefined && local.size !== undefined) {
      local.sizeEnc = this._getSizeFromOrigToEnc(local.size);
    }

    if (local.keyEnc === undefined || local.keyEnc === "") {
      let keyEnc = this.cacheMapOrigToEnc[input.key];
      if (keyEnc !== undefined && keyEnc !== "" && keyEnc !== local.key) {
        local.keyEnc = keyEnc;
      } else {
        keyEnc = await this._encryptName(input.key);
        local.keyEnc = keyEnc;
        this.cacheMapOrigToEnc[input.key] = keyEnc;
      }
    }
    return local;
  }

  private _copyEntityAndCopyKeyEncSizeEnc(entity: Entity) {
    const res = cloneDeep(entity);
    res["keyEnc"] = res["key"];
    res["sizeEnc"] = res["size"];
    return res;
  }

  private async _encryptContent(content: ArrayBuffer): Promise<ArrayBuffer> {
    if (this.password === "") {
      return content;
    }
    if (this.method === "openssl-base64") {
      const res = await openssl.encryptArrayBuffer(content, this.password);
      if (res === undefined) {
        throw Error(`cannot encrypt content`);
      }
      return res;
    } else {
      throw Error(`not supported encrypt method=${this.method}`);
    }
  }

  private async _decryptContent(content: ArrayBuffer): Promise<ArrayBuffer> {
    if (this.password === "") {
      return content;
    }
    if (this.method === "openssl-base64") {
      const res = await openssl.decryptArrayBuffer(content, this.password);
      if (res === undefined) {
        throw Error(`cannot decrypt content`);
      }
      return res;
    } else {
      throw Error(`not supported decrypt method=${this.method}`);
    }
  }

  private async _encryptName(name: string): Promise<string> {
    if (this.password === "") {
      return name;
    }
    if (this.method === "openssl-base64") {
      const res = await openssl.encryptStringToBase64url(name, this.password);
      if (res === undefined) {
        throw Error(`cannot encrypt name=${name}`);
      }
      return res;
    } else {
      throw Error(`not supported encrypt method=${this.method}`);
    }
  }

  private async _decryptName(name: string): Promise<string> {
    if (this.password === "") {
      return name;
    }
    if (this.method === "openssl-base64") {
      const res = await openssl.decryptBase64urlToString(name, this.password);
      if (res !== undefined) {
        return res;
      } else {
        throw Error(`cannot decrypt name=${name}`);
      }
    } else {
      throw Error(`not supported decrypt method=${this.method}`);
    }
  }

  private _getSizeFromOrigToEnc(x: number): number {
    if (this.password === "") {
      return x;
    }
    if (this.method === "openssl-base64") {
      return openssl.getSizeFromOrigToEnc(x);
    } else {
      throw Error(`not supported encrypt method=${this.method}`);
    }
  }
}
