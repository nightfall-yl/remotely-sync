# Obsidian Third-party Sync

**Obsidian Third-party Sync** 是 [Remotely Save](https://github.com/remotely-save/remotely-save) 的非官方分叉插件，专注于安全性更新和功能增强。**与 Remotely Save 不兼容**，使用前请务必备份数据。详见[从 Remotely Save 迁移](#从-remotely-save-迁移)。

如果你觉得有用，欢迎在 GitHub 上给个项目 Star：[![GitHub Repo stars](https://img.shields.io/github/stars/nightfall-yl/remotely-sync?style=social)](https://github.com/nightfall-yl/remotely-sync)

欢迎提交 Pull Request！

## 免责声明

- **这不是 Obsidian 官方提供的 [同步服务](https://obsidian.md/sync)。**
- **⚠️ 使用本插件前，请务必备份你的 Vault。**

## 与 Remotely Save 的主要区别

### 安全更新
- 加密升级为 [AES-GCM](https://github.com/nightfall-yl/remotely-sync/commit/d9ad76e774b0b1cee2b36316058df926f4bfb2bf)，更安全，且解密时会验证密文完整性，防止 [padding oracle 攻击](https://cryptopals.com/sets/3/challenges/17)。
- Salt 从 8 字节升级为 16 字节。
- IV 不再从用户密码派生。

### 功能更新
- **同步方向**：支持 5 种模式——双向同步、增量推送（备份）、增量拉取、增量推送+删除、增量拉取+删除。
- **变更比例保护**：当修改/删除的文件比例超过阈值时中止同步，防止意外大规模变更。
- **可选不上传同步元数据**：S3 存储可选择不上传 `_remotely-secure-metadata-on-remote.json`，减少远端存储占用。
- 冲突处理：可配置冲突时保留较新版本或保留较大文件。
- 空文件夹清理：自动清理两端空文件夹。
- 保留原有 Remotely Save 所有功能（端到端加密、移动端支持、自动同步等）。

## 功能特性

- **支持的存储服务**：Amazon S3（及兼容服务：腾讯云 COS、阿里云 OSS、Backblaze B2、MinIO 等）、WebDAV（坚果云、Nextcloud、OwnCloud、Seafile、rclone 等）、OneDrive 个人版。详见[服务连接性文档](./docs/services_connectable_or_not.md)。
- **Obsidian 移动端支持**，Vault 可跨桌面和移动端同步。
- **端到端加密**（[详见](./docs/encryption.md)）：设置密码后，文件在上传前本地加密，采用 AES-256-GCM + RClone Crypt 格式。
- **自动同步**：支持定时同步、启动时同步、保存时同步、远端变化检测后同步。
- **同步方向**：双向同步 / 增量推送 / 增量拉取 / 带删除的增量模式。
- **变更比例保护**：防止意外的大规模文件修改或删除。
- **同步书签及配置文件夹**（可选）。
- **状态栏显示**同步进度与最后同步时间。
- **调试模式**：导出同步计划、导出终端日志。
- **QR 码导入/导出设置**（OneDrive OAuth 信息除外）。
- **[最小侵入设计](./docs/minimal_intrusive_design.md)**。
- **完全开源**（[Apache-2.0](./LICENSE)）。
- **[同步算法](./docs/sync_algorithm.md)**。

## 限制与注意事项

- **不同步元数据时，删除同步依赖时间戳判断**，建议配合增量推送/拉取模式使用。
- **无冲突解决算法**，文件以修改时间判断，修改时间较新者胜出。
- **云存储会产生费用**：所有操作（上传、下载、列举文件、调用 API）均可能计费。
- **部分限制来自浏览器环境**，详见[技术文档](./docs/browser_env.md)。
- **请保护 `data.json` 文件**：包含敏感信息，不要分享给他人，建议加入 `.gitignore`。

## 从 Remotely Save 迁移

1. 在本地做一份未加密的备份（确保所有设备间已同步完毕）
2. 禁用 Remotely Save 插件
3. 启用 Obsidian Third-party Sync，设置新的加密密码
4. 删除云端已加密的文件（或新建一个 S3 Bucket）
5. 使用 Obsidian Third-party Sync 进行首次同步

## 安装

**方式一**：在 Obsidian 社区插件市场中搜索 `Obsidian Third-party Sync` 安装。

**方式二**：使用 [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat)，添加仓库 `nightfall-yl/remotely-sync`。

**方式三**：手动下载最新 Release 的 `main.js`、`manifest.json`、`styles.css`，放入 Vault 的 `.obsidian/plugins/obsidian-third-party-sync/` 目录。

## 构建

```bash
git clone https://github.com/nightfall-yl/remotely-sync
cd remotely-sync
npm install

# 开发构建（监听文件变化自动重编译）
npm run dev

# 生产构建（webpack）
npm run build
```

部署到插件目录：
```bash
cp main.js styles.css manifest.json /your/path/to/vault/.obsidian/plugins/obsidian-third-party-sync
```

## 使用

### S3

- 准备 S3 信息：Endpoint、Region、Access Key ID、Secret Access Key、Bucket 名称。
- **CORS 配置**（仅 Obsidian 桌面版 < 0.13.25 或移动版 < 1.1.1 需要）：在 S3 控制台配置 CORS，允许来源 `app://obsidian.md`、`capacitor://localhost`、`http://localhost`，并暴露 `ETag` Header。配置示例见 [S3 CORS 配置文档](./docs/s3_cors_configure.md)。
- 在插件设置中填入信息，设置加密密码（如需要）。
- 点击左侧栏图标手动同步，或在设置中开启自动同步。

### WebDAV

- 坚果云、Nextcloud、OwnCloud、Seafile、rclone 等均支持。
- **CORS 配置**（同上，仅旧版 Obsidian 需要）。
- 部分服务需要安装 `WebAppPassword` 等插件配合。详见 [WebDAV 配置文档](./docs/apache_cors_configure.md)。

### OneDrive（个人版）

- 仅支持个人版，不支持企业版。
- 授权后插件在 `/Apps/remotely-secure/` 下读写文件。
- 支持端到端加密（Vault 名称本身不加密）。

## 自动同步

- 支持定时自动同步、启动时自动同步、保存时自动同步、远端变化检测后自动同步。
- 自动同步模式下出错会静默失败。
- Obsidian 关闭后无法自动同步（浏览器插件的技术限制）。

## 隐藏文件

- 默认以 `.` 或 `_` 开头的文件和文件夹不同步。
- 可在设置中开启同步 `_` 文件夹和 `.obsidian` 配置文件夹。

## 调试

详见[调试文档](./docs/how_to_debug/README.md)。

## 鸣谢

- 感谢 @fyears 的原始项目 [Remotely Save](https://github.com/remotely-save/remotely-save) 。
- 感谢 @sboesen 的分支项目 [Remotely Sync](https://github.com/sboesen/remotely-sync)，Obsidian Third-party Sync 受启发精简开发。

## 问题反馈

欢迎在 [GitHub Issues](https://github.com/nightfall-yl/remotely-sync/issues) 反馈问题。Pull Request 同样欢迎！