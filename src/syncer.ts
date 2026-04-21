import AggregateError from "aggregate-error";
import PQueue from "p-queue";
import type { Entity, MixedEntity, ThirdPartySyncPluginSettings, SyncTriggerSourceType } from "./baseTypes";
import { copyFile, copyFileOrFolder, copyFolder } from "./copyLogic";
import type { FakeFs } from "./fsAll";
import type { FakeFsEncrypt } from "./fsEncrypt";
import { 
  DEFAULT_FILE_NAME_FOR_METADATAONREMOTE, 
  DEFAULT_FILE_NAME_FOR_METADATAONREMOTE2,
  MetadataOnRemote,
  serializeMetadataOnRemote,
  deserializeMetadataOnRemote
} from "./metadataOnRemote";
import { 
  atWhichLevel, 
  getParentFolder, 
  isHiddenPath,
  isSpecialFolderNameToSkip,
  unixTimeToStr
} from "./misc";
import type { InternalDBs } from "./localdb";
import { 
  insertSyncPlanRecordByVault
} from "./localdb";

export const syncer = async (
  fsLocal: FakeFs,
  fsRemote: FakeFs,
  fsEncrypt: FakeFsEncrypt,
  db: InternalDBs,
  triggerSource: SyncTriggerSourceType,
  profileID: string,
  vaultRandomID: string,
  configDir: string,
  settings: ThirdPartySyncPluginSettings,
  pluginVersion: string,
  configSaver: () => Promise<void>,
  getProtectError: (protectModifyPercentage: number, realModifyDeleteCount: number, allFilesCount: number) => string,
  markIsSyncingFunc: (isSyncing: boolean) => Promise<void>,
  notifyFunc: (triggerSource: SyncTriggerSourceType, step: number) => Promise<void>,
  errNotifyFunc: (triggerSource: SyncTriggerSourceType, error: Error) => Promise<void>,
  ribboonFunc: (triggerSource: SyncTriggerSourceType, step: number) => Promise<void>,
  statusBarFunc: (triggerSource: SyncTriggerSourceType, step: number, everythingOk: boolean) => Promise<void>,
  callbackSyncProcess: (triggerSource: SyncTriggerSourceType, realCounter: number, realTotalCount: number, pathName: string, decision: string) => Promise<void>
) => {
  try {
    await markIsSyncingFunc(true);
    await notifyFunc(triggerSource, 1);
    await ribboonFunc(triggerSource, 1);
    await statusBarFunc(triggerSource, 1, true);

    // Step 1: Check connectivity
    await notifyFunc(triggerSource, 2);
    const remoteConnectOk = await fsRemote.checkConnect();
    if (!remoteConnectOk) {
      throw new Error("Remote connection failed");
    }

    // Step 2: Get remote entities
    await notifyFunc(triggerSource, 3);
    const remoteEntityList = await fsEncrypt.walk();

    // Step 3: Get local entities
    await notifyFunc(triggerSource, 4);
    const localEntityList = await fsLocal.walk();

    // Step 4: Get previous sync records (simplified - not using DB for now)
    await notifyFunc(triggerSource, 5);
    const prevSyncEntityList: Entity[] = [];

    // Step 5: Generate sync plan
    await notifyFunc(triggerSource, 6);
    const syncPlan = await generateSyncPlan(
      localEntityList,
      prevSyncEntityList,
      remoteEntityList,
      settings.syncConfigDir,
      settings.syncBookmarks,
      configDir,
      settings.syncUnderscoreItems,
      settings.ignorePaths || [],
      settings.onlyAllowPaths || [],
      fsEncrypt,
      settings.serviceType,
      settings.skipSizeLargerThan,
      settings.conflictAction || "keep_local",
      settings.syncDirection,
      triggerSource,
      configDir
    );

    // Step 6: Execute sync plan
    await notifyFunc(triggerSource, 7);
    const { realTotalCount, realModifyDeleteCount, allFilesCount } = await executeSyncPlan(
      syncPlan,
      fsLocal,
      fsEncrypt,
      db,
      vaultRandomID,
      profileID,
      settings.concurrency,
      callbackSyncProcess,
      triggerSource
    );

    // Step 7: Check protect modify percentage
    if (settings.protectModifyPercentage !== undefined && settings.protectModifyPercentage >= 0 && allFilesCount > 0) {
      if (settings.protectModifyPercentage !== 100 && realModifyDeleteCount * 100 >= allFilesCount * settings.protectModifyPercentage) {
        const errorMsg = getProtectError(settings.protectModifyPercentage, realModifyDeleteCount, allFilesCount);
        throw new Error(errorMsg);
      }
    }

    // Step 8: Save sync records (simplified - not using DB for now)
    await notifyFunc(triggerSource, 8);
    // await saveSyncRecords(
    //   syncPlan,
    //   db,
    //   vaultRandomID,
    //   profileID,
    //   pluginVersion
    // );

    // Update last synced time
    settings.lastSynced = Date.now();
    await configSaver();

    await markIsSyncingFunc(false);
    await ribboonFunc(triggerSource, 8);
    await statusBarFunc(triggerSource, 8, true);
  } catch (error) {
    await markIsSyncingFunc(false);
    await ribboonFunc(triggerSource, 8);
    await statusBarFunc(triggerSource, 8, false);
    await errNotifyFunc(triggerSource, error as Error);
    throw error;
  }
};

const generateSyncPlan = async (
  localEntityList: Entity[],
  prevSyncEntityList: Entity[],
  remoteEntityList: Entity[],
  syncConfigDir: boolean,
  syncBookmarks: boolean,
  configDir: string,
  syncUnderscoreItems: boolean,
  ignorePaths: string[],
  onlyAllowPaths: string[],
  fsEncrypt: FakeFsEncrypt,
  serviceType: string,
  skipSizeLargerThan: number,
  conflictAction: string,
  syncDirection: string,
  triggerSource: SyncTriggerSourceType,
  configDirPath: string
): Promise<Record<string, MixedEntity>> => {
  // This is a simplified implementation
  // In a real implementation, you would generate a proper sync plan
  const syncPlan: Record<string, MixedEntity> = {};

  // Add remote entities
  for (const remote of remoteEntityList) {
    syncPlan[remote.key!] = {
      path: remote.path,
      type: remote.type,
      key: remote.key!,
      remote: remote
    };
  }

  // Add local entities
  for (const local of localEntityList) {
    if (syncPlan[local.key!]) {
      syncPlan[local.key!].local = local;
    } else {
      syncPlan[local.key!] = {
        path: local.path,
        type: local.type,
        key: local.key!,
        local: local
      };
    }
  }

  // Add previous sync entities
  for (const prevSync of prevSyncEntityList) {
    if (syncPlan[prevSync.key!]) {
      syncPlan[prevSync.key!].prevSync = prevSync;
    } else {
      syncPlan[prevSync.key!] = {
        path: prevSync.path,
        type: prevSync.type,
        key: prevSync.key!,
        prevSync: prevSync
      };
    }
  }

  // Skip metadata files
  delete syncPlan[DEFAULT_FILE_NAME_FOR_METADATAONREMOTE];
  delete syncPlan[DEFAULT_FILE_NAME_FOR_METADATAONREMOTE2];

  return syncPlan;
};

const executeSyncPlan = async (
  syncPlan: Record<string, MixedEntity>,
  fsLocal: FakeFs,
  fsEncrypt: FakeFsEncrypt,
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  concurrency: number,
  callbackSyncProcess: (triggerSource: SyncTriggerSourceType, realCounter: number, realTotalCount: number, pathName: string, decision: string) => Promise<void>,
  triggerSource: SyncTriggerSourceType
): Promise<{ realTotalCount: number; realModifyDeleteCount: number; allFilesCount: number }> => {
  // This is a simplified implementation
  // In a real implementation, you would execute the sync plan properly
  const queue = new PQueue({ concurrency, autoStart: true });
  let realTotalCount = 0;
  let realModifyDeleteCount = 0;
  let allFilesCount = 0;

  for (const key in syncPlan) {
    const item = syncPlan[key];
    if (!key.endsWith("/")) {
      allFilesCount++;
    }

    // Skip items that don't need syncing
    if (!item.local && !item.remote) {
      continue;
    }

    realTotalCount++;
    if (item.local && item.remote) {
      realModifyDeleteCount++;
    }

    queue.add(async () => {
      await callbackSyncProcess(triggerSource, realTotalCount, realTotalCount, key, "syncing");
      // In a real implementation, you would sync the item here
    });
  }

  await queue.onIdle();
  return { realTotalCount, realModifyDeleteCount, allFilesCount };
};

// saveSyncRecords function removed as it uses non-existent DB functions
