/**
 * Only type defs here.
 * To avoid circular dependency.
 */

import { Platform, requireApiVersion } from "obsidian";
import type { LangType, LangTypeAndAuto } from "./i18n";

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export type SUPPORTED_SERVICES_TYPE = "s3" | "webdav" | "onedrive";

export type SUPPORTED_SERVICES_TYPE_WITH_REMOTE_BASE_DIR =
  | "webdav"
  | "onedrive";

export interface S3Config {
  s3Endpoint: string;
  s3Region: string;
  s3AccessKeyID: string;
  s3SecretAccessKey: string;
  s3BucketName: string;
  bypassCorsLocally?: boolean;
  partsConcurrency?: number;
  forcePathStyle?: boolean;
  disableS3MetadataSync: boolean;
}


export type WebdavAuthType = "digest" | "basic";
export type WebdavDepthType =
  | "auto_unknown"
  | "auto_1"
  | "auto_infinity"
  | "manual_1"
  | "manual_infinity";

export interface WebdavConfig {
  address: string;
  username: string;
  password: string;
  authType: WebdavAuthType;
  manualRecursive: boolean; // deprecated in 0.3.6, use depth
  depth?: WebdavDepthType;
  remoteBaseDir?: string;
}

export interface OnedriveConfig {
  accessToken: string;
  clientID: string;
  authority: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  accessTokenExpiresAtTime: number;
  deltaLink: string;
  username: string;
  credentialsShouldBeDeletedAtTime?: number;
  remoteBaseDir?: string;
}

export interface ThirdPartySyncPluginSettings {
  s3: S3Config;
  webdav: WebdavConfig;
  onedrive: OnedriveConfig;
  password: string;
  serviceType: SUPPORTED_SERVICES_TYPE;
  debugEnabled?: boolean;
  autoRunEveryMilliseconds?: number;
  initRunAfterMilliseconds?: number;
  syncOnSaveAfterMilliseconds?: number;
  syncOnRemoteChangesAfterMilliseconds?: number;
  agreeToUploadExtraMetadata?: boolean;
  concurrency?: number;
  syncConfigDir?: boolean;
  syncUnderscoreItems?: boolean;
  lang?: LangTypeAndAuto;
  logToDB?: boolean;
  skipSizeLargerThan?: number;
  enableStatusBarInfo: boolean;
  lastSynced?: number;
  syncTrash: boolean;
  syncBookmarks: boolean;
  syncDirection?: SyncDirectionType;
  protectModifyPercentage?: number;
  ignorePaths?: string[];
  onlyAllowPaths?: string[];
  conflictAction?: string;
  deleteToWhere?: DeleteToWhereType;

  /**
   * @deprecated
   */
  vaultRandomID?: string;
}

export interface RemoteItem {
  key: string;
  lastModified: number;
  size: number;
  remoteType: SUPPORTED_SERVICES_TYPE;
  etag?: string;
}

export const COMMAND_URI = "third-party-sync";
export const COMMAND_CALLBACK = "third-party-sync-cb";
export const COMMAND_CALLBACK_ONEDRIVE = "third-party-sync-cb-onedrive";

export interface UriParams {
  func?: string;
  vault?: string;
  ver?: string;
  data?: string;
  compressed?: string;
}

// 80 days
export const OAUTH2_FORCE_EXPIRE_MILLISECONDS = 1000 * 60 * 60 * 24 * 80;

type DecisionTypeForFile =
  | "skipUploading" // special, mtimeLocal === mtimeRemote
  | "uploadLocalDelHistToRemote" // "delLocalIfExists && delRemoteIfExists && cleanLocalDelHist && uploadLocalDelHistToRemote"
  | "keepRemoteDelHist" // "delLocalIfExists && delRemoteIfExists && cleanLocalDelHist && keepRemoteDelHist"
  | "uploadLocalToRemote" // "skipLocal && uploadLocalToRemote && cleanLocalDelHist && cleanRemoteDelHist"
  | "downloadRemoteToLocal"; // "downloadRemoteToLocal && skipRemote && cleanLocalDelHist && cleanRemoteDelHist"

type DecisionTypeForFileSize =
  | "skipUploadingTooLarge"
  | "skipDownloadingTooLarge"
  | "skipUsingLocalDelTooLarge"
  | "skipUsingRemoteDelTooLarge"
  | "errorLocalTooLargeConflictRemote"
  | "errorRemoteTooLargeConflictLocal";

type DecisionTypeForFolder =
  | "createFolder"
  | "uploadLocalDelHistToRemoteFolder"
  | "keepRemoteDelHistFolder"
  | "skipFolder";

export type DecisionType =
  | DecisionTypeForFile
  | DecisionTypeForFileSize
  | DecisionTypeForFolder;

export interface FileOrFolderMixedState {
  key: string;
  existLocal?: boolean;
  existRemote?: boolean;
  mtimeLocal?: number;
  mtimeRemote?: number;
  deltimeLocal?: number;
  deltimeRemote?: number;
  sizeLocal?: number;
  sizeLocalEnc?: number;
  sizeRemote?: number;
  sizeRemoteEnc?: number;
  changeRemoteMtimeUsingMapping?: boolean;
  changeLocalMtimeUsingMapping?: boolean;
  decision?: DecisionType;
  decisionBranch?: number;
  syncDone?: "done";
  remoteEncryptedKey?: string;
  prevSync?: { mtime: number; size: number; keyType: "folder" | "file" };

  mtimeLocalFmt?: string;
  mtimeRemoteFmt?: string;
  deltimeLocalFmt?: string;
  deltimeRemoteFmt?: string;
}

export const API_VER_STAT_FOLDER = "0.13.27";
export const API_VER_REQURL = "0.13.26"; // desktop ver 0.13.26, iOS ver 1.1.1
export const API_VER_REQURL_ANDROID = "0.14.6"; // Android ver 1.2.1

export const VALID_REQURL =
  (!Platform.isAndroidApp && !Platform.isMobileApp && requireApiVersion(API_VER_REQURL)) ||
  (Platform.isAndroidApp && requireApiVersion(API_VER_REQURL_ANDROID)) ||
  (Platform.isMobileApp && !Platform.isAndroidApp && requireApiVersion(API_VER_REQURL)); // iOS uses the same version as desktop

export const DEFAULT_DEBUG_FOLDER = "_debug_remotely_save/";
export const DEFAULT_SYNC_PLANS_HISTORY_FILE_PREFIX =
  "sync_plans_hist_exported_on_";
export const DEFAULT_LOG_HISTORY_FILE_PREFIX = "log_hist_exported_on_";

export type SyncTriggerSourceType = "manual" | "auto" | "dry" | "autoOnceInit";

export type DeleteToWhereType = "system_trash" | "obsidian_trash";

export type SyncDirectionType =
  | "bidirectional"
  | "incremental_pull_only"
  | "incremental_push_only"
  | "incremental_pull_and_delete_only"
  | "incremental_push_and_delete_only";

export interface Entity {
  path: string;
  type: 'file' | 'folder';
  mtime?: number;
  size?: number;
  key?: string;
  keyRaw?: string;
  keyEnc?: string;
  mtimeCli?: number;
  mtimeSvr?: number;
  sizeEnc?: number;
  sizeRaw?: number;
  hash?: string | undefined;
  synthesizedFolder?: boolean;
}

export interface MixedEntity {
  path: string;
  type: 'file' | 'folder';
  mtime?: number;
  size?: number;
  existLocal?: boolean;
  existRemote?: boolean;
  local?: Entity;
  remote?: Entity;
  prevSync?: Entity;
  key?: string;
}

export type CipherMethodType = 'aes-256-gcm' | 'aes-256-cbc' | 'openssl-base64';

export interface SyncPlanType {
  ts: number;
  tsFmt?: string;
  syncTriggerSource?: SyncTriggerSourceType;
  remoteType: SUPPORTED_SERVICES_TYPE;
  mixedStates: Record<string, FileOrFolderMixedState>;
}

export interface DeletionOnRemote {
  key: string;
  deltime: number;
}

export interface MetadataOnRemote {
  version: string;
  lastSyncTime: number;
  files: {
    [key: string]: {
      mtime: number;
      size?: number;
    };
  };
}
