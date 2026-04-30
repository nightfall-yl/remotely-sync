import {
  App,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  Platform,
  requireApiVersion,
  setIcon,
} from "obsidian";
import cloneDeep from "lodash/cloneDeep";
import type { TextComponent } from "obsidian";
import {
  API_VER_REQURL,
  DEFAULT_DEBUG_FOLDER,
  SUPPORTED_SERVICES_TYPE,
  SUPPORTED_SERVICES_TYPE_WITH_REMOTE_BASE_DIR,
  SyncDirectionType,
  UriParams,
  VALID_REQURL,
  WebdavAuthType,
  WebdavDepthType,
  DeleteToWhereType,
} from "./baseTypes";
import {
  exportVaultSyncPlansToFiles,
  exportVaultLoggerOutputToFiles,
} from "./debugMode";
import { exportSettingsUri, importQrCodeUri } from "./importExport";
import {
  clearAllSyncMetaMapping,
  clearAllSyncPlanRecords,
  destroyDBs,
  clearAllLoggerOutputRecords,
  insertLoggerOutputByVault,
  clearExpiredLoggerOutputRecords,
} from "./localdb";
import type ThirdPartySyncPlugin from "./main"; // unavoidable
import { RemoteClient } from "./remote";
import {
  DEFAULT_ONEDRIVE_CONFIG,
  getAuthUrlAndVerifier as getAuthUrlAndVerifierOnedrive,
} from "./remoteForOnedrive";
import { messyConfigToNormal } from "./configPersist";
import type { TransItemType } from "./i18n";
import { checkHasSpecialCharForDir } from "./misc";
import { applyWebdavPresetRulesInplace } from "./presetRules";

import {
  applyLogWriterInplace,
  log,
  restoreLogWritterInplace,
} from "./moreOnLog";
import {encryptStringToBase64url} from "./encrypt";
import {DEFAULT_FILE_NAME_FOR_METADATAONREMOTE, DEFAULT_FILE_NAME_FOR_METADATAONREMOTE2} from "./metadataOnRemote";
import {getRemoteMetadata, uploadExtraMeta} from "./sync";

class PasswordModal extends Modal {
  plugin: ThirdPartySyncPlugin;
  newPassword: string;

  constructor(app: App, plugin: ThirdPartySyncPlugin, newPassword: string) {
    super(app);
    this.plugin = plugin;
    this.newPassword = newPassword;
  }

  onOpen() {
    let { contentEl } = this;

    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    // contentEl.setText("Add Or change password.");
    contentEl.createEl("h2", { text: t("modal_password_title") });
    t("modal_password_shortdesc")
      .split("\n")
      .forEach((val, idx) => {
        contentEl.createEl("p", {
          text: val,
        });
      });

    [
      t("modal_password_attn1"),
      t("modal_password_attn2"),
      t("modal_password_attn3"),
      t("modal_password_attn4"),
      t("modal_password_attn5"),
    ].forEach((val, idx) => {
      if (idx < 3) {
        contentEl.createEl("p", {
          text: val,
          cls: "password-disclaimer",
        });
      } else {
        contentEl.createEl("p", {
          text: val,
        });
      }
    });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t("modal_password_secondconfirm"));
        button.onClick(async () => {
          this.plugin.settings.password = this.newPassword;
          await this.plugin.saveSettings();
          new Notice(t("modal_password_notice"));
          this.close();
        });
        button.setClass("password-second-confirm");
      })
      .addButton((button) => {
        button.setButtonText(t("goback"));
        button.onClick(() => {
          this.close();
        });
      });
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

class ChangeRemoteBaseDirModal extends Modal {
  readonly plugin: ThirdPartySyncPlugin;
  readonly newRemoteBaseDir: string;
  readonly service: SUPPORTED_SERVICES_TYPE_WITH_REMOTE_BASE_DIR;
  constructor(
    app: App,
    plugin: ThirdPartySyncPlugin,
    newRemoteBaseDir: string,
    service: SUPPORTED_SERVICES_TYPE_WITH_REMOTE_BASE_DIR
  ) {
    super(app);
    this.plugin = plugin;
    this.newRemoteBaseDir = newRemoteBaseDir;
    this.service = service;
  }

  onOpen() {
    let { contentEl } = this;

    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    contentEl.createEl("h2", { text: t("modal_remotebasedir_title") });
    t("modal_remotebasedir_shortdesc")
      .split("\n")
      .forEach((val, idx) => {
        contentEl.createEl("p", {
          text: val,
        });
      });

    if (
      this.newRemoteBaseDir === "" ||
      this.newRemoteBaseDir === this.app.vault.getName()
    ) {
      new Setting(contentEl)
        .addButton((button) => {
          button.setButtonText(
            t("modal_remotebasedir_secondconfirm_vaultname")
          );
          button.onClick(async () => {
            // in the settings, the value is reset to the special case ""
            this.plugin.settings[this.service].remoteBaseDir = "";
            await this.plugin.saveSettings();
            new Notice(t("modal_remotebasedir_notice"));
            this.close();
          });
          button.setClass("remotebasedir-second-confirm");
        })
        .addButton((button) => {
          button.setButtonText(t("goback"));
          button.onClick(() => {
            this.close();
          });
        });
    } else if (checkHasSpecialCharForDir(this.newRemoteBaseDir)) {
      contentEl.createEl("p", {
        text: t("modal_remotebasedir_invaliddirhint"),
      });
      new Setting(contentEl).addButton((button) => {
        button.setButtonText(t("goback"));
        button.onClick(() => {
          this.close();
        });
      });
    } else {
      new Setting(contentEl)
        .addButton((button) => {
          button.setButtonText(t("modal_remotebasedir_secondconfirm_change"));
          button.onClick(async () => {
            this.plugin.settings[this.service].remoteBaseDir =
              this.newRemoteBaseDir;
            this.plugin.settings.lastSynced = -1;
            await this.plugin.saveSettings();
            new Notice(t("modal_remotebasedir_notice"));
            this.close();
          });
          button.setClass("remotebasedir-second-confirm");
        })
        .addButton((button) => {
          button.setButtonText(t("goback"));
          button.onClick(() => {
            this.close();
          });
        });
    }
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

export class OnedriveAuthModal extends Modal {
  readonly plugin: ThirdPartySyncPlugin;
  readonly authDiv: HTMLDivElement;
  readonly revokeAuthDiv: HTMLDivElement;
  readonly revokeAuthSetting: Setting;
  constructor(
    app: App,
    plugin: ThirdPartySyncPlugin,
    authDiv: HTMLDivElement,
    revokeAuthDiv: HTMLDivElement,
    revokeAuthSetting: Setting
  ) {
    super(app);
    this.plugin = plugin;
    this.authDiv = authDiv;
    this.revokeAuthDiv = revokeAuthDiv;
    this.revokeAuthSetting = revokeAuthSetting;
  }

  async onOpen() {
    let { contentEl } = this;

    const { authUrl, verifier } = await getAuthUrlAndVerifierOnedrive(
      this.plugin.settings.onedrive.clientID,
      this.plugin.settings.onedrive.authority
    );
    this.plugin.oauth2Info.verifier = verifier;

    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    t("modal_onedriveauth_shortdesc")
      .split("\n")
      .forEach((val) => {
        contentEl.createEl("p", {
          text: val,
        });
      });
    const div2 = contentEl.createDiv();
    div2.createEl(
      "button",
      {
        text: t("modal_onedriveauth_copybutton"),
      },
      (el) => {
        el.onclick = async () => {
          await navigator.clipboard.writeText(authUrl);
          new Notice(t("modal_onedriveauth_copynotice"));
        };
      }
    );

    contentEl.createEl("p").createEl("a", {
      href: authUrl,
      text: authUrl,
    });
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

export class OnedriveRevokeAuthModal extends Modal {
  readonly plugin: ThirdPartySyncPlugin;
  readonly authDiv: HTMLDivElement;
  readonly revokeAuthDiv: HTMLDivElement;
  constructor(
    app: App,
    plugin: ThirdPartySyncPlugin,
    authDiv: HTMLDivElement,
    revokeAuthDiv: HTMLDivElement
  ) {
    super(app);
    this.plugin = plugin;
    this.authDiv = authDiv;
    this.revokeAuthDiv = revokeAuthDiv;
  }

  async onOpen() {
    let { contentEl } = this;
    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    contentEl.createEl("p", {
      text: t("modal_onedriverevokeauth_step1"),
    });
    const consentUrl = "https://microsoft.com/consent";
    contentEl.createEl("p").createEl("a", {
      href: consentUrl,
      text: consentUrl,
    });

    contentEl.createEl("p", {
      text: t("modal_onedriverevokeauth_step2"),
    });

    new Setting(contentEl)
      .setName(t("modal_onedriverevokeauth_clean"))
      .setDesc(t("modal_onedriverevokeauth_clean_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("modal_onedriverevokeauth_clean_button"));
        button.onClick(async () => {
          try {
            this.plugin.settings.onedrive = JSON.parse(
              JSON.stringify(DEFAULT_ONEDRIVE_CONFIG)
            );
            await this.plugin.saveSettings();
            this.authDiv.toggleClass(
              "onedrive-auth-button-hide",
              this.plugin.settings.onedrive.username !== ""
            );
            this.revokeAuthDiv.toggleClass(
              "onedrive-revoke-auth-button-hide",
              this.plugin.settings.onedrive.username === ""
            );
            new Notice(t("modal_onedriverevokeauth_clean_notice"));
            this.close();
          } catch (err) {
            console.error(err);
            new Notice(t("modal_onedriverevokeauth_clean_fail"));
          }
        });
      });
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

class SyncConfigDirModal extends Modal {
  plugin: ThirdPartySyncPlugin;
  saveDropdownFunc: () => void;
  constructor(
    app: App,
    plugin: ThirdPartySyncPlugin,
    saveDropdownFunc: () => void
  ) {
    super(app);
    this.plugin = plugin;
    this.saveDropdownFunc = saveDropdownFunc;
  }

  async onOpen() {
    let { contentEl } = this;

    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    t("modal_syncconfig_attn")
      .split("\n")
      .forEach((val) => {
        contentEl.createEl("p", {
          text: val,
        });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText(t("modal_syncconfig_secondconfirm"));
        button.onClick(async () => {
          this.plugin.settings.syncConfigDir = true;
          await this.plugin.saveSettings();
          this.saveDropdownFunc();
          new Notice(t("modal_syncconfig_notice"));
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText(t("goback"));
        button.onClick(() => {
          this.close();
        });
      });
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

const wrapTextWithPasswordHide = (text: TextComponent) => {
  const span = createSpan("Hi!");
  const hider = text.inputEl.insertAdjacentElement("afterend", span) as HTMLElement;
  // the init type of hider is "hidden" === eyeOff === password
  setIcon(hider, "eye-off");
  hider.addEventListener("click", (e) => {
    const isText = text.inputEl.getAttribute("type") === "text";
    let eyeIcon = isText ? "eye-off" : "eye";
    setIcon(hider, eyeIcon);
    text.inputEl.setAttribute("type", isText ? "password" : "text");
    text.inputEl.focus();
  });

  // the init type of text el is password
  text.inputEl.setAttribute("type", "password");
  return text;
};

export class ThirdPartySyncSettingTab extends PluginSettingTab {
  readonly plugin: ThirdPartySyncPlugin;
  deletingRemoteMeta: boolean;
  update: () => void;

  constructor(app: App, plugin: ThirdPartySyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.deletingRemoteMeta = false;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    const t = (x: TransItemType, vars?: any) => {
      return this.plugin.i18n.t(x, vars);
    };

    //////////////////////////////////////////////////
    // below for service chooser (part 1/2)
    //////////////////////////////////////////////////

    // we need to create the div in advance of any other service divs
    const serviceChooserDiv = containerEl.createDiv();
    serviceChooserDiv.createEl("h2", { text: t("settings_chooseservice") });

    //////////////////////////////////////////////////
    // below for s3
    //////////////////////////////////////////////////

    const s3Div = containerEl.createEl("div", { cls: "s3-hide" });
    s3Div.toggleClass("s3-hide", this.plugin.settings.serviceType !== "s3");
    s3Div.createEl("h2", { text: t("settings_s3") });

    const s3LongDescDiv = s3Div.createEl("div", { cls: "settings-long-desc" });

    for (const c of [
      t("settings_s3_disclaimer1"),
      t("settings_s3_disclaimer2"),
    ]) {
      s3LongDescDiv.createEl("p", {
        text: c,
        cls: "s3-disclaimer",
      });
    }

    if (!VALID_REQURL) {
      s3LongDescDiv.createEl("p", {
        text: t("settings_s3_cors"),
      });
    }

    s3LongDescDiv.createEl("p", {
      text: t("settings_s3_prod"),
    });

    const s3LinksUl = s3LongDescDiv.createEl("ul");

    s3LinksUl.createEl("li").createEl("a", {
      href: "https://docs.aws.amazon.com/general/latest/gr/s3.html",
      text: t("settings_s3_prod1"),
    });

    s3LinksUl.createEl("li").createEl("a", {
      href: "https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-your-credentials.html",
      text: t("settings_s3_prod2"),
    });

    if (!VALID_REQURL) {
      s3LinksUl.createEl("li").createEl("a", {
        href: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html",
        text: t("settings_s3_prod3"),
      });
    }

    new Setting(s3Div)
      .setName(t("settings_s3_endpoint"))
      .setDesc(t("settings_s3_endpoint"))
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.s3.s3Endpoint)
          .onChange(async (value) => {
            this.plugin.settings.s3.s3Endpoint = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(s3Div)
      .setName(t("settings_s3_region"))
      .setDesc(t("settings_s3_region_desc"))
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(`${this.plugin.settings.s3.s3Region}`)
          .onChange(async (value) => {
            this.plugin.settings.s3.s3Region = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(s3Div)
      .setName(t("settings_s3_accesskeyid"))
      .setDesc(t("settings_s3_accesskeyid_desc"))
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("")
          .setValue(`${this.plugin.settings.s3.s3AccessKeyID}`)
          .onChange(async (value) => {
            this.plugin.settings.s3.s3AccessKeyID = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(s3Div)
      .setName(t("settings_s3_secretaccesskey"))
      .setDesc(t("settings_s3_secretaccesskey_desc"))
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("")
          .setValue(`${this.plugin.settings.s3.s3SecretAccessKey}`)
          .onChange(async (value) => {
            this.plugin.settings.s3.s3SecretAccessKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(s3Div)
      .setName(t("settings_s3_bucketname"))
      .setDesc(t("settings_s3_bucketname"))
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(`${this.plugin.settings.s3.s3BucketName}`)
          .onChange(async (value) => {
            this.plugin.settings.s3.s3BucketName = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(s3Div)
      .setName(t("settings_s3_urlstyle"))
      .setDesc(t("settings_s3_urlstyle_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption(
          "virtualHostedStyle",
          t("settings_s3_urlstyle_virtual")
        );
        dropdown.addOption("pathStyle", t("settings_s3_urlstyle_path"));
        dropdown
          .setValue(
            this.plugin.settings.s3.forcePathStyle
              ? "pathStyle"
              : "virtualHostedStyle"
          )
          .onChange(async (val: string) => {
            this.plugin.settings.s3.forcePathStyle = val === "pathStyle";
            await this.plugin.saveSettings();
          });
      });

    if (VALID_REQURL) {
      new Setting(s3Div)
        .setName(t("settings_s3_bypasscorslocally"))
        .setDesc(t("settings_s3_bypasscorslocally_desc"))
        .addDropdown((dropdown) => {
          dropdown
            .addOption("disable", t("disable"))
            .addOption("enable", t("enable"));

          dropdown
            .setValue(
              `${this.plugin.settings.s3.bypassCorsLocally ? "enable" : "disable"
              }`
            )
            .onChange(async (value) => {
              if (value === "enable") {
                this.plugin.settings.s3.bypassCorsLocally = true;
              } else {
                this.plugin.settings.s3.bypassCorsLocally = false;
              }
              await this.plugin.saveSettings();
            });
        });
    }

    new Setting(s3Div)
      .setName(t("settings_s3_parts"))
      .setDesc(t("settings_s3_parts_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("1", "1");
        dropdown.addOption("2", "2");
        dropdown.addOption("3", "3");
        dropdown.addOption("5", "5");
        dropdown.addOption("10", "10");
        dropdown.addOption("15", "15");
        dropdown.addOption("20", t("settings_s3_parts_default"));

        dropdown
          .setValue(`${this.plugin.settings.s3.partsConcurrency}`)
          .onChange(async (val) => {
            const realVal = parseInt(val);
            this.plugin.settings.s3.partsConcurrency = realVal;
            await this.plugin.saveSettings();
          });
      });

    new Setting(s3Div)
      .setName(t("settings_checkonnectivity"))
      .setDesc(t("settings_checkonnectivity_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_checkonnectivity_button"));
        button.onClick(async () => {
          new Notice(t("settings_checkonnectivity_checking"));
          const client = new RemoteClient("s3", this.plugin.settings.s3);
          const errors = { msg: "" };
          const res = await client.checkConnectivity((err: any) => {
            errors.msg = err;
          });
          if (res) {
            new Notice(t("settings_s3_connect_succ"));
          } else {
            new Notice(t("settings_s3_connect_fail"));
            new Notice(errors.msg);
          }
        });
      });

    //////////////////////////////////////////////////
    // below for onedrive
    //////////////////////////////////////////////////

    const onedriveDiv = containerEl.createEl("div", { cls: "onedrive-hide" });
    onedriveDiv.toggleClass(
      "onedrive-hide",
      this.plugin.settings.serviceType !== "onedrive"
    );
    onedriveDiv.createEl("h2", { text: t("settings_onedrive") });
    const onedriveLongDescDiv = onedriveDiv.createEl("div", {
      cls: "settings-long-desc",
    });
    for (const c of [
      t("settings_onedrive_disclaimer1"),
      t("settings_onedrive_disclaimer2"),
    ]) {
      onedriveLongDescDiv.createEl("p", {
        text: c,
        cls: "onedrive-disclaimer",
      });
    }

    onedriveLongDescDiv.createEl("p", {
      text: t("settings_onedrive_folder", {
        pluginID: this.plugin.manifest.id,
        remoteBaseDir:
          this.plugin.settings.onedrive.remoteBaseDir ||
          this.app.vault.getName(),
      }),
    });

    onedriveLongDescDiv.createEl("p", {
      text: t("settings_onedrive_nobiz"),
    });

    const onedriveSelectAuthDiv = onedriveDiv.createDiv();
    const onedriveAuthDiv = onedriveSelectAuthDiv.createDiv({
      cls: "onedrive-auth-button-hide settings-auth-related",
    });
    const onedriveRevokeAuthDiv = onedriveSelectAuthDiv.createDiv({
      cls: "onedrive-revoke-auth-button-hide settings-auth-related",
    });

    const onedriveRevokeAuthSetting = new Setting(onedriveRevokeAuthDiv)
      .setName(t("settings_onedrive_revoke"))
      .setDesc(
        t("settings_onedrive_revoke_desc", {
          username: this.plugin.settings.onedrive.username,
        })
      )
      .addButton(async (button) => {
        button.setButtonText(t("settings_onedrive_revoke_button"));
        button.onClick(async () => {
          new OnedriveRevokeAuthModal(
            this.app,
            this.plugin,
            onedriveAuthDiv,
            onedriveRevokeAuthDiv
          ).open();
        });
      });

    new Setting(onedriveAuthDiv)
      .setName(t("settings_onedrive_auth"))
      .setDesc(t("settings_onedrive_auth_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_onedrive_auth_button"));
        button.onClick(async () => {
          const modal = new OnedriveAuthModal(
            this.app,
            this.plugin,
            onedriveAuthDiv,
            onedriveRevokeAuthDiv,
            onedriveRevokeAuthSetting
          );
          this.plugin.oauth2Info.helperModal = modal;
          this.plugin.oauth2Info.authDiv = onedriveAuthDiv;
          this.plugin.oauth2Info.revokeDiv = onedriveRevokeAuthDiv;
          this.plugin.oauth2Info.revokeAuthSetting = onedriveRevokeAuthSetting;
          modal.open();
        });
      });

    onedriveAuthDiv.toggleClass(
      "onedrive-auth-button-hide",
      this.plugin.settings.onedrive.username !== ""
    );
    onedriveRevokeAuthDiv.toggleClass(
      "onedrive-revoke-auth-button-hide",
      this.plugin.settings.onedrive.username === ""
    );

    let newOnedriveRemoteBaseDir =
      this.plugin.settings.onedrive.remoteBaseDir || "";
    new Setting(onedriveDiv)
      .setName(t("settings_remotebasedir"))
      .setDesc(t("settings_remotebasedir_desc"))
      .addText((text) =>
        text
          .setPlaceholder(this.app.vault.getName())
          .setValue(newOnedriveRemoteBaseDir)
          .onChange((value) => {
            newOnedriveRemoteBaseDir = value.trim();
          })
      )
      .addButton((button) => {
        button.setButtonText(t("confirm"));
        button.onClick(() => {
          new ChangeRemoteBaseDirModal(
            this.app,
            this.plugin,
            newOnedriveRemoteBaseDir,
            "onedrive"
          ).open();
        });
      });

    new Setting(onedriveDiv)
      .setName(t("settings_checkonnectivity"))
      .setDesc(t("settings_checkonnectivity_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_checkonnectivity_button"));
        button.onClick(async () => {
          new Notice(t("settings_checkonnectivity_checking"));
          const self = this;
          const client = new RemoteClient(
            "onedrive",
            undefined,
            undefined,
            this.plugin.settings.onedrive,
            this.app.vault.getName(),
            () => self.plugin.saveSettings()
          );

          const errors = { msg: "" };
          const res = await client.checkConnectivity((err: any) => {
            errors.msg = `${err}`;
          });
          if (res) {
            new Notice(t("settings_onedrive_connect_succ"));
          } else {
            new Notice(t("settings_onedrive_connect_fail"));
            new Notice(errors.msg);
          }
        });
      });

    //////////////////////////////////////////////////
    // below for webdav
    //////////////////////////////////////////////////

    const webdavDiv = containerEl.createEl("div", { cls: "webdav-hide" });
    webdavDiv.toggleClass(
      "webdav-hide",
      this.plugin.settings.serviceType !== "webdav"
    );

    webdavDiv.createEl("h2", { text: t("settings_webdav") });

    const webdavLongDescDiv = webdavDiv.createEl("div", {
      cls: "settings-long-desc",
    });

    webdavLongDescDiv.createEl("p", {
      text: t("settings_webdav_disclaimer1"),
      cls: "webdav-disclaimer",
    });

    if (!VALID_REQURL) {
      webdavLongDescDiv.createEl("p", {
        text: t("settings_webdav_cors_os"),
      });

      webdavLongDescDiv.createEl("p", {
        text: t("settings_webdav_cors"),
      });
    }

    webdavLongDescDiv.createEl("p", {
      text: t("settings_webdav_folder", {
        remoteBaseDir:
          this.plugin.settings.webdav.remoteBaseDir || this.app.vault.getName(),
      }),
    });

    new Setting(webdavDiv)
      .setName(t("settings_webdav_addr"))
      .setDesc(t("settings_webdav_addr_desc"))
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.webdav.address)
          .onChange(async (value) => {
            this.plugin.settings.webdav.address = value.trim();
            if (
              this.plugin.settings.webdav.depth === "auto_1" ||
              this.plugin.settings.webdav.depth === "auto_infinity"
            ) {
              this.plugin.settings.webdav.depth = "auto_unknown";
            }

            // TODO: any more elegant way?
            applyWebdavPresetRulesInplace(this.plugin.settings.webdav);

            // normally saved
            await this.plugin.saveSettings();
          })
      );

    new Setting(webdavDiv)
      .setName(t("settings_webdav_user"))
      .setDesc(t("settings_webdav_user_desc"))
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.webdav.username)
          .onChange(async (value) => {
            this.plugin.settings.webdav.username = value.trim();
            if (
              this.plugin.settings.webdav.depth === "auto_1" ||
              this.plugin.settings.webdav.depth === "auto_infinity"
            ) {
              this.plugin.settings.webdav.depth = "auto_unknown";
            }
            await this.plugin.saveSettings();
          });
      });

    new Setting(webdavDiv)
      .setName(t("settings_webdav_password"))
      .setDesc(t("settings_webdav_password_desc"))
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.webdav.password)
          .onChange(async (value) => {
            this.plugin.settings.webdav.password = value.trim();
            if (
              this.plugin.settings.webdav.depth === "auto_1" ||
              this.plugin.settings.webdav.depth === "auto_infinity"
            ) {
              this.plugin.settings.webdav.depth = "auto_unknown";
            }
            await this.plugin.saveSettings();
          });
      });

    new Setting(webdavDiv)
      .setName(t("settings_webdav_auth"))
      .setDesc(t("settings_webdav_auth_desc"))
      .addDropdown(async (dropdown) => {
        dropdown.addOption("basic", "basic");
        if (VALID_REQURL) {
          dropdown.addOption("digest", "digest");
        }

        // new version config, copied to old version, we need to reset it
        if (!VALID_REQURL && this.plugin.settings.webdav.authType !== "basic") {
          this.plugin.settings.webdav.authType = "basic";
          await this.plugin.saveSettings();
        }

        dropdown
          .setValue(this.plugin.settings.webdav.authType)
          .onChange(async (val: WebdavAuthType) => {
            this.plugin.settings.webdav.authType = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(webdavDiv)
      .setName(t("settings_webdav_depth"))
      .setDesc(t("settings_webdav_depth_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", t("settings_webdav_depth_auto"));
        dropdown.addOption("manual_1", t("settings_webdav_depth_1"));
        dropdown.addOption("manual_infinity", t("settings_webdav_depth_inf"));

        let initVal = "auto";
        const autoOptions: Set<WebdavDepthType> = new Set([
          "auto_unknown",
          "auto_1",
          "auto_infinity",
        ]);
        if (autoOptions.has(this.plugin.settings.webdav.depth)) {
          initVal = "auto";
        } else {
          initVal = this.plugin.settings.webdav.depth || "auto";
        }

        type DepthOption = "auto" | "manual_1" | "manual_infinity";
        dropdown.setValue(initVal).onChange(async (val: DepthOption) => {
          if (val === "auto") {
            this.plugin.settings.webdav.depth = "auto_unknown";
            this.plugin.settings.webdav.manualRecursive = false;
          } else if (val === "manual_1") {
            this.plugin.settings.webdav.depth = "manual_1";
            this.plugin.settings.webdav.manualRecursive = true;
          } else if (val === "manual_infinity") {
            this.plugin.settings.webdav.depth = "manual_infinity";
            this.plugin.settings.webdav.manualRecursive = false;
          }

          // TODO: any more elegant way?
          applyWebdavPresetRulesInplace(this.plugin.settings.webdav);

          // normally save
          await this.plugin.saveSettings();
        });
      });

    let newWebdavRemoteBaseDir =
      this.plugin.settings.webdav.remoteBaseDir || "";
    new Setting(webdavDiv)
      .setName(t("settings_remotebasedir"))
      .setDesc(t("settings_remotebasedir_desc"))
      .addText((text) =>
        text
          .setPlaceholder(this.app.vault.getName())
          .setValue(newWebdavRemoteBaseDir)
          .onChange((value) => {
            newWebdavRemoteBaseDir = value.trim();
          })
      )
      .addButton((button) => {
        button.setButtonText(t("confirm"));
        button.onClick(() => {
          new ChangeRemoteBaseDirModal(
            this.app,
            this.plugin,
            newWebdavRemoteBaseDir,
            "webdav"
          ).open();
        });
      });

    new Setting(webdavDiv)
      .setName(t("settings_checkonnectivity"))
      .setDesc(t("settings_checkonnectivity_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_checkonnectivity_button"));
        button.onClick(async () => {
          new Notice(t("settings_checkonnectivity_checking"));
          const self = this;
          const client = new RemoteClient(
            "webdav",
            undefined,
            this.plugin.settings.webdav,
            undefined,
            this.app.vault.getName(),
            () => self.plugin.saveSettings()
          );
          const errors = { msg: "" };
          const res = await client.checkConnectivity((err: any) => {
            errors.msg = `${err}`;
          });
          if (res) {
            new Notice(t("settings_webdav_connect_succ"));
          } else {
            if (VALID_REQURL) {
              new Notice(t("settings_webdav_connect_fail"));
            } else {
              new Notice(t("settings_webdav_connect_fail_withcors"));
            }
            new Notice(errors.msg);
          }
        });
      });

    //////////////////////////////////////////////////
    // below for general chooser (part 2/2)
    //////////////////////////////////////////////////

    // we need to create chooser
    // after all service-div-s being created
    new Setting(serviceChooserDiv)
      .setName(t("settings_chooseservice"))
      .setDesc(t("settings_chooseservice_desc"))
      .addDropdown(async (dropdown) => {
        dropdown.addOption("s3", t("settings_chooseservice_s3"));
        dropdown.addOption("webdav", t("settings_chooseservice_webdav"));
        dropdown.addOption("onedrive", t("settings_chooseservice_onedrive"));
        dropdown
          .setValue(this.plugin.settings.serviceType)
          .onChange(async (val: SUPPORTED_SERVICES_TYPE) => {
            this.plugin.settings.serviceType = val;
            s3Div.toggleClass(
              "s3-hide",
              this.plugin.settings.serviceType !== "s3"
            );
            onedriveDiv.toggleClass(
              "onedrive-hide",
              this.plugin.settings.serviceType !== "onedrive"
            );
            webdavDiv.toggleClass(
              "webdav-hide",
              this.plugin.settings.serviceType !== "webdav"
            );
            await this.plugin.saveSettings();
          });
      });

    //////////////////////////////////////////////////
    // below for basic settings
    //////////////////////////////////////////////////

    const basicDiv = containerEl.createEl("div");
    basicDiv.createEl("h2", { text: t("settings_basic") });

    let newPassword = `${this.plugin.settings.password}`;
    new Setting(basicDiv)
      .setName(t("settings_password"))
      .setDesc(t("settings_password_desc"))
      .addText((text) => {
        wrapTextWithPasswordHide(text);
        text
          .setPlaceholder("")
          .setValue(`${this.plugin.settings.password}`)
          .onChange(async (value) => {
            newPassword = value.trim();
          });
      })
      .addButton(async (button) => {
        button.setButtonText(t("confirm"));
        button.onClick(async () => {
          new PasswordModal(this.app, this.plugin, newPassword).open();
        });
      });

    new Setting(basicDiv)
      .setName(t("settings_saverun"))
      .setDesc(t("settings_saverun_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("-1", t("settings_saverun_notset"));
        dropdown.addOption("0", t("settings_saverun_instant"));
        dropdown.addOption(`${1000 * 5}`, t("settings_saverun_5sec"));
        dropdown.addOption(`${1000 * 10}`, t("settings_saverun_10sec"));
        dropdown.addOption(`${1000 * 30}`, t("settings_saverun_30sec"));
        dropdown.addOption(`${1000 * 60}`, t("settings_saverun_1min"));
        let runScheduled = false
        dropdown
          .setValue(`${this.plugin.settings.syncOnSaveAfterMilliseconds}`)
          .onChange(async (val: string) => {
            const realVal = parseInt(val);
            this.plugin.settings.syncOnSaveAfterMilliseconds = realVal;

            await this.plugin.saveSettings();

            if (realVal < 0) {
              this.plugin.toggleSyncOnSave(false);
            } else {
              this.plugin.toggleSyncOnSave(true);
            }
          })
    });

    new Setting(basicDiv)
    .setName(t("settings_remoterun"))
    .setDesc(t("settings_remoterun_desc"))
    .addDropdown((dropdown) => {
      dropdown.addOption("-1", t("settings_remoterun_notset"));
      dropdown.addOption(`${1000 * 1}`, t("settings_remoterun_1sec"));
      dropdown.addOption(`${1000 * 5}`, t("settings_remoterun_5sec"));
      dropdown.addOption(`${1000 * 10}`, t("settings_remoterun_10sec"));
      dropdown.addOption(`${1000 * 60}`, t("settings_remoterun_1min"));
      
      dropdown
        .setValue(`${this.plugin.settings.syncOnRemoteChangesAfterMilliseconds}`)
        .onChange(async (val: string) => {
          const realVal = parseInt(val);
          this.plugin.settings.syncOnRemoteChangesAfterMilliseconds = realVal;

          await this.plugin.saveSettings();

          if (realVal <= 0) {
            this.plugin.toggleSyncOnRemote(false);
          } else {
            this.plugin.toggleSyncOnRemote(true);
          }
        });
    });

    new Setting(basicDiv)
      .setName(t("settings_autorun"))
      .setDesc(t("settings_autorun_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("-1", t("settings_autorun_notset"));
        dropdown.addOption(`${1000 * 5}`, t("settings_autorun_second", { "time": 5 }));
        dropdown.addOption(`${1000 * 15}`, t("settings_autorun_second", { "time": 15 }));
        dropdown.addOption(`${1000 * 30}`, t("settings_autorun_second", { "time": 30 }));
        dropdown.addOption(`${1000 * 60}`, t("settings_autorun_1min"));
        dropdown.addOption(`${1000 * 60 * 5}`, t("settings_autorun_5min"));
        dropdown.addOption(`${1000 * 60 * 10}`, t("settings_autorun_10min"));
        dropdown.addOption(`${1000 * 60 * 30}`, t("settings_autorun_30min"));

        dropdown
          .setValue(`${this.plugin.settings.autoRunEveryMilliseconds}`)
          .onChange(async (val: string) => {
            const realVal = parseInt(val);
            this.plugin.settings.autoRunEveryMilliseconds = realVal;
            await this.plugin.saveSettings();
            if (
              (realVal === undefined || realVal === null || realVal <= 0) &&
              this.plugin.autoRunIntervalID !== undefined
            ) {
              // clear
              window.clearInterval(this.plugin.autoRunIntervalID);
              this.plugin.autoRunIntervalID = undefined;
            } else if (
              realVal !== undefined &&
              realVal !== null &&
              realVal > 0
            ) {
              const intervalID = window.setInterval(() => {
                this.plugin.syncRun("auto");
              }, realVal);
              this.plugin.autoRunIntervalID = intervalID;
              this.plugin.registerInterval(intervalID);
            }
          });
      });

    new Setting(basicDiv)
      .setName(t("settings_runoncestartup"))
      .setDesc(t("settings_runoncestartup_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("-1", t("settings_runoncestartup_notset"));
        dropdown.addOption(
          `${1000 * 1 * 1}`,
          t("settings_runoncestartup_1sec")
        );
        dropdown.addOption(
          `${1000 * 10 * 1}`,
          t("settings_runoncestartup_10sec")
        );
        dropdown.addOption(
          `${1000 * 30 * 1}`,
          t("settings_runoncestartup_30sec")
        );
        dropdown
          .setValue(`${this.plugin.settings.initRunAfterMilliseconds}`)
          .onChange(async (val: string) => {
            const realVal = parseInt(val);
            this.plugin.settings.initRunAfterMilliseconds = realVal;
            await this.plugin.saveSettings();
          });
      });

    new Setting(basicDiv)
      .setName(t("settings_skiplargefiles"))
      .setDesc(t("settings_skiplargefiles_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("-1", t("settings_skiplargefiles_notset"));

        const mbs = [1, 5, 10, 50, 100, 500, 1000];
        for (const mb of mbs) {
          dropdown.addOption(`${mb * 1000 * 1000}`, `${mb} MB`);
        }
        dropdown
          .setValue(`${this.plugin.settings.skipSizeLargerThan}`)
          .onChange(async (val) => {
            this.plugin.settings.skipSizeLargerThan = parseInt(val);
            await this.plugin.saveSettings();
          });
      });

    new Setting(basicDiv)
      .setName(t("settings_enablestatusbar_info"))
      .setDesc(t("settings_enablestatusbar_info_desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableStatusBarInfo)
          .onChange(async (val) => {
            this.plugin.settings.enableStatusBarInfo = val;
            await this.plugin.saveSettings();
            this.plugin.toggleStatusBar(val);

            statusBarOptions.toggleClass(
              "third-party-sync-hidden",
              this.plugin.settings.enableStatusBarInfo !== true
            );
          });
      });

    const statusBarOptions = basicDiv.createDiv({ cls: "third-party-sync-hidden" });

    statusBarOptions.toggleClass(
      "third-party-sync-hidden",
      this.plugin.settings.enableStatusBarInfo !== true
    );

    new Setting(basicDiv)
      .setName(t("settings_sync_trash"))
      .setDesc(t("settings_sync_trash_desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.syncTrash)
          .onChange(async (val) => {
            this.plugin.settings.syncTrash = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(basicDiv)
      .setName(t("settings_sync_bookmarks"))
      .setDesc(t("settings_sync_bookmarks_desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.syncBookmarks)
          .onChange(async (val) => {
            this.plugin.settings.syncBookmarks = val;
            await this.plugin.saveSettings();
          });
      });

    //////////////////////////////////////////////////
    // below for advanced settings
    //////////////////////////////////////////////////
    const advDiv = containerEl.createEl("div");
    advDiv.createEl("h2", {
      text: t("settings_adv"),
    });

    new Setting(advDiv)
      .setName(t("settings_concurrency"))
      .setDesc(t("settings_concurrency_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("1", "1");
        dropdown.addOption("2", "2");
        dropdown.addOption("3", "3");
        dropdown.addOption("5", t("settings_concurrency_default"));
        dropdown.addOption("10", "10");
        dropdown.addOption("15", "15");
        dropdown.addOption("20", "20");

        dropdown
          .setValue(`${this.plugin.settings.concurrency}`)
          .onChange(async (val) => {
            const realVal = parseInt(val);
            this.plugin.settings.concurrency = realVal;
            await this.plugin.saveSettings();
          });
      });

    new Setting(advDiv)
      .setName(t("settings_syncunderscore"))
      .setDesc(t("settings_syncunderscore_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("disable", t("disable"));
        dropdown.addOption("enable", t("enable"));
        dropdown
          .setValue(
            `${this.plugin.settings.syncUnderscoreItems ? "enable" : "disable"}`
          )
          .onChange(async (val) => {
            this.plugin.settings.syncUnderscoreItems = val === "enable";
            await this.plugin.saveSettings();
          });
      });

    new Setting(advDiv)
      .setName(t("settings_deletetowhere"))
      .setDesc(t("settings_deletetowhere_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("system_trash", t("settings_deletetowhere_system_trash"));
        dropdown.addOption("obsidian_trash", t("settings_deletetowhere_obsidian_trash"));
        dropdown
          .setValue(this.plugin.settings.deleteToWhere ?? "system_trash")
          .onChange(async (val) => {
            this.plugin.settings.deleteToWhere = val as DeleteToWhereType;
            await this.plugin.saveSettings();
          });
      });

    new Setting(advDiv)
      .setName(t("settings_conflictaction"))
      .setDesc(t("settings_conflictaction_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("keep_newer", t("settings_conflictaction_keep_newer"));
        dropdown.addOption("keep_larger", t("settings_conflictaction_keep_larger"));
        dropdown
          .setValue(this.plugin.settings.conflictAction ?? "keep_newer")
          .onChange(async (val) => {
            this.plugin.settings.conflictAction = val;
            await this.plugin.saveSettings();
          });
      });

    const syncDirSetting = new Setting(advDiv)
      .setName(t("setting_syncdirection"))
      .setDesc(t("setting_syncdirection_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption(
          "bidirectional",
          t("setting_syncdirection_bidirectional_desc")
        );
        dropdown.addOption(
          "incremental_push_only",
          t("setting_syncdirection_incremental_push_only_desc")
        );
        dropdown.addOption(
          "incremental_pull_only",
          t("setting_syncdirection_incremental_pull_only_desc")
        );
        dropdown.addOption(
          "incremental_push_and_delete_only",
          t("setting_syncdirection_incremental_push_and_delete_only_desc")
        );
        dropdown.addOption(
          "incremental_pull_and_delete_only",
          t("setting_syncdirection_incremental_pull_and_delete_only_desc")
        );

        dropdown
          .setValue(this.plugin.settings.syncDirection ?? "bidirectional")
          .onChange(async (val) => {
            this.plugin.settings.syncDirection = val as SyncDirectionType;
            await this.plugin.saveSettings();
          });
      });
    
    // Move dropdown to be after the description
    const settingEl = syncDirSetting.settingEl;
    const infoEl = syncDirSetting.infoEl;
    const controlEl = syncDirSetting.controlEl;
    if (infoEl && controlEl) {
      settingEl.appendChild(controlEl);
    }

    new Setting(advDiv)
      .setName(t("settings_protectmodifypercentage"))
      .setDesc(t("settings_protectmodifypercentage_desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("0", t("settings_protectmodifypercentage_000_desc"));
        dropdown.addOption("10", "10");
        dropdown.addOption("20", "20");
        dropdown.addOption("30", "30");
        dropdown.addOption("40", "40");
        dropdown.addOption("50", t("settings_protectmodifypercentage_050_desc"));
        dropdown.addOption("60", "60");
        dropdown.addOption("70", "70");
        dropdown.addOption("80", "80");
        dropdown.addOption("90", "90");
        dropdown.addOption("100", t("settings_protectmodifypercentage_100_desc"));
        dropdown
          .setValue(`${this.plugin.settings.protectModifyPercentage ?? 50}`)
          .onChange(async (val: string) => {
            this.plugin.settings.protectModifyPercentage = parseInt(val);
            await this.plugin.saveSettings();
          });
      });

    new Setting(advDiv)
      .setName(t("settings_configdir"))
      .setDesc(
        t("settings_configdir_desc", {
          configDir: this.app.vault.configDir,
        })
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("disable", t("disable"));
        dropdown.addOption("enable", t("enable"));

        const bridge = {
          secondConfirm: false,
        };
        dropdown
          .setValue(
            `${this.plugin.settings.syncConfigDir ? "enable" : "disable"}`
          )
          .onChange(async (val) => {
            if (val === "enable" && !bridge.secondConfirm) {
              dropdown.setValue("disable");
              new SyncConfigDirModal(this.app, this.plugin, () => {
                bridge.secondConfirm = true;
                dropdown.setValue("enable");
              }).open();
            } else {
              bridge.secondConfirm = false;
              this.plugin.settings.syncConfigDir = false;
              await this.plugin.saveSettings();
            }
          });
      });

    //////////////////////////////////////////////////
    // below for import and export functions
    //////////////////////////////////////////////////

    // import and export
    const importExportDiv = containerEl.createEl("div");
    importExportDiv.createEl("h2", {
      text: t("settings_importexport"),
    });
    let importUriInput = "";

    new Setting(importExportDiv)
      .setName(t("settings_export"))
      .setDesc(t("settings_export_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_export_s3_button"));
        button.onClick(async () => {
          const settingsOnlyS3 = cloneDeep(this.plugin.settings);
          delete settingsOnlyS3.onedrive;
          delete settingsOnlyS3.webdav;
          delete settingsOnlyS3.vaultRandomID;
          const uri = exportSettingsUri(
            settingsOnlyS3,
            this.app.vault.getName(),
            this.plugin.manifest.version
          );
          await navigator.clipboard.writeText(uri);
          new Notice(t("modal_export_button_notice"));
        });
      })
      .addButton(async (button) => {
        button.setButtonText(t("settings_export_webdav_button"));
        button.onClick(async () => {
          const settingsOnlyWebdav = cloneDeep(this.plugin.settings);
          delete settingsOnlyWebdav.onedrive;
          delete settingsOnlyWebdav.s3;
          delete settingsOnlyWebdav.vaultRandomID;
          const uri = exportSettingsUri(
            settingsOnlyWebdav,
            this.app.vault.getName(),
            this.plugin.manifest.version
          );
          await navigator.clipboard.writeText(uri);
          new Notice(t("modal_export_button_notice"));
        });
      });

    new Setting(importExportDiv)
      .setName(t("settings_import"))
      .setDesc(t("settings_import_desc"))
      .addText((text) => {
        text
          .setPlaceholder("obsidian://third-party-sync?func=settings&vault=&version=&data=&compressed=1")
          .onChange((value) => {
            importUriInput = value;
          });
        text.inputEl.style.width = "100%";
      })
      .addButton((button) => {
        button.setButtonText(t("settings_import_button"));
        button.onClick(async () => {
          const rawInput = importUriInput.trim();
          if (rawInput === "") {
            new Notice(t("settings_import_error_notice"));
            return;
          }

          const parseUriParams = (raw: string): UriParams | undefined => {
            const normalizeParams = (sp: URLSearchParams) => {
              const params = {} as UriParams;
              sp.forEach((v, k) => {
                (params as any)[k] = v;
              });
              return params;
            };

            try {
              const u = new URL(raw);
              return normalizeParams(u.searchParams);
            } catch (e) {
              // fallback below
            }

            const maybeQuery = raw.startsWith("?")
              ? raw.slice(1)
              : raw.includes("?")
              ? raw.split("?").slice(1).join("?")
              : raw;
            if (maybeQuery.includes("=")) {
              try {
                const sp = new URLSearchParams(maybeQuery);
                return normalizeParams(sp);
              } catch (e) {
                return undefined;
              }
            }
            return undefined;
          };

          const params = parseUriParams(rawInput);
          if (params === undefined) {
            new Notice(t("settings_import_error_notice"));
            return;
          }

          const parsed = importQrCodeUri(params, this.app.vault.getName());
          if (parsed.status === "error") {
            new Notice(parsed.message);
            return;
          }

          const copied = cloneDeep(parsed.result);
          this.plugin.settings = {
            ...this.plugin.settings,
            ...copied,
            s3: {
              ...this.plugin.settings.s3,
              ...(copied?.s3 ?? {}),
            },
            webdav: {
              ...this.plugin.settings.webdav,
              ...(copied?.webdav ?? {}),
            },
            onedrive: {
              ...this.plugin.settings.onedrive,
              ...(copied?.onedrive ?? {}),
            },
          };
          await this.plugin.saveSettings();
          new Notice(
            t("protocol_saveqr", {
              manifestName: this.plugin.manifest.name,
            })
          );
          this.display();
        });
      });

    //////////////////////////////////////////////////
    // below for debug
    //////////////////////////////////////////////////

    const debugDiv = containerEl.createEl("div");
    debugDiv.createEl("h2", { text: t("settings_debug") });

    // Debug mode toggle (always visible)
    const debugToggle = new Setting(debugDiv)
      .setName(t("settings_debug_enabled"))
      .setDesc(t("settings_debug_enabled_desc"))
      .addDropdown(async (dropdown) => {
        dropdown.addOption("disable", t("disable"));
        dropdown.addOption("enable", t("enable"));
        dropdown
          .setValue(this.plugin.settings.debugEnabled ? "enable" : "disable")
          .onChange(async (val: string) => {
            const debugEnabled = val === "enable";
            this.plugin.settings.debugEnabled = debugEnabled;
            if (debugEnabled) {
              log.setLevel("debug");
            } else {
              log.setLevel("info");
            }
            this.update();
            await this.plugin.saveSettings();
          });
      });

    // Container for debug options (hidden when debug is disabled)
    const debugOptionsDiv = debugDiv.createEl("div", {
      cls: "remotely-sync-debug-options"
    });

    // Update visibility and re-render options
    this.update = () => {
      const enabled = !!this.plugin.settings.debugEnabled;
      (debugOptionsDiv as HTMLElement).style.display = enabled ? "block" : "none";
      
      // Re-render debug options
      debugOptionsDiv.empty();
      
      if (enabled) {
        new Setting(debugOptionsDiv)
      .setName(t("settings_outputsettingsconsole"))
      .setDesc(t("settings_outputsettingsconsole_desc"))
      .addButton(async (button) => {
        button.setButtonText(t("settings_outputsettingsconsole_button"));
        button.onClick(async () => {
          const c = messyConfigToNormal(await this.plugin.loadData());
          new Notice(t("settings_outputsettingsconsole_notice"));
          console.log(c);
        });
      });

        new Setting(debugOptionsDiv)
          .setName(t("settings_syncplans"))
          .setDesc(t("settings_syncplans_desc"))
          .addButton(async (button) => {
            button.setButtonText(t("settings_syncplans_button_json"));
            button.onClick(async () => {
              await exportVaultSyncPlansToFiles(
                this.plugin.db,
                this.app.vault,
                this.plugin.vaultRandomID,
                "json"
              );
              new Notice(t("settings_syncplans_notice"));
            });
          })
          .addButton(async (button) => {
            button.setButtonText(t("settings_syncplans_button_table"));
            button.onClick(async () => {
              await exportVaultSyncPlansToFiles(
                this.plugin.db,
                this.app.vault,
                this.plugin.vaultRandomID,
                "table"
              );
              new Notice(t("settings_syncplans_notice"));
            });
          });
        new Setting(debugOptionsDiv)
          .setName(t("settings_delsyncplans"))
          .setDesc(t("settings_delsyncplans_desc"))
          .addButton(async (button) => {
            button.setButtonText(t("settings_delsyncplans_button"));
            button.onClick(async () => {
              await clearAllSyncPlanRecords(this.plugin.db);
              new Notice(t("settings_delsyncplans_notice"));
            });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_logtodb"))
          .setDesc(t("settings_logtodb_desc"))
          .addDropdown(async (dropdown) => {
            dropdown.addOption("enable", t("enable"));
            dropdown.addOption("disable", t("disable"));
            dropdown
              .setValue(this.plugin.settings.logToDB ? "enable" : "disable")
              .onChange(async (val: string) => {
                const logToDB = val === "enable";
                if (logToDB) {
                  applyLogWriterInplace((...msg: any[]) => {
                    insertLoggerOutputByVault(
                      this.plugin.db,
                      this.plugin.vaultRandomID,
                      ...msg
                    );
                  });
                } else {
                  restoreLogWritterInplace();
                }
                clearExpiredLoggerOutputRecords(this.plugin.db);
                this.plugin.settings.logToDB = logToDB;
                await this.plugin.saveSettings();
              });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_logtodbexport"))
          .setDesc(
            t("settings_logtodbexport_desc", {
              debugFolder: DEFAULT_DEBUG_FOLDER,
            })
          )
          .addButton(async (button) => {
            button.setButtonText(t("settings_logtodbexport_button"));
            button.onClick(async () => {
              await exportVaultLoggerOutputToFiles(
                this.plugin.db,
                this.app.vault,
                this.plugin.vaultRandomID
              );
              new Notice(t("settings_logtodbexport_notice"));
            });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_logtodbclear"))
          .setDesc(t("settings_logtodbclear_desc"))
          .addButton(async (button) => {
            button.setButtonText(t("settings_logtodbclear_button"));
            button.onClick(async () => {
              await clearAllLoggerOutputRecords(this.plugin.db);
              new Notice(t("settings_logtodbclear_notice"));
            });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_delsyncmap"))
          .setDesc(t("settings_delsyncmap_desc"))
          .addButton(async (button) => {
            button.setButtonText(t("settings_delsyncmap_button"));
            button.onClick(async () => {
              await clearAllSyncMetaMapping(this.plugin.db);
              new Notice(t("settings_delsyncmap_notice"));
            });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_outputbasepathvaultid"))
          .setDesc(t("settings_outputbasepathvaultid_desc"))
          .addButton(async (button) => {
            button.setButtonText(t("settings_outputbasepathvaultid_button"));
            button.onClick(async () => {
              new Notice(this.plugin.getVaultBasePath());
              new Notice(this.plugin.vaultRandomID);
            });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_resetcache"))
          .setDesc(t("settings_resetcache_desc"))
          .addButton(async (button) => {
            button.setButtonText(t("settings_reset_button"));
            button.onClick(async () => {
              await destroyDBs();
              new Notice(t("settings_resetcache_notice"));
            });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_disable_s3_metadata_sync"))
          .setDesc(t("settings_disable_s3_metadata_sync_desc"))
          .addToggle((toggle) => {
            toggle
              .setValue(this.plugin.settings.s3.disableS3MetadataSync)
              .onChange(async (val) => {
                this.plugin.settings.s3.disableS3MetadataSync = val;
                await this.plugin.saveSettings();
                new Notice(t("settings_enablestatusbar_reloadrequired_notice"));
              });
          });

        new Setting(debugOptionsDiv)
          .setName(t("settings_reset_sync_metadata"))
          .setDesc(t("settings_reset_sync_metadata_desc"))
          .addButton(async (button) => {
            button.setButtonText(t("settings_reset_button"));
            button.onClick(async () => {
              // Delete all remote metadata file(s) and upload empty one.
              if (this.deletingRemoteMeta) {
                new Notice(t("settings_reset_sync_metadata_notice_error"));
                return;
              }

              new Notice(t("settings_reset_sync_metadata_notice_start"))
              log.debug("Deleting remote metadata file. (1/2)")

              this.deletingRemoteMeta = true;

              await this.deleteRemoteMetadata();

              await uploadExtraMeta(this.getClient(),
                this.app.vault,
                undefined,
                undefined,
                [],
                this.plugin.settings.password );
                
              this.deletingRemoteMeta = false;
              
              new Notice(t("settings_reset_sync_metadata_notice_end"));
              log.debug("Remote metadata file deleted. (2/2)")
            });
          });
      }
      }
    };

  private async deleteRemoteMetadata() {
    const client = this.getClient();
    const remoteFiles = await client.listFromRemote();
    const remoteMetadata = await getRemoteMetadata(remoteFiles.Contents, client, this.plugin.settings.password)

    await client.deleteFromRemote(DEFAULT_FILE_NAME_FOR_METADATAONREMOTE, this.plugin.settings.password, remoteMetadata.remoteEncryptedKey);
  }

  private getClient() {
    return new RemoteClient(
      this.plugin.settings.serviceType,
      this.plugin.settings.s3,
      this.plugin.settings.webdav,
      this.plugin.settings.onedrive,
      this.app.vault.getName(),
      () => this.plugin.saveSettings()
    )
  }

  hide() {
    let { containerEl } = this;
    containerEl.empty();
    super.hide();
  }
}
