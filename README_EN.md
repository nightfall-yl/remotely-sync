# Obsidian Third-party Sync

**Obsidian Third-party Sync** is an unofficial fork of [Remotely Save](https://github.com/remotely-save/remotely-save), focusing on security updates and feature enhancements. **It is NOT backwards compatible with Remotely Save** — backup your data before use. See [Migration Guide](#migrating-from-remotely-save).

If you find it useful, please give it a star on GitHub: [![GitHub Repo stars](https://img.shields.io/github/stars/nightfall-yl/remotely-sync?style=social)](https://github.com/nightfall-yl/remotely-sync)

Pull requests are welcome!

## Disclaimer

- **This is NOT the [official sync service](https://obsidian.md/sync) provided by Obsidian.**
- **⚠️ ALWAYS backup your vault before using this plugin.**

## What's Different from Remotely Save

### Security Updates
- Upgraded encryption to [AES-GCM](https://github.com/nightfall-yl/remotely-sync/commit/d9ad76e774b0b1cee2b36316058df926f4bfb2bf) — more secure, with ciphertext authentication to prevent [padding oracle attacks](https://cryptopals.com/sets/3/challenges/17).
- Salt upgraded from 8 to 16 bytes.
- IV no longer derived from user password.

### Feature Updates
- **Sync Direction**: Supports 5 modes — Bidirectional, Incremental Push (backup), Incremental Pull, Incremental Push + Delete, Incremental Pull + Delete.
- **Modification Ratio Protection**: Aborts sync if the ratio of modified/deleted files exceeds the threshold, preventing accidental mass changes.
- **Optional Metadata-Free Mode**: S3 storage can choose not to upload `_remotely-secure-metadata-on-remote.json`, reducing remote storage footprint.
- Conflict handling: configurable to keep newer or larger version on conflicts.
- Empty folder cleanup: auto-delete empty folders on both sides.
- All original Remotely Save features preserved (E2E encryption, mobile support, auto sync, etc.).

## Features

- **Supported services**: Amazon S3 (and compatible: Tencent COS, Alibaba OSS, Backblaze B2, MinIO, etc.), WebDAV (Jianguoyun/Nutstore, Nextcloud, OwnCloud, Seafile, rclone, etc.), OneDrive for personal. See [details](./docs/services_connectable_or_not.md).
- **Obsidian Mobile supported.** Sync vaults across desktop and mobile via cloud.
- **End-to-end encryption** ([details](./docs/encryption.md)): AES-256-GCM + RClone Crypt format when password is set.
- **Auto sync**: scheduled interval, startup, on-save, and remote-change detection.
- **Sync Direction**: Bidirectional / Incremental Push / Incremental Pull / with-delete variants.
- **Modification Ratio Protection**: guards against unintended mass file changes.
- **Sync bookmarks and config dir** (optional).
- **Status bar**: progress and last sync time display.
- **Debug mode**: export sync plans, export console logs.
- **QR code import/export** for settings (excluding OneDrive OAuth info).
- **[Minimal intrusive design](./docs/minimal_intrusive_design.md).**
- **Fully open source** ([Apache-2.0](./LICENSE)).
- **[Sync algorithm](./docs/sync_algorithm.md).**

## Limitations

- **Without metadata sync, deletion sync relies on timestamp comparison.** Recommended to use with Incremental Push/Pull modes.
- **No conflict resolution.** Files are compared by modification time; the newer wins.
- **Cloud services cost money.** Be aware of all operations may incur charges.
- **Browser environment limitations** — see [technical docs](./docs/browser_env.md).
- **Protect your `data.json`** — it contains sensitive info. Do not share it; add it to `.gitignore`.

## Migrating from Remotely Save

1. Make a local, unencrypted backup (sync all changes across devices first)
2. Disable the remotely-save plugin
3. Enable obsidian-third-party-sync and set a new encryption password
4. Delete encrypted files on cloud (or use a new S3 bucket)
5. Perform first sync with obsidian-third-party-sync

## Installation

**Option 1**: Search "Obsidian Third-party Sync" in Obsidian's community plugin list.

**Option 2**: Use [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat) — add repo `nightfall-yl/remotely-sync`.

**Option 3**: Manually download `main.js`, `manifest.json`, `styles.css` from the latest release and place them in your vault's `.obsidian/plugins/obsidian-third-party-sync/` folder.

## Building

```bash
git clone https://github.com/nightfall-yl/remotely-sync
cd remotely-sync
npm install

# Development build (watch mode)
npm run dev

# Production build (webpack)
npm run build
```

Deploy:
```bash
cp main.js styles.css manifest.json /your/path/to/vault/.obsidian/plugins/obsidian-third-party-sync
```

## Usage

### S3

- Prepare: Endpoint, Region, Access Key ID, Secret Access Key, Bucket name.
- **CORS** (required only for Obsidian desktop < 0.13.25 or mobile < 1.1.1): Configure CORS on S3 console to allow origins `app://obsidian.md`, `capacitor://localhost`, `http://localhost`, expose `ETag` header. Example: [S3 CORS docs](./docs/s3_cors_configure.md).
- Configure settings and optional encryption password.
- Click the ribbon icon to sync, or enable auto sync in settings.

### WebDAV

- Works with Jianguoyun/Nutstore, Nextcloud, OwnCloud, Seafile, rclone, etc.
- **CORS** (same as above — only for older Obsidian versions).
- Some services need `WebAppPassword` or similar plugin. See [WebDAV docs](./docs/apache_cors_configure.md).

### OneDrive (Personal)

- Personal accounts only — OneDrive for Business is not supported.
- Plugin reads/writes under `/Apps/remotely-secure/` after authorization.
- E2E encryption supported (vault name itself is not encrypted).

## Auto Sync

- Scheduled interval, startup, on-save, and remote-change detection are all supported.
- Errors silently fail in auto sync mode.
- Cannot run while Obsidian is closed (browser plugin limitation).

## Hidden Files

- Files/folders starting with `.` or `_` are excluded by default.
- Enable sync for `_` folders and `.obsidian` config dir in settings.

## Debugging

See [debugging docs](./docs/how_to_debug/README.md).

## Credit

- Thanks to @fyears for the original [Remotely Save](https://github.com/remotely-save/remotely-save) plugin.
- Thanks to @sboesen for the forked [Remotely Sync](https://github.com/sboesen/remotely-sync) plugin.


## Questions, Bugs, Suggestions

Open an issue on [GitHub](https://github.com/nightfall-yl/remotely-sync/issues). Pull requests are welcome!
