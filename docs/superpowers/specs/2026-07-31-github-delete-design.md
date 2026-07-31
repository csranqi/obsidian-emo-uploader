# GitHub 图片删除功能设计

## 背景与问题

当前插件（`obsidian-emo-uploader`）只有上传功能，没有任何删除能力。用户从 Obsidian 笔记中删除一张图片链接后，GitHub 仓库里对应的文件依然存在，日积月累产生大量无用文件。

本设计为 GitHub 图床新增两种删除能力：

1. **功能 1 — 删除光标处的单张图片**：光标停在某条图片链接上，执行命令即可删除该链接指向的 GitHub 远程文件。
2. **功能 3 — 清理当前文档不再引用的图片**：扫描当前笔记对应的 GitHub 目录，列出目录里存在但正文已不再引用的文件，确认后批量删除。

删除功能**只针对 GitHub**，其它图床不涉及。

## 目录标识方案（前置改造）

### 现状问题

`uploader-github.ts:21-25` 用文档创建时间 `activeFile.stat.ctime` 作为上传目录名：

```js
const date = new Date(activeFile.stat.ctime)
pathPre = pathPre + date.toISOString() + '/'
```

`ctime` 不适合作为文档的唯一标识：
- **会碰撞**：同一毫秒创建的多篇笔记（批量导入、模板生成、clone）目录相同，图片混在一起。
- **不稳定**：同步盘 / 跨设备 / clone 后 `ctime` 会被重置，导致同一篇笔记在不同设备算出不同目录。

### 新方案：frontmatter `md-id`

改用写入笔记 frontmatter 的唯一 ID `md-id` 作为目录名：

- 首次在某篇笔记上传图片时，若 frontmatter 无 `md-id`，则生成一个并写入。
- ID 格式：`<时间戳>-<随机串>`，例如 `1730000000000-a1b2c3`。
- 之后该笔记所有上传都用这个 `md-id` 当目录。
- 上传目录变为：`path + md-id + '/'`（`path` 即用户配置的前缀路径）。
- **不兼容旧的 ctime 目录**（用户已确认无需兼容旧数据）。

写入 frontmatter 使用 Obsidian 官方 API `app.fileManager.processFrontMatter(file, fn)`。

### 对上传逻辑的改动

`uploader-github.ts` 的 `upload()`：
- 删除 `ctime` 目录逻辑。
- 当 `prefixPath` 为 true 时（保持原开关语义），获取当前 activeFile 的 `md-id`（无则生成并写入），拼成 `pathPre = path + mdId + '/'`。
- `prefixPath` 为 false 时行为不变（直接用 `path`）。

## 组件设计

### 1. `GithubUploader.delete(filePath)` — 删除单个远程文件

在 `src/uploader/uploader-github.ts` 的 `GithubUploader` 增加删除方法。

GitHub 删除文件需两步：
1. `GET /repos/{owner}/{repo}/contents/{filePath}?ref={branch}` → 取得该文件的 `sha`。
2. `DELETE /repos/{owner}/{repo}/contents/{filePath}`，body 带 `{ message, sha, branch }`。

签名建议：`async deleteRemote(filePath: string): Promise<void>`。失败（如 404 文件不存在）抛错，由调用方决定提示。

### 2. `GithubUploader.listDir(dirPath)` — 列出目录下文件

用于功能 3。`GET /repos/{owner}/{repo}/contents/{dirPath}?ref={branch}` 返回该目录下的文件数组，提取每个条目的 `name` / `path` / `sha`。目录不存在时返回空数组。

### 3. URL 反解析工具（功能 1 用）

新增工具（如 `src/utils/github-url.ts`），从一条图片 markdown / URL 反推出 `{ owner, repo, branch, filePath }`。支持三种 CDN 格式：

| CDN | URL 格式 |
|---|---|
| raw | `raw.githubusercontent.com/{owner}/{repo}/{branch}/{filePath}` |
| jsdelivr | `cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{filePath}` |
| statically | `cdn.statically.io/gh/{owner}/{repo}/{branch}/{filePath}` |

解析后由调用方校验 `owner`/`repo` 是否等于当前 GitHub 配置——**只删当前配置仓库的链接，其它一律跳过**。无法解析或不匹配则不删。

### 4. 正文文件名提取（功能 3 用）

从当前笔记正文提取所有指向"当前 md-id 目录"的图片文件名集合，作为"仍被引用"的判据。实现上可复用工具 3 的解析（筛出属于本仓库、且路径前缀为 `path + mdId + '/'` 的链接，取其文件名）。

### 5. 命令注册（`main.ts`）

在 `onload()` 里注册两个 Obsidian 命令：

- **命令 1：删除光标处图片**
  - 取当前行 / 光标所在的图片链接文本。
  - 用工具 3 解析出 `filePath`，校验属于当前仓库。
  - 弹确认框（Obsidian `Modal` 或简单 confirm），确认后调用 `deleteRemote(filePath)`。
  - 远程删除成功后，**同步删除笔记里该条图片链接文本**（删除光标所在的那条链接）。若远程删除失败，则保留正文不动。
  - 通过 `Notice` 反馈成功/失败。

- **命令 2：清理当前文档未引用的图片**
  - 读当前笔记 `md-id`（无则提示"该文档尚未上传过图片"并退出）。
  - `listDir(path + mdId)` 拿到远程文件列表。
  - 提取正文仍引用的文件名集合。
  - 计算差集（远程有、正文无）→ 待删列表。
  - 弹出列表让用户确认（Modal 展示文件名清单）。
  - 确认后逐个 `deleteRemote()`，用 `Notice` 汇总结果（删除 N 个 / 失败 M 个）。

## 数据流

**功能 1（删单图）**
```
光标行文本 → 解析URL → {owner,repo,branch,filePath}
  → 校验仓库匹配 → 确认框 → GET sha → DELETE
  → 删除成功后同步删除正文该条链接 → Notice
```

**功能 3（清理文档）**
```
当前笔记 md-id → listDir(path+mdId) → 远程文件名集合 A
当前笔记正文 → 提取本目录引用文件名集合 B
待删 = A - B → 确认框(列清单) → 逐个 deleteRemote → Notice 汇总
```

## 错误处理

- **token 无删除权限 / 401 / 403**：捕获后 Notice 明确提示"检查 token 权限"。
- **文件不存在（404）**：功能 1 视为"远程本就没有"，提示即可，不算致命。
- **无 md-id**：功能 3 直接提示并退出。
- **URL 无法解析 / 非本仓库**：功能 1 提示"当前光标不是本仓库的图片链接"，不执行删除。
- **网络错误**：Notice 提示失败，保留原文件。
- 所有删除均需**用户确认**后才执行，避免误删。

## 测试策略

本项目当前无测试框架。计划：
- 为纯函数（URL 反解析、正文文件名提取、差集计算、md-id 生成）编写可独立验证的单元测试（若引入轻量 test runner）或至少保证这些函数是无副作用、可手动验证的纯函数。
- GitHub API 调用（get sha / delete / list）通过手动集成测试验证：真实仓库上传→删除→确认远程消失。
- 手动回归：确认上传目录已从 ctime 切换到 md-id；旧格式链接不被误删。

## 范围与非目标

- 仅 GitHub；不改动其它图床。
- 不做"自动监听文档删除即删远程"（误删风险高，本次不实现）。
- 不做全 vault 清理；功能 3 仅限当前文档目录（依赖 md-id 一文档一目录的前提）。
- 功能 1 删除远程成功后会同步删除正文该条链接；功能 3 只删远程文件，不改动正文。
