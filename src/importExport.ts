import cloneDeep from "lodash/cloneDeep";
import pako from "pako";

import {
  COMMAND_URI,
  UriParams,
  ThirdPartySyncPluginSettings,
  SUPPORTED_SERVICES_TYPE,
} from "./baseTypes";
import { DEFAULT_S3_CONFIG } from "./remoteForS3";
import { DEFAULT_WEBDAV_CONFIG } from "./remoteForWebdav";
import { DEFAULT_ONEDRIVE_CONFIG } from "./remoteForOnedrive";

import { log } from "./moreOnLog";

export const exportSettingsUri = (
  settings: ThirdPartySyncPluginSettings,
  currentVaultName: string,
  pluginVersion: string
) => {
  const settings2 = cloneDeep(settings);
  delete settings2.onedrive;
  delete settings2.vaultRandomID;
  const jsonStr = JSON.stringify(settings2);

  // Compress data to fit in URI
  const compressed = pako.deflate(jsonStr);
  const base64 = btoa(String.fromCharCode.apply(null, compressed as unknown as number[]));
  const data = encodeURIComponent(base64);
  const vault = encodeURIComponent(currentVaultName);
  const version = encodeURIComponent(pluginVersion);
  const rawUri = `obsidian://${COMMAND_URI}?func=settings&version=${version}&vault=${vault}&data=${data}&compressed=1`;
  return rawUri;
};

export interface ProcessQrCodeResultType {
  status: "error" | "ok";
  message: string;
  result?: ThirdPartySyncPluginSettings;
}

export const importQrCodeUri = (
  inputParams: any,
  currentVaultName: string
): ProcessQrCodeResultType => {
  const decodeMaybe = (v: any) => {
    if (typeof v !== "string") {
      return v;
    }
    try {
      return decodeURIComponent(v);
    } catch (e) {
      return v;
    }
  };

  const normalizeImportedSettings = (
    imported: any
  ): ThirdPartySyncPluginSettings => {
    const serviceTypeSet = new Set<SUPPORTED_SERVICES_TYPE>([
      "s3",
      "webdav",
      "onedrive",
    ]);
    const importedServiceType = imported?.serviceType as
      | SUPPORTED_SERVICES_TYPE
      | undefined;
    const serviceType = serviceTypeSet.has(importedServiceType)
      ? importedServiceType
      : "s3";

    return {
      ...(imported as ThirdPartySyncPluginSettings),
      serviceType,
      s3: {
        ...DEFAULT_S3_CONFIG,
        ...(imported?.s3 ?? {}),
      },
      webdav: {
        ...DEFAULT_WEBDAV_CONFIG,
        ...(imported?.webdav ?? {}),
      },
      onedrive: {
        ...DEFAULT_ONEDRIVE_CONFIG,
        ...(imported?.onedrive ?? {}),
      },
    };
  };

  let params = inputParams as UriParams;
  params = {
    ...params,
    vault: decodeMaybe(params.vault),
    data: decodeMaybe(params.data),
  };
  if (
    params.func === undefined ||
    params.func !== "settings" ||
    params.vault === undefined ||
    params.data === undefined
  ) {
    return {
      status: "error",
      message: `the uri is not for exporting/importing settings: ${JSON.stringify(
        inputParams
      )}`,
    };
  }

  if (params.vault !== currentVaultName) {
    return {
      status: "error",
      message: `the target vault is ${
        params.vault
      } but you are currently in ${currentVaultName}: ${JSON.stringify(
        inputParams
      )}`,
    };
  }

  let settings = {} as ThirdPartySyncPluginSettings;
  try {
    let dataStr = params.data;
    
    // Decompress if data is compressed
    if (params.compressed === "1" || params.compressed === "true") {
      try {
        const binary = atob(dataStr);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const decompressed = pako.inflate(bytes, { to: "string" });
        dataStr = decompressed;
      } catch (e) {
        return {
          status: "error",
          message: `failed to decompress settings: ${e}`,
        };
      }
    }
    
    settings = normalizeImportedSettings(JSON.parse(dataStr));
  } catch (e) {
    return {
      status: "error",
      message: `errors while parsing settings: ${JSON.stringify(inputParams)}`,
    };
  }
  return {
    status: "ok",
    message: "ok",
    result: settings,
  };
};
