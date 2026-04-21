import {
  Modal,
  Notice,
  Plugin,
  Setting,
  setIcon,
  FileSystemAdapter,
  Platform, TAbstractFile, Vault, EventRef,
} from "obsidian";
import cloneDeep from "lodash/cloneDeep";
import type {
  FileOrFolderMixedState, RemoteItem,
  ThirdPartySyncPluginSettings,
  SyncTriggerSourceType,
  SyncPlanType,
} from "./baseTypes";
import {
  COMMAND_CALLBACK,
  COMMAND_CALLBACK_ONEDRIVE,
  COMMAND_URI,
} from "./baseTypes";
import { importQrCodeUri } from "./importExport";
import {
  insertDeleteRecordByVault,
  insertRenameRecordByVault,
  insertSyncPlanRecordByVault,
  loadFileHistoryTableByVault,
  prepareDBs,
  InternalDBs,
  insertLoggerOutputByVault,
  clearExpiredLoggerOutputRecords,
  clearExpiredSyncPlanRecords, FileFolderHistoryRecord,
} from "./localdb";
import { RemoteClient } from "./remote";
import {
  AccessCodeResponseSuccessfulType,
  DEFAULT_ONEDRIVE_CONFIG,
  sendAuthReq as sendAuthReqOnedrive,
  setConfigBySuccessfullAuthInplace as setConfigBySuccessfullAuthInplaceOnedrive,
} from "./remoteForOnedrive";
import { DEFAULT_S3_CONFIG } from "./remoteForS3";
import { DEFAULT_WEBDAV_CONFIG } from "./remoteForWebdav";
import { ThirdPartySyncSettingTab } from "./settings";
import { SyncStatusType, isPasswordOk, getRemoteMetadata, getRemoteStates, getSyncPlan, doActualSync } from "./sync";
import { messyConfigToNormal, normalConfigToMessy } from "./configPersist";
import { ObsConfigDirFileType, listFilesInObsFolder } from "./obsFolderLister";
import { I18n } from "./i18n";
import type { LangType, LangTypeAndAuto, TransItemType } from "./i18n";

import {DeletionOnRemote, deserializeMetadataOnRemote, MetadataOnRemote} from "./metadataOnRemote";
import { SyncAlgoV2Modal } from "./syncAlgoV2Notice";
import { applyPresetRulesInplace } from "./presetRules";

import { applyLogWriterInplace, log } from "./moreOnLog";
import AggregateError from "aggregate-error";
import {
  exportVaultLoggerOutputToFiles,
  exportVaultSyncPlansToFiles,
} from "./debugMode";
import { SizesConflictModal } from "./syncSizesConflictNotice";
import {mkdirpInVault, getLastSynced} from "./misc";

// File system abstraction layers
import { FakeFsLocal } from "./fsLocal";
import { FakeFsRemote } from "./fsRemote";
import { FakeFsEncrypt } from "./fsEncrypt";
import { syncer } from "./syncer";

const DEFAULT_SETTINGS: ThirdPartySyncPluginSettings = {
  s3: DEFAULT_S3_CONFIG,
  webdav: DEFAULT_WEBDAV_CONFIG,
  onedrive: DEFAULT_ONEDRIVE_CONFIG,
  password: "",
  serviceType: "s3",
  debugEnabled: false,
  // vaultRandomID: "", // deprecated
  autoRunEveryMilliseconds: -1,
  initRunAfterMilliseconds: -1,
  syncOnSaveAfterMilliseconds: -1,
  syncOnRemoteChangesAfterMilliseconds: -1,
  agreeToUploadExtraMetadata: false,
  concurrency: 5,
  syncConfigDir: false,
  syncUnderscoreItems: false,
  lang: "auto",
  logToDB: false,
  skipSizeLargerThan: -1,
  enableStatusBarInfo: undefined,
  lastSynced: -1,
  trashLocal: false,
  syncTrash: false,
  syncBookmarks: true,
  syncDirection: "bidirectional",
  protectModifyPercentage: 50,
};

interface OAuth2Info {
  verifier?: string;
  helperModal?: Modal;
  authDiv?: HTMLElement;
  revokeDiv?: HTMLElement;
  revokeAuthSetting?: Setting;
}

const iconNameSyncWait = "rotate-ccw";
const iconNameSyncRunning = "refresh-ccw";
const iconNameStatusBar = "refresh-ccw-dot";
const iconNameLogs = "file-text";

export default class ThirdPartySyncPlugin extends Plugin {
  settings: ThirdPartySyncPluginSettings;
  db: InternalDBs;
  syncStatus: SyncStatusType;
  syncStatusText?: string;
  statusBarElement: HTMLSpanElement;
  oauth2Info: OAuth2Info;
  currSyncMsg?: string;
  syncRibbon?: HTMLElement;
  autoRunIntervalID?: number;
  i18n: I18n;
  vaultRandomID: string;
  isManual: boolean;
  isAlreadyRunning: boolean;
  syncOnSaveEvent?: EventRef;
  vaultScannerIntervalId?: number;
  syncOnRemoteIntervalID?: number;
  statusBarIntervalID: number;
  currentTriggerSource?: SyncTriggerSourceType;

  async syncRun(triggerSource: SyncTriggerSourceType = "manual") {
    this.isManual = triggerSource === "manual";
    this.isAlreadyRunning = false;
    this.currentTriggerSource = triggerSource;
    const MAX_STEPS = this.settings.debugEnabled ? 8 : 2;
    await this.createTrashIfDoesNotExist();

    const t = (x: TransItemType, vars?: any) => {
      return this.i18n.t(x, vars);
    };

    const getNotice = (s: SyncTriggerSourceType, msg: string, timeout?: number) => {
      if (s === "manual" || s === "dry") {
        new Notice(msg, timeout);
      }
    };

    // Notice function - shows notifications at each step
    const notifyFunc = async (s: SyncTriggerSourceType, step: number) => {
      if (s !== "manual" && s !== "dry") {
        return; // Auto sync doesn't show notices
      }

      if (this.settings.debugEnabled) {
        // Debug mode: show all steps with detailed format
        switch (step) {
          case 0:
            if (s === "dry") {
              getNotice(s, t("syncrun_step0", { current: "0", maxSteps: "8" }), 0);
            }
            break;
          case 1:
            getNotice(s, t("syncrun_step1", {
              current: "1", maxSteps: "8", serviceType: this.settings.serviceType
            }));
            break;
          case 2:
          case 3:
          case 4:
          case 5:
          case 6:
            getNotice(s, t(`syncrun_step${step}` as any, {
              current: `${step}`, maxSteps: "8"
            }));
            break;
          case 7:
            if (s === "dry") {
              getNotice(s, t("syncrun_step7skip", { current: "7", maxSteps: "8" }));
            } else {
              getNotice(s, t("syncrun_step7", { current: "7", maxSteps: "8" }));
            }
            break;
          case 8:
            getNotice(s, t("syncrun_step8", { current: "8", maxSteps: "8" }));
            break;
        }
      } else {
        // Non-debug mode: show short format
        switch (step) {
          case 0:
            if (s === "dry") {
              getNotice(s, t("syncrun_shortstep0"), 0);
            }
            break;
          case 1:
            getNotice(s, t("syncrun_shortstep1", { serviceType: this.settings.serviceType }));
            break;
          case 7:
            if (s === "dry") {
              getNotice(s, t("syncrun_shortstep2skip"));
            }
            break;
          case 8:
            getNotice(s, t("syncrun_shortstep2"));
            if (s === "dry") {
              getNotice(s, t("syncrun_shortstep3drydone"));
            }
            break;
        }
      }
    };

    // Status bar function - updates status bar at step 1 and step 8
    const statusBarFunc = async (s: SyncTriggerSourceType, step: number, everythingOk: boolean) => {
      if (step === 1) {
        // Show "syncing..." on status bar
        this.updateSyncStatus("syncing");
      } else if (step === 8) {
        if (everythingOk) {
          // Update with the latest lastSynced time
          this.updateSyncStatus("idle");
        } else {
          this.updateSyncStatus("idle");
        }
      }
    };

    // Ribbon function - updates ribbon icon
    const ribboonFunc = async (s: SyncTriggerSourceType, step: number) => {
      // Handled by setSyncIcon
    };

    // Sync process callback
    const callbackSyncProcess = async (s: SyncTriggerSourceType, realCounter: number, realTotalCount: number, pathName: string, decision: string) => {
      if (this.settings.enableStatusBarInfo) {
        this.setCurrSyncMsg(realCounter, realTotalCount, pathName);
      }
    };

    // Make sure two syncs can't run at the same time
    if (this.syncStatus !== "idle") {
      if (triggerSource == "manual") {
        // Show notice for debug, mobile, or desktop
        if (this.settings.debugEnabled) {
          new Notice(t("syncrun_debug_alreadyrunning", {stage: this.syncStatus}));
        } else {
          new Notice("1/" + t("syncrun_alreadyrunning", {maxSteps: MAX_STEPS}));
          this.isAlreadyRunning = true;
        }

        log.debug(this.manifest.name, " already running in stage: ", this.syncStatus);

        if (this.currSyncMsg !== undefined && this.currSyncMsg !== "") {
          log.debug(this.currSyncMsg);
        }  
      }

      return;
    }

    let everythingOk = true;
    try {
      this.setSyncIcon(true, triggerSource);

      // Step 0 for dry mode
      if (triggerSource === "dry") {
        notifyFunc(triggerSource, 0);
      }

      // Step 1 - start
      notifyFunc(triggerSource, 1);
      statusBarFunc(triggerSource, 1, true);

      // Step 2 - prepare for sync
      const self = this;
      const client = this.getRemoteClient(self);

      // Step 3 - list remote files
      await notifyFunc(triggerSource, 2);
      const remoteRsp = await client.listFromRemote();

      // Step 4 - check password
      await notifyFunc(triggerSource, 3);
      const passwordCheckResult = await isPasswordOk(
        remoteRsp.Contents,
        this.settings.password
      );

      // Step 5 - get remote metadata
      await notifyFunc(triggerSource, 4);
      const metadataFile = await getRemoteMetadata(remoteRsp.Contents, client, this.settings.password);

      // Step 6 - get remote states
      await notifyFunc(triggerSource, 5);
      const remoteStates = await getRemoteStates(
        remoteRsp.Contents, 
        this.db, 
        this.vaultRandomID, 
        client.serviceType, 
        this.settings.password
      );

      // Step 7 - get local files
      await notifyFunc(triggerSource, 6);
      const local = this.app.vault.getAllLoadedFiles();
      const localHistory = await this.getLocalHistory();
      let localConfigDirContents: ObsConfigDirFileType[] = await listFilesInObsFolder(this.app.vault, this.manifest.id, this.settings.syncTrash);
      const origMetadataOnRemote = await this.fetchMetadataFromRemote(metadataFile, client);

      // Step 8 - generate sync plan
      await notifyFunc(triggerSource, 7);
      const {
        plan, sortedKeys, deletions, sizesGoWrong
      } = await this.getSyncPlan(remoteStates, local, localConfigDirContents, origMetadataOnRemote, localHistory, client, triggerSource);

      // Step 9 - execute sync
      await this.doActualSync(client, plan, sortedKeys, metadataFile, origMetadataOnRemote, sizesGoWrong, deletions, self);

      // Step 10 - update last synced time
      this.settings.lastSynced = Date.now();
      await this.saveSettings();

      // Update status bar with the latest sync time
      this.updateSyncStatus("idle");

      // Step 8 (finish)
      notifyFunc(triggerSource, 8);
      statusBarFunc(triggerSource, 8, true);

      this.setSyncIcon(false);
    } catch (error) {
      everythingOk = false;
      const msg = t("syncrun_abort", {
        manifestID: this.manifest.id,
        theDate: `${Date.now()}`,
        triggerSource: triggerSource,
        syncStatus: this.syncStatus,
      });
      log.error(msg);
      log.error(error);
      getNotice(triggerSource, msg, 10 * 1000);
      if (error instanceof AggregateError) {
        for (const e of error.errors) {
          getNotice(triggerSource, e.message, 10 * 1000);
        }
      } else {
        getNotice(triggerSource, error.message, 10 * 1000);
      }
      this.updateSyncStatus("idle");
      this.setSyncIcon(false);
    }
  }

  private async createTrashIfDoesNotExist() {
    if (this.settings.syncTrash) {
      // when syncing to a device which never trashed a file we will error if this folder does not exist
      await this.createTrashFolderIfDoesNotExist(this.app.vault);
    }
  }

  private shouldSyncBasedOnSyncPlan = async (syncPlan: SyncPlanType) => {
    for (const key in syncPlan.mixedStates) {
      const fileState = syncPlan.mixedStates[key];

      if (fileState.existLocal && fileState.existRemote && fileState.mtimeLocal! > fileState.mtimeRemote!) {
        return true;
      }
    }
    return false;
  };

  private async doActualSync(client: RemoteClient, plan: SyncPlanType, sortedKeys: string[], metadataFile: FileOrFolderMixedState, origMetadataOnRemote: MetadataOnRemote, sizesGoWrong: FileOrFolderMixedState[], deletions: DeletionOnRemote[], self: this) {
    const t = (x: TransItemType, vars?: any) => {
      return this.i18n.t(x, vars);
    };
    const effectiveConcurrency =
      client.serviceType === "webdav"
        ? 1
        : this.settings.concurrency;
    return doActualSync(
      client,
      this.db,
      this.vaultRandomID,
      this.app.vault,
      plan,
      sortedKeys,
      metadataFile,
      origMetadataOnRemote,
      sizesGoWrong,
      deletions,
      (key: string) => self.trash(key),
      this.settings.password,
      this.settings.lastSynced,
      effectiveConcurrency,
      (ss: FileOrFolderMixedState[]) => {
        new SizesConflictModal(
          self.app,
          self,
          this.settings.skipSizeLargerThan,
          ss,
          this.settings.password !== ""
        ).open();
      },
      (i: number, total: number) => self.updateStatusBar({i, total}),
      this.settings.protectModifyPercentage,
      (errorMsg: string) => {
        // Parse error message: format is "syncrun_abort_protectmodifypercentage|threshold|realCount|allCount|percent"
        const parts = errorMsg.split("|");
        if (parts[0] === "syncrun_abort_protectmodifypercentage") {
          const [_, threshold, realCount, allCount, percent] = parts;
          const msg = t("syncrun_abort_protectmodifypercentage", {
            protectModifyPercentage: parseInt(threshold),
            realModifyDeleteCount: parseInt(realCount),
            allFilesCount: parseInt(allCount),
            percent: percent,
          });
          new Notice(msg, 0); // 0 means persistent notice
        }
      }
    );
  }

  private async getSyncPlan(remoteStates: FileOrFolderMixedState[], local: TAbstractFile[], localConfigDirContents: ObsConfigDirFileType[], origMetadataOnRemote: MetadataOnRemote, localHistory: FileFolderHistoryRecord[], client: RemoteClient, triggerSource: "manual" | "auto" | "autoOnceInit" | "dry") {
    return await getSyncPlan(
      remoteStates,
      local,
      localConfigDirContents,
      origMetadataOnRemote.deletions,
      localHistory,
      client.serviceType,
      triggerSource,
      this.app.vault,
      this.settings.syncConfigDir,
      this.settings.syncTrash,
      this.settings.syncBookmarks,
      this.app.vault.configDir,
      this.settings.syncUnderscoreItems,
      this.settings.skipSizeLargerThan,
      this.settings.password,
      this.settings.syncDirection ?? "bidirectional"
    );
  }

  private async getLocalHistory() {
    return await loadFileHistoryTableByVault(
      this.db,
      this.vaultRandomID
    );
  }

  private async fetchMetadataFromRemote(metadataFile: FileOrFolderMixedState, client: RemoteClient) {
    if (metadataFile === undefined) {
      log.debug("no metadata file, so no fetch");
      return {
        deletions: [],
      } as MetadataOnRemote;
    }

    const buf = await client.downloadFromRemote(
      metadataFile.key,
      this.app.vault,
      metadataFile.mtimeRemote,
      this.settings.password,
      metadataFile.remoteEncryptedKey,
      true
    );
    return deserializeMetadataOnRemote(buf);
  }

  private getRemoteClient(self: this) {
    const client = new RemoteClient(
      this.settings.serviceType,
      this.settings.s3,
      this.settings.webdav,
      this.settings.onedrive,
      this.app.vault.getName(),
      () => self.saveSettings()
    );
    return client;
  }

  private updateSyncStatus(status: SyncStatusType) {
    this.syncStatus = status;
    this.updateStatusBar();
  }

  private setSyncIcon(running: boolean, triggerSource?: "manual" | "auto" | "dry" | "autoOnceInit") {
    if (this.syncRibbon === undefined) {
      return;
    }

    if (running) {
      setIcon(this.syncRibbon, iconNameSyncRunning);

      this.syncRibbon.setAttribute(
        "aria-label",
        this.i18n.t("syncrun_syncingribbon", {
          pluginName: this.manifest.name,
          triggerSource: triggerSource,
        })
      );
    } else {
      setIcon(this.syncRibbon, iconNameSyncWait);
      
      this.syncRibbon.setAttribute("aria-label", this.manifest.name);
    }
  }

  // Helper function to get status bar prefix from sync source (like remotely-save)
  private getStatusBarShortMsgFromSyncSource(s: SyncTriggerSourceType | undefined): string {
    if (s === undefined) {
      return "";
    }
    switch (s) {
      case "manual":
        return this.i18n.t("statusbar_sync_source_manual");
      case "dry":
        return this.i18n.t("statusbar_sync_source_dry");
      case "auto":
        return this.i18n.t("statusbar_sync_source_auto");
      case "autoOnceInit":
        return this.i18n.t("statusbar_sync_source_auto_once_init");
      default:
        return "";
    }
  }

  // Set current sync progress message (called during sync)
  private setCurrSyncMsg(i: number, total: number, pathName?: string) {
    if (this.statusBarElement === undefined) return;

    const L = `${total}`.length;
    const iStr = `${i}`.padStart(L, "0");
    const prefix = this.getStatusBarShortMsgFromSyncSource(this.currentTriggerSource);
    const shortMsg = prefix + this.i18n.t("syncrun_status_progress", {
      current: iStr,
      total: total.toString()
    });
    
    this.currSyncMsg = shortMsg;
    
    if (pathName) {
      this.statusBarElement.setAttribute("aria-label", `${shortMsg} - ${pathName}`);
    }
    this.statusBarElement.setText(shortMsg);
  }

  // Update last sync message (called when sync finishes or on idle)
  private updateLastSyncMsg(lastSyncedMillis?: number) {
    if (this.statusBarElement === undefined) return;

    let lastSyncMsg: string;
    let lastSyncLabelMsg: string;

    // Use the provided lastSyncedMillis if available, otherwise use settings.lastSynced
    const syncTime = lastSyncedMillis !== undefined ? lastSyncedMillis : this.settings.lastSynced;

    if (syncTime !== undefined && syncTime > 0) {
      const deltaTime = Date.now() - syncTime;
      const seconds = Math.floor(deltaTime / 1000);

      if (seconds < 60) {
        // Within 1 minute - show "刚刚" (just now)
        lastSyncMsg = this.i18n.t("statusbar_time_now");
      } else {
        lastSyncMsg = getLastSynced(this.i18n, syncTime).lastSyncMsg;
      }
      lastSyncLabelMsg = lastSyncMsg;
    } else {
      lastSyncMsg = this.i18n.t("statusbar_lastsync_never");
      lastSyncLabelMsg = this.i18n.t("statusbar_lastsync_never_label");
    }

    this.statusBarElement.setText(lastSyncMsg);
    this.statusBarElement.setAttribute("aria-label", lastSyncLabelMsg);
  }

  private updateStatusBar(syncQueue?: {i: number, total: number}) {
    const enabled = this.statusBarElement !== undefined && 
      this.settings.enableStatusBarInfo === true;

    if (!enabled) return;

    if (this.syncStatus === "syncing" && syncQueue !== undefined) {
      // During sync - show progress with prefix
      this.setCurrSyncMsg(syncQueue.i, syncQueue.total);
    } else if (this.syncStatus === "idle") {
      // Idle - show last sync time
      this.updateLastSyncMsg(this.settings.lastSynced);
    }
  }

  async promptAgreement(): Promise<boolean> {
    return new Promise((resolve) => {
      new SyncAlgoV2Modal(this.app, this.i18n, (result) => resolve(result)).open();
    });
  }

  async onload() {
    this.oauth2Info = {
      verifier: "",
      helperModal: undefined,
      authDiv: undefined,
      revokeDiv: undefined,
      revokeAuthSetting: undefined,
    }; // init

    this.currSyncMsg = "";

    await this.loadSettings();
    await this.checkIfPresetRulesFollowed();

    // lang should be load early, but after settings
    this.i18n = new I18n(this.settings.lang, async (lang: LangTypeAndAuto) => {
      this.settings.lang = lang;
      await this.saveSettings();
    });
    const t = (x: TransItemType, vars?: any) => {
      return this.i18n.t(x, vars);
    };

    // Check if they have agreed to uploading metadata
    if (!this.settings.agreeToUploadExtraMetadata) {
      const agreed = await this.promptAgreement();

      if (agreed) {
        this.settings.agreeToUploadExtraMetadata = true;
        await this.saveSettings();
      } else {
        this.unload();
        return;
      }
    }

    if (this.settings.debugEnabled) {
      log.setLevel("debug");
    }

    await this.checkIfOauthExpires();

    // MUST before prepareDB()
    // And, it's also possible to be an empty string,
    // which means the vaultRandomID is read from db later!
    const vaultRandomIDFromOldConfigFile =
      await this.getVaultRandomIDFromOldConfigFile();

    // no need to await this
    this.tryToAddIgnoreFile();

    const vaultBasePath = this.getVaultBasePath();

    try {
      await this.prepareDBAndVaultRandomID(
        vaultBasePath,
        vaultRandomIDFromOldConfigFile
      );
    } catch (err) {
      new Notice(err.message, 10 * 1000);
      throw err;
    }

    // must AFTER preparing DB
    this.addOutputToDBIfSet();
    this.enableAutoClearOutputToDBHistIfSet();

    // must AFTER preparing DB
    this.enableAutoClearSyncPlanHist();

    this.registerEvent(
      this.app.vault.on("delete", async (fileOrFolder) => {
        await insertDeleteRecordByVault(
          this.db,
          fileOrFolder,
          this.vaultRandomID
        );
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", async (fileOrFolder, oldPath) => {
        await insertRenameRecordByVault(
          this.db,
          fileOrFolder,
          oldPath,
          this.vaultRandomID
        );
      })
    );

    this.registerObsidianProtocolHandler(COMMAND_URI, async (inputParams) => {
      const parsed = importQrCodeUri(inputParams, this.app.vault.getName());
      if (parsed.status === "error") {
        new Notice(parsed.message);
      } else {
        const copied = cloneDeep(parsed.result);
        // new Notice(JSON.stringify(copied))
        this.settings = {
          ...this.settings,
          ...copied,
          s3: {
            ...this.settings.s3,
            ...(copied?.s3 ?? {}),
          },
          webdav: {
            ...this.settings.webdav,
            ...(copied?.webdav ?? {}),
          },
          onedrive: {
            ...this.settings.onedrive,
            ...(copied?.onedrive ?? {}),
          },
        };
        this.saveSettings();
        new Notice(
          t("protocol_saveqr", {
            manifestName: this.manifest.name,
          })
        );
      }
    });

    this.registerObsidianProtocolHandler(
      COMMAND_CALLBACK,
      async (inputParams) => {
        new Notice(
          t("protocol_callbacknotsupported", {
            params: JSON.stringify(inputParams),
          })
        );
      }
    );

    this.registerObsidianProtocolHandler(
      COMMAND_CALLBACK_ONEDRIVE,
      async (inputParams) => {
        if (inputParams.code !== undefined) {
          if (this.oauth2Info.helperModal !== undefined) {
            this.oauth2Info.helperModal.contentEl.empty();

            t("protocol_onedrive_connecting")
              .split("\n")
              .forEach((val: string) => {
                this.oauth2Info.helperModal.contentEl.createEl("p", {
                  text: val,
                });
              });
          }

          let rsp = await sendAuthReqOnedrive(
            this.settings.onedrive.clientID,
            this.settings.onedrive.authority,
            inputParams.code,
            this.oauth2Info.verifier
          );

          if ((rsp as any).error !== undefined) {
            throw Error(`${JSON.stringify(rsp)}`);
          }

          const self = this;
          setConfigBySuccessfullAuthInplaceOnedrive(
            this.settings.onedrive,
            rsp as AccessCodeResponseSuccessfulType,
            () => self.saveSettings()
          );

          const client = new RemoteClient(
            "onedrive",
            undefined,
            undefined,
            this.settings.onedrive,
            this.app.vault.getName(),
            () => self.saveSettings()
          );
          this.settings.onedrive.username = await client.getUser();
          await this.saveSettings();

          this.oauth2Info.verifier = ""; // reset it
          this.oauth2Info.helperModal?.close(); // close it
          this.oauth2Info.helperModal = undefined;

          this.oauth2Info.authDiv?.toggleClass(
            "onedrive-auth-button-hide",
            this.settings.onedrive.username !== ""
          );
          this.oauth2Info.authDiv = undefined;

          this.oauth2Info.revokeAuthSetting?.setDesc(
            t("protocol_onedrive_connect_succ_revoke", {
              username: this.settings.onedrive.username,
            })
          );
          this.oauth2Info.revokeAuthSetting = undefined;
          this.oauth2Info.revokeDiv?.toggleClass(
            "onedrive-revoke-auth-button-hide",
            this.settings.onedrive.username === ""
          );
          this.oauth2Info.revokeDiv = undefined;
        } else {
          new Notice(t("protocol_onedrive_connect_fail"));
          throw Error(
            t("protocol_onedrive_connect_unknown", {
              params: JSON.stringify(inputParams),
            })
          );
        }
      }
    );

    this.syncRibbon = this.addRibbonIcon(
      iconNameSyncWait,
      `${this.manifest.name}`,
      async () => this.syncRun("manual")
    );

    this.addCommand({
      id: "start-sync",
      name: t("command_startsync"),
      icon: iconNameSyncWait,
      callback: async () => {
        this.syncRun("manual");
      },
    });

    this.addCommand({
      id: "start-sync-dry-run",
      name: t("command_drynrun"),
      icon: iconNameSyncWait,
      callback: async () => {
        this.syncRun("dry");
      },
    });

    this.addCommand({
      id: "export-sync-plans-json",
      name: t("command_exportsyncplans_json"),
      icon: iconNameLogs,
      callback: async () => {
        await exportVaultSyncPlansToFiles(
          this.db,
          this.app.vault,
          this.vaultRandomID,
          "json"
        );
        new Notice(t("settings_syncplans_notice"));
      },
    });

    this.addCommand({
      id: "export-sync-plans-table",
      name: t("command_exportsyncplans_table"),
      icon: iconNameLogs,
      callback: async () => {
        await exportVaultSyncPlansToFiles(
          this.db,
          this.app.vault,
          this.vaultRandomID,
          "table"
        );
        new Notice(t("settings_syncplans_notice"));
      },
    });

    this.addCommand({
      id: "export-logs-in-db",
      name: t("command_exportlogsindb"),
      icon: iconNameLogs,
      callback: async () => {
        await exportVaultLoggerOutputToFiles(
          this.db,
          this.app.vault,
          this.vaultRandomID
        );
        new Notice(t("settings_logtodbexport_notice"));
      },
    });

    this.addCommand({
      id: "get-sync-status",
      name: t("command_syncstatus"),
      icon: iconNameStatusBar,
      callback: () => new Notice(this.syncStatusText)
    });
    
    this.addSettingTab(new ThirdPartySyncSettingTab(this.app, this));

    // Show status bar show by default on desktop only
    if (this.settings.enableStatusBarInfo === undefined) {
      this.settings.enableStatusBarInfo = Platform.isMobile ? false : true;
    }

    this.saveSettings();

    // this.registerDomEvent(document, "click", (evt: MouseEvent) => {
    //   log.info("click", evt);
    // });

    this.enableAutoSyncIfSet();
    this.enableInitSyncIfSet();

    this.toggleSyncOnRemote(true);
    this.toggleSyncOnSave(true);
    this.toggleStatusBar(true);
    this.toggleStatusText(true);

    this.updateSyncStatus("idle");
  }

  async onunload() {
    this.syncRibbon = undefined;
    if (this.oauth2Info !== undefined) {
      this.oauth2Info.helperModal = undefined;
      this.oauth2Info = undefined;
    }

    // Disable Features
    this.toggleSyncOnSave(false);
    this.toggleSyncOnRemote(false);
    this.toggleStatusText(false);
    this.toggleStatusBar(false);
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      cloneDeep(DEFAULT_SETTINGS),
      messyConfigToNormal(await this.loadData())
    );
    if (this.settings.onedrive.clientID === "") {
      this.settings.onedrive.clientID = DEFAULT_SETTINGS.onedrive.clientID;
    }
    if (this.settings.onedrive.authority === "") {
      this.settings.onedrive.authority = DEFAULT_SETTINGS.onedrive.authority;
    }
    if (this.settings.onedrive.remoteBaseDir === undefined) {
      this.settings.onedrive.remoteBaseDir = "";
    }
    if (this.settings.webdav.manualRecursive === undefined) {
      this.settings.webdav.manualRecursive = false;
    }
    if (this.settings.webdav.depth === undefined) {
      this.settings.webdav.depth = "auto_unknown";
    }
    if (this.settings.webdav.remoteBaseDir === undefined) {
      this.settings.webdav.remoteBaseDir = "";
    }
    if (this.settings.s3.partsConcurrency === undefined) {
      this.settings.s3.partsConcurrency = 20;
    }
    if (this.settings.s3.forcePathStyle === undefined) {
      this.settings.s3.forcePathStyle = false;
    }
    if (this.settings.s3.disableS3MetadataSync == undefined) {
      this.settings.s3.disableS3MetadataSync = false;
    }
  }

  async checkIfPresetRulesFollowed() {
    const res = applyPresetRulesInplace(this.settings);
    if (res.changed) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(normalConfigToMessy(this.settings));
  }

  async checkIfOauthExpires() {
    let needSave: boolean = false;
    const current = Date.now();

    // fullfill old version settings
    if (
      this.settings.onedrive.refreshToken !== "" &&
      this.settings.onedrive.credentialsShouldBeDeletedAtTime === undefined
    ) {
      this.settings.onedrive.credentialsShouldBeDeletedAtTime =
        current + 1000 * 60 * 60 * 24 * 30;
      needSave = true;
    }

    // check expired or not
    let onedriveExpired = false;
    if (
      this.settings.onedrive.refreshToken !== "" &&
      current >= this.settings.onedrive.credentialsShouldBeDeletedAtTime
    ) {
      onedriveExpired = true;
      this.settings.onedrive = cloneDeep(DEFAULT_ONEDRIVE_CONFIG);
      needSave = true;
    }

    // save back
    if (needSave) {
      await this.saveSettings();
    }

    // send notice
    if (onedriveExpired) {
      new Notice(
        `${this.manifest.name}: You haven't manually auth OneDrive for a while, you need to re-auth it again.`,
        6000
      );
    }
  }

  async getVaultRandomIDFromOldConfigFile() {
    let vaultRandomID = "";
    if (this.settings.vaultRandomID !== undefined) {
      // In old version, the vault id is saved in data.json
      // But we want to store it in localForage later
      if (this.settings.vaultRandomID !== "") {
        // a real string was assigned before
        vaultRandomID = this.settings.vaultRandomID;
      }
      delete this.settings.vaultRandomID;
      await this.saveSettings();
    }
    return vaultRandomID;
  }

  async trash(x: string) {
    if (this.settings.trashLocal) {
      await this.app.vault.adapter.trashLocal(x);
      return;
    } else {
      // Attempt using system trash, if it fails fallback to trashing into .trash folder
      if (!(await this.app.vault.adapter.trashSystem(x))) {
        await this.app.vault.adapter.trashLocal(x);
      }
    }
  }

  getVaultBasePath() {
    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      // in desktop
      return this.app.vault.adapter.getBasePath().split("?")[0];
    } else {
      // in mobile
      return this.app.vault.adapter.getResourcePath("").split("?")[0];
    }
  }

  async prepareDBAndVaultRandomID(
    vaultBasePath: string,
    vaultRandomIDFromOldConfigFile: string
  ) {
    const { db, vaultRandomID } = await prepareDBs(
      vaultBasePath,
      vaultRandomIDFromOldConfigFile
    );
    this.db = db;
    this.vaultRandomID = vaultRandomID;
  }

  // Needed to update text for get command
  toggleStatusText(enabled: boolean) {
    // Clears the current interval
    if (this.statusBarIntervalID !== undefined) {
      window.clearInterval(this.statusBarIntervalID);
      this.statusBarIntervalID = undefined;
    }

    // Set up interval
    if (enabled) {
      this.statusBarIntervalID = window.setInterval(async () => {
        if (this.syncStatus !== "syncing") {
          this.updateStatusBar();
        }
      }, 30_000);

      this.updateStatusBar();
    }
  }

  toggleStatusBar(enabled: boolean) {  
    this.statusBarElement?.remove();

    const statusBar = document.getElementsByClassName("status-bar")[0] as HTMLElement;

    // Guard: if status bar doesn't exist (e.g., iOS), skip DOM manipulation
    if (!statusBar) {
      return;
    }

    // Remove any third-party sync classes
    statusBar.removeClass("third-party-sync-show-status-bar");
    statusBar.style.marginBottom = "0px";

    Array.from(statusBar.children).forEach((element) => {
      element.removeClass("third-party-sync-hidden");
    });

    if (enabled && this.settings.enableStatusBarInfo) {
      // Enable status bar on mobile
      if (Platform.isMobile) {
        statusBar.addClass("third-party-sync-show-status-bar");
        
        // Shifts up the status bar on phone to not cover the navmenu
        if (Platform.isPhone) {
          const navBar = document.getElementsByClassName("mobile-navbar")[0] as HTMLElement;
          const height = window.getComputedStyle(navBar).getPropertyValue('height');
          statusBar.style.marginBottom = height;
        }
      }

      // Create third-party sync element
      this.statusBarElement = this.addStatusBarItem();
      this.statusBarElement.createEl("span");
      this.statusBarElement.setAttribute("data-tooltip-position", "top");    
      this.updateStatusBar(); 
    }
  }

  async toggleSyncOnRemote(enabled: boolean) {
    // Clears the current interval
    if (this.syncOnRemoteIntervalID !== undefined) {
      window.clearInterval(this.syncOnRemoteIntervalID);
      this.syncOnRemoteIntervalID = undefined;
    }

    if (enabled === false || this.settings.syncOnRemoteChangesAfterMilliseconds === -1) {
      return;
    }

    let checkingMetadata = false;

    const syncOnRemote = async () => {
      if (this.syncStatus !== "idle" || checkingMetadata) {
        return;
      }

      checkingMetadata = true;
      const metadataMtime = await this.getMetadataMtime();
      checkingMetadata = false;

      if (metadataMtime === undefined) {
        return false;
      }

      if (metadataMtime !== this.settings.lastSynced) {
        log.debug("Sync on Remote ran | Remote Metadata:", metadataMtime + ", Last Synced:", this.settings.lastSynced);
        this.syncRun("auto");
        return true;
      }
    };

    if (Platform.isMobileApp) {
      const onLoadResult = await syncOnRemote();
      new Notice(onLoadResult === true ? this.i18n.t("remote_changes_found") : this.i18n.t("remote_changes_synced"));
    }

    this.syncOnRemoteIntervalID = window.setInterval(syncOnRemote, this.settings.syncOnRemoteChangesAfterMilliseconds);
  }

  async toggleSyncOnSave(enabled: boolean) {
    let alreadyScheduled = false;

    // Unregister vault change event
    if (this.syncOnSaveEvent !== undefined) {
      this.app.vault.offref(this.syncOnSaveEvent);
      this.syncOnSaveEvent = undefined;
    }

    // Unregister scanning for .obsidian changes
    if (this.vaultScannerIntervalId !== undefined) {
      window.clearInterval(this.vaultScannerIntervalId);
      this.vaultScannerIntervalId = undefined;
    }

    if (enabled === false || this.settings.syncOnSaveAfterMilliseconds === -1) {
      return;
    }
    
    // Register vault change event
    this.syncOnSaveEvent = this.app.vault.on("modify", () => {
      if (this.syncStatus !== "idle" || alreadyScheduled) {
        return;
      }

      alreadyScheduled = true;
      log.debug(`Scheduled a sync run for ${this.settings.syncOnSaveAfterMilliseconds} milliseconds later`);

      setTimeout(async () => {
        log.debug("Sync on save ran");
        await this.syncRun("auto");  
        alreadyScheduled = false;
      }, this.settings.syncOnSaveAfterMilliseconds);
    });

    // Scan vault for config directory changes
    const scanVault = async () => {
      if (this.syncStatus !== "idle" || alreadyScheduled || !this.settings.syncConfigDir) {
        return;
      }

      log.debug("Scanning config directory for changes");

      let localConfigContents: ObsConfigDirFileType[] = await listFilesInObsFolder(this.app.vault, this.manifest.id, this.settings.syncTrash);

      for (let i = 0; i < localConfigContents.length; i++) {
        const file = localConfigContents[i];

        if (file.key.includes(".obsidian/plugins/remotely-secure/")) {
          continue;
        }

        if (file.mtime > this.settings.lastSynced) {
          log.debug("Unsynced config file found: ", file.key)
          alreadyScheduled = true;
          log.debug(`Scheduled a sync run for ${this.settings.syncOnSaveAfterMilliseconds} milliseconds later`);

          setTimeout(async () => {
            log.debug("Sync on save ran");
            await this.syncRun("auto");  
            alreadyScheduled = false;
          }, this.settings.syncOnSaveAfterMilliseconds);

          break;
        }
      }
    }

    // Scans every 60 seconds
    this.vaultScannerIntervalId = window.setInterval(scanVault, 30_000);
  }
  
  async getMetadataMtime() {
    const client = this.getRemoteClient(this);
    
    const remoteFiles = await client.listFromRemote();
    const remoteMetadataFile = await getRemoteMetadata(remoteFiles.Contents, client, this.settings.password);

    const lastSynced = remoteMetadataFile.mtimeRemote;

    if (lastSynced === undefined && this.settings.lastSynced !== undefined) {
      return this.settings.lastSynced;
    }

    return lastSynced;
  }

  private async getSyncPlan2() {
    // If we don't create trash folder and it's used it will result in an error.
    await this.createTrashIfDoesNotExist();
    const client = this.getRemoteClient(this);
    const remoteRsp = await client.listFromRemote();

    const passwordCheckResult = await isPasswordOk(
      remoteRsp.Contents,
      this.settings.password
    );

    const metadataFile = await getRemoteMetadata(remoteRsp.Contents, client, this.settings.password);

    const remoteStates = await getRemoteStates(
      remoteRsp.Contents, 
      this.db, 
      this.vaultRandomID, 
      client.serviceType, 
      this.settings.password
    );

    const local = this.app.vault.getAllLoadedFiles();
    const localHistory = await this.getLocalHistory();
    let localConfigDirContents: ObsConfigDirFileType[] = await listFilesInObsFolder(this.app.vault, this.manifest.id, this.settings.syncTrash);
    const origMetadataOnRemote = await this.fetchMetadataFromRemote(metadataFile, client);


    const {
      plan
    } = await this.getSyncPlan(remoteStates, local, localConfigDirContents, origMetadataOnRemote, localHistory, client, "auto");
    return plan;
  }

  enableAutoSyncIfSet() {
    if (
      this.settings.autoRunEveryMilliseconds !== undefined &&
      this.settings.autoRunEveryMilliseconds !== null &&
      this.settings.autoRunEveryMilliseconds > 0
    ) {
      this.app.workspace.onLayoutReady(() => {
        const intervalID = window.setInterval(() => {
          this.syncRun("auto");
        }, this.settings.autoRunEveryMilliseconds);
        this.autoRunIntervalID = intervalID;
        this.registerInterval(intervalID);
      });
    }
  }

  enableInitSyncIfSet() {
    if (
      this.settings.initRunAfterMilliseconds !== undefined &&
      this.settings.initRunAfterMilliseconds !== null &&
      this.settings.initRunAfterMilliseconds > 0
    ) {
      this.app.workspace.onLayoutReady(() => {
        window.setTimeout(() => {
          this.syncRun("autoOnceInit");
        }, this.settings.initRunAfterMilliseconds);
      });
    }
  }

  /**
   * Because data.json contains sensitive information,
   * We usually want to ignore it in the version control.
   * However, if there's already a an ignore file (even empty),
   * we respect the existing configure and not add any modifications.
   * @returns
   */
  async tryToAddIgnoreFile() {
    const pluginConfigDir = this.manifest.dir;
    const pluginConfigDirExists = await this.app.vault.adapter.exists(
      pluginConfigDir
    );
    if (!pluginConfigDirExists) {
      // what happened?
      return;
    }
    const ignoreFile = `${pluginConfigDir}/.gitignore`;
    const ignoreFileExists = await this.app.vault.adapter.exists(ignoreFile);

    const contentText = "data.json\n";

    try {
      if (!ignoreFileExists) {
        // not exists, directly create
        // no need to await
        this.app.vault.adapter.write(ignoreFile, contentText);
      }
    } catch (error) {
      // just skip
    }
  }

  addOutputToDBIfSet() {
    if (this.settings.logToDB) {
      applyLogWriterInplace((...msg: any[]) => {
        insertLoggerOutputByVault(this.db, this.vaultRandomID, ...msg);
      });
    }
  }

  enableAutoClearOutputToDBHistIfSet() {
    const initClearOutputToDBHistAfterMilliseconds = 1000 * 45;
    const autoClearOutputToDBHistAfterMilliseconds = 1000 * 60 * 5;

    this.app.workspace.onLayoutReady(() => {
      // init run
      window.setTimeout(() => {
        if (this.settings.logToDB) {
          clearExpiredLoggerOutputRecords(this.db);
        }
      }, initClearOutputToDBHistAfterMilliseconds);

      // scheduled run
      const intervalID = window.setInterval(() => {
        if (this.settings.logToDB) {
          clearExpiredLoggerOutputRecords(this.db);
        }
      }, autoClearOutputToDBHistAfterMilliseconds);
      this.registerInterval(intervalID);
    });
  }

  enableAutoClearSyncPlanHist() {
    const initClearSyncPlanHistAfterMilliseconds = 1000 * 45;
    const autoClearSyncPlanHistAfterMilliseconds = 1000 * 60 * 5;

    this.app.workspace.onLayoutReady(() => {
      // init run
      window.setTimeout(() => {
        clearExpiredSyncPlanRecords(this.db);
      }, initClearSyncPlanHistAfterMilliseconds);

      // scheduled run
      const intervalID = window.setInterval(() => {
        clearExpiredSyncPlanRecords(this.db);
      }, autoClearSyncPlanHistAfterMilliseconds);
      this.registerInterval(intervalID);
    });
  }

  private async createTrashFolderIfDoesNotExist(vault: Vault) {
    let trashStat = await vault.adapter.stat('.trash');
    if (trashStat == null) {
      await vault.adapter.mkdir('.trash');
    }
  }
}
