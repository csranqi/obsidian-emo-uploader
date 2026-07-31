# GitHub 图片删除功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 GitHub 图床新增两条删除命令——删除光标处单张图片（并同步删正文链接）、清理当前文档不再引用的图片；同时把上传目录从 `ctime` 改为 frontmatter `md-id`。

**Architecture:** 上传时用笔记 frontmatter 里的唯一 `md-id` 作为 GitHub 目录名。`GithubUploader` 增加 `deleteRemote()` 与 `listDir()` 两个 API 方法。新增一个纯函数工具 `github-url.ts` 负责 CDN URL 反解析与正文文件名提取。`main.ts` 注册两条 Obsidian 命令驱动整体流程。

**Tech Stack:** TypeScript 4.9, Obsidian 1.1.1 API（`request`, `Editor`, `Modal`, `Notice`, `fileManager.processFrontMatter`）, obsidian-plugin-cli 构建（tsc 类型检查）。

## Global Constraints

- 仅改动 GitHub 图床，不触碰其它 uploader。
- 删除动作**必须用户确认**后才执行。
- URL 反解析只处理 `owner`/`repo` 等于当前 GitHub 配置的链接，其它一律跳过。
- 不兼容旧的 ctime 目录数据。
- frontmatter key 固定为 `md-id`；ID 格式 `<时间戳>-<随机串>`（如 `1730000000000-a1b2c3`）。
- 支持三种 CDN URL 格式：raw (`raw.githubusercontent.com/{owner}/{repo}/{branch}/{filePath}`)、jsdelivr (`cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{filePath}`)、statically (`cdn.statically.io/gh/{owner}/{repo}/{branch}/{filePath}`)。
- 所有用户可见文案通过 `t()` 走 i18n，至少补 en 与 zh-cn 两个 locale。
- 无自动化测试框架：纯函数用 `npx tsx` 跑独立断言脚本验证；API/UI 部分用 `npm run build` 类型检查 + 手动 Obsidian 集成测试验证。

---

## File Structure

- `src/utils/github-url.ts` (Create) — 纯函数：`parseGithubImageUrl()`、`extractReferencedFileNames()`、`generateMdId()`。无副作用，可独立测试。
- `src/uploader/uploader-github.ts` (Modify) — `upload()` 改用 md-id 目录；新增 `deleteRemote()`、`listDir()`。
- `src/main.ts` (Modify) — 注册两条命令，编排删除流程与正文链接删除。
- `src/ui/confirm-modal.ts` (Create) — 简单确认 Modal，展示待删清单并回调确认。
- `src/lang/locale/en.ts`、`src/lang/locale/zh-cn.ts` (Modify) — 新增删除相关文案。
- `scripts/test-github-url.ts` (Create) — 纯函数断言脚本，`npx tsx` 运行。

---

## Task 1: URL 反解析与纯函数工具

**Files:**
- Create: `src/utils/github-url.ts`
- Test: `scripts/test-github-url.ts`

**Interfaces:**
- Produces:
  - `interface GithubFileRef { owner: string; repo: string; branch: string; filePath: string }`
  - `parseGithubImageUrl(text: string): GithubFileRef | null` — 从一段含图片链接的文本解析出文件引用；无法识别返回 null。
  - `generateMdId(timestamp: number, rand: string): string` — 返回 `` `${timestamp}-${rand}` ``。
  - `extractReferencedFileNames(body: string, owner: string, repo: string, dirPath: string): Set<string>` — 从正文中提取所有属于本仓库、路径前缀为 `dirPath` 的链接的文件名集合。

- [ ] **Step 1: 写失败测试 `scripts/test-github-url.ts`**

```ts
import assert from 'assert'
import { parseGithubImageUrl, generateMdId, extractReferencedFileNames } from '../src/utils/github-url'

// raw
let r = parseGithubImageUrl('![gh](https://raw.githubusercontent.com/me/img/main/p/id1/a.png)')
assert.deepStrictEqual(r, { owner: 'me', repo: 'img', branch: 'main', filePath: 'p/id1/a.png' })

// jsdelivr (branch 用 @ 分隔)
r = parseGithubImageUrl('![gh](https://cdn.jsdelivr.net/gh/me/img@main/p/id1/a.png)')
assert.deepStrictEqual(r, { owner: 'me', repo: 'img', branch: 'main', filePath: 'p/id1/a.png' })

// statically
r = parseGithubImageUrl('![gh](https://cdn.statically.io/gh/me/img/main/p/id1/a.png)')
assert.deepStrictEqual(r, { owner: 'me', repo: 'img', branch: 'main', filePath: 'p/id1/a.png' })

// 非 github 链接 → null
assert.strictEqual(parseGithubImageUrl('![x](https://i.imgur.com/x.png)'), null)
// 纯文本无链接 → null
assert.strictEqual(parseGithubImageUrl('hello world'), null)

// generateMdId
assert.strictEqual(generateMdId(1730000000000, 'a1b2c3'), '1730000000000-a1b2c3')

// extractReferencedFileNames: 只取本仓库、指定目录前缀下的文件名
const body = [
  '![gh](https://raw.githubusercontent.com/me/img/main/p/id1/a.png)',
  '![gh](https://cdn.jsdelivr.net/gh/me/img@main/p/id1/b.png)',
  '![gh](https://raw.githubusercontent.com/me/img/main/p/OTHER/c.png)', // 不同目录
  '![x](https://i.imgur.com/z.png)' // 非本仓库
].join('\n')
const names = extractReferencedFileNames(body, 'me', 'img', 'p/id1/')
assert.deepStrictEqual([...names].sort(), ['a.png', 'b.png'])

console.log('ALL PASS')
```

- [ ] **Step 2: 运行验证失败**

Run: `npx tsx scripts/test-github-url.ts`
Expected: FAIL — Cannot find module '../src/utils/github-url'

- [ ] **Step 3: 实现 `src/utils/github-url.ts`**

```ts
export interface GithubFileRef {
  owner: string
  repo: string
  branch: string
  filePath: string
}

const RAW = /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/
const JSDELIVR = /cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@([^/]+)\/(.+)/
const STATICALLY = /cdn\.statically\.io\/gh\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/

function stripUrl (raw: string): string {
  // 去掉 markdown 链接语法与两端括号/空白，仅保留 URL 主体
  const m = raw.match(/https?:\/\/[^\s)]+/)
  return m != null ? m[0] : raw.trim()
}

export function parseGithubImageUrl (text: string): GithubFileRef | null {
  const url = stripUrl(text)
  for (const re of [RAW, JSDELIVR, STATICALLY]) {
    const m = url.match(re)
    if (m != null) {
      return { owner: m[1], repo: m[2], branch: m[3], filePath: m[4] }
    }
  }
  return null
}

export function generateMdId (timestamp: number, rand: string): string {
  return `${timestamp}-${rand}`
}

export function extractReferencedFileNames (
  body: string,
  owner: string,
  repo: string,
  dirPath: string
): Set<string> {
  const names = new Set<string>()
  const urlRe = /https?:\/\/[^\s)]+/g
  const matches = body.match(urlRe) ?? []
  for (const url of matches) {
    const ref = parseGithubImageUrl(url)
    if (ref == null) continue
    if (ref.owner !== owner || ref.repo !== repo) continue
    if (!ref.filePath.startsWith(dirPath)) continue
    const name = ref.filePath.slice(dirPath.length)
    if (name.length > 0 && !name.includes('/')) names.add(name)
  }
  return names
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npx tsx scripts/test-github-url.ts`
Expected: `ALL PASS`

- [ ] **Step 5: 提交**

```bash
git add src/utils/github-url.ts scripts/test-github-url.ts
git commit -m "feat: add github url parsing utilities for image deletion"
```

---

## Task 2: 上传目录改用 frontmatter md-id

**Files:**
- Modify: `src/uploader/uploader-github.ts:16-49`

**Interfaces:**
- Consumes: `generateMdId` from `src/utils/github-url` (Task 1)
- Produces: `GithubUploader.getOrCreateMdId(): Promise<string>` — 读取 activeFile 的 `md-id`，无则生成写入 frontmatter 后返回。

- [ ] **Step 1: 新增 `getOrCreateMdId` 方法**

在 `GithubUploader` 类中新增（`import` 处加入 `generateMdId`，从 obsidian 加入 `TFile` 类型仅用于类型注解可省略）：

```ts
private async getOrCreateMdId (): Promise<string> {
  const app = WindowShared.getApp()
  const activeFile = app.workspace.getActiveFile()
  if (activeFile == null) throw new Error('no active file')
  let mdId = ''
  await app.fileManager.processFrontMatter(activeFile, (fm) => {
    if (typeof fm['md-id'] === 'string' && fm['md-id'].length > 0) {
      mdId = fm['md-id']
    } else {
      const rand = (Math.random() * 10086).toString(36).slice(-6)
      mdId = generateMdId(Date.parse(new Date().toString()), rand)
      fm['md-id'] = mdId
    }
  })
  return mdId
}
```

- [ ] **Step 2: 修改 `upload()` 目录拼接（替换 `uploader-github.ts:21-25`）**

把原 ctime 逻辑：

```ts
let pathPre = this.parms.path
if (this.parms.prefixPath && activeFile != null) {
  const date = new Date(activeFile.stat.ctime)
  pathPre = pathPre + date.toISOString() + '/'
}
```

替换为：

```ts
let pathPre = this.parms.path
if (this.parms.prefixPath && activeFile != null) {
  const mdId = await this.getOrCreateMdId()
  pathPre = pathPre + mdId + '/'
}
```

- [ ] **Step 3: 补充 import**

在文件顶部 import 区加入：

```ts
import { generateMdId } from '../utils/github-url'
```

- [ ] **Step 4: 类型检查通过**

Run: `npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 5: 手动集成验证**

在 Obsidian 中启用插件，向一篇新笔记粘贴图片：确认笔记 frontmatter 新增 `md-id`，且 GitHub 上文件落在 `path/<md-id>/` 目录下。

- [ ] **Step 6: 提交**

```bash
git add src/uploader/uploader-github.ts
git commit -m "feat: use frontmatter md-id as github upload directory"
```

---

## Task 3: GithubUploader 删除与列目录 API

**Files:**
- Modify: `src/uploader/uploader-github.ts`

**Interfaces:**
- Produces:
  - `GithubUploader.deleteRemote(filePath: string): Promise<void>` — GET sha 后 DELETE 该文件。
  - `GithubUploader.listDir(dirPath: string): Promise<Array<{ name: string, path: string, sha: string }>>` — 列目录文件，目录不存在返回 `[]`。

- [ ] **Step 1: 实现 `deleteRemote`**

在 `GithubUploader` 类中新增：

```ts
async deleteRemote (filePath: string): Promise<void> {
  const { owner, repo, branch, token, message } = this.parms.required
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`
  const getReq: RequestUrlParam = {
    url: `${base}?ref=${branch}`,
    method: 'GET',
    headers: { Authorization: `token ${token}` }
  }
  const getRes = await request(getReq)
  const sha = JSON.parse(getRes).sha as string
  const delReq: RequestUrlParam = {
    url: base,
    method: 'DELETE',
    headers: { Authorization: `token ${token}` },
    body: JSON.stringify({ message, sha, branch })
  }
  await request(delReq)
}
```

- [ ] **Step 2: 实现 `listDir`**

```ts
async listDir (dirPath: string): Promise<Array<{ name: string, path: string, sha: string }>> {
  const { owner, repo, branch, token } = this.parms.required
  const req: RequestUrlParam = {
    url: `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`,
    method: 'GET',
    headers: { Authorization: `token ${token}` }
  }
  try {
    const res = await request(req)
    const arr = JSON.parse(res)
    if (!Array.isArray(arr)) return []
    return arr.map((e: any) => ({ name: e.name, path: e.path, sha: e.sha }))
  } catch (err) {
    return [] // 目录不存在等
  }
}
```

- [ ] **Step 3: 类型检查通过**

Run: `npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 4: 手动集成验证**

用一个测试文件路径调用 `deleteRemote`（可临时在命令里接线，或在 Task 5 完成后统一验证）：确认 GitHub 上文件消失；`listDir` 返回目录内文件列表。

- [ ] **Step 5: 提交**

```bash
git add src/uploader/uploader-github.ts
git commit -m "feat: add github deleteRemote and listDir api methods"
```

---

## Task 4: 确认 Modal 与 i18n 文案

**Files:**
- Create: `src/ui/confirm-modal.ts`
- Modify: `src/lang/locale/en.ts`, `src/lang/locale/zh-cn.ts`

**Interfaces:**
- Produces: `class ConfirmModal extends Modal` — 构造参数 `(app, title: string, lines: string[], onConfirm: () => void)`；渲染标题、清单、确认/取消按钮。

- [ ] **Step 1: 新增 i18n 文案（en.ts 追加到 return 对象内，`uploadPath` 后加逗号）**

```ts
  // delete feature
  'delete image cmd': 'Delete image at cursor (GitHub)',
  'clean doc cmd': 'Clean unused images of current doc (GitHub)',
  'confirm delete title': 'Confirm delete',
  'confirm': 'Confirm',
  'cancel': 'Cancel',
  'not github image': 'Cursor is not a GitHub image link of the current repo',
  'no md-id': 'This document has no md-id (never uploaded)',
  'nothing to clean': 'No unused images to clean',
  'delete success': 'Deleted from GitHub',
  'delete failed': 'Delete failed, check token permission',
  'clean result': 'Clean done'
```

- [ ] **Step 2: 新增 zh-cn 对应文案（zh-cn.ts 同样追加）**

```ts
  // delete feature
  'delete image cmd': '删除光标处图片（GitHub）',
  'clean doc cmd': '清理当前文档未引用的图片（GitHub）',
  'confirm delete title': '确认删除',
  'confirm': '确认',
  'cancel': '取消',
  'not github image': '光标处不是当前仓库的 GitHub 图片链接',
  'no md-id': '该文档没有 md-id（尚未上传过图片）',
  'nothing to clean': '没有可清理的未引用图片',
  'delete success': '已从 GitHub 删除',
  'delete failed': '删除失败，请检查 token 权限',
  'clean result': '清理完成'
```

- [ ] **Step 3: 实现 `src/ui/confirm-modal.ts`**

```ts
import { App, Modal } from 'obsidian'
import { t } from '../lang/helpers'

export class ConfirmModal extends Modal {
  title: string
  lines: string[]
  onConfirm: () => void

  constructor (app: App, title: string, lines: string[], onConfirm: () => void) {
    super(app)
    this.title = title
    this.lines = lines
    this.onConfirm = onConfirm
  }

  onOpen (): void {
    const { contentEl } = this
    contentEl.createEl('h3', { text: this.title })
    for (const line of this.lines) {
      contentEl.createEl('div', { text: line })
    }
    const btnRow = contentEl.createDiv({ cls: 'emo-confirm-btns' })
    const confirmBtn = btnRow.createEl('button', { text: t('confirm') })
    confirmBtn.addEventListener('click', () => {
      this.close()
      this.onConfirm()
    })
    const cancelBtn = btnRow.createEl('button', { text: t('cancel') })
    cancelBtn.addEventListener('click', () => { this.close() })
  }

  onClose (): void {
    this.contentEl.empty()
  }
}
```

- [ ] **Step 4: 类型检查通过**

Run: `npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 5: 提交**

```bash
git add src/ui/confirm-modal.ts src/lang/locale/en.ts src/lang/locale/zh-cn.ts
git commit -m "feat: add confirm modal and i18n strings for delete feature"
```

---

## Task 5: 注册两条删除命令

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `GithubUploader.deleteRemote/listDir` (Task 3), `parseGithubImageUrl/extractReferencedFileNames` (Task 1), `ConfirmModal` (Task 4), i18n 文案 (Task 4)。

- [ ] **Step 1: 补充 import（main.ts 顶部）**

```ts
import { ConfirmModal } from './ui/confirm-modal'
import { parseGithubImageUrl, extractReferencedFileNames } from './utils/github-url'
import { HostingProvider } from './config'
```
（`HostingProvider` 若已 import 则跳过。`Notice`, `t`, `GithubUploader` 已存在。）

- [ ] **Step 2: 在 `onload()` 末尾注册命令**

```ts
this.registerDeleteCommands()
```

- [ ] **Step 3: 新增 `registerDeleteCommands` 方法**

```ts
private registerDeleteCommands (): void {
  // 命令1：删除光标处图片
  this.addCommand({
    id: 'emo-delete-image-at-cursor',
    name: t('delete image cmd'),
    editorCallback: (editor) => {
      const line = editor.getLine(editor.getCursor().line)
      const ref = parseGithubImageUrl(line)
      const gp = this.config.github_parms
      if (ref == null || ref.owner !== gp.required.owner || ref.repo !== gp.required.repo) {
        new Notice(t('not github image'), 3000)
        return
      }
      new ConfirmModal(this.app, t('confirm delete title'), [ref.filePath], () => {
        const uploader = new GithubUploader(gp)
        uploader.deleteRemote(ref.filePath).then(() => {
          // 同步删除正文该行链接
          const cur = editor.getCursor().line
          editor.replaceRange('', { line: cur, ch: 0 }, { line: cur + 1, ch: 0 })
          new Notice(t('delete success'), 2000)
        }).catch((err) => {
          console.log(err)
          new Notice(t('delete failed'), 3000)
        })
      }).open()
    }
  })

  // 命令2：清理当前文档未引用的图片
  this.addCommand({
    id: 'emo-clean-doc-images',
    name: t('clean doc cmd'),
    editorCallback: (editor, view) => {
      const file = view.file
      const gp = this.config.github_parms
      if (file == null) return
      this.app.fileManager.processFrontMatter(file, (fm) => {
        const mdId = fm['md-id']
        if (typeof mdId !== 'string' || mdId.length === 0) {
          new Notice(t('no md-id'), 3000)
          return
        }
        const dirPath = gp.path + mdId + '/'
        const uploader = new GithubUploader(gp)
        uploader.listDir(gp.path + mdId).then((files) => {
          const body = editor.getValue()
          const referenced = extractReferencedFileNames(body, gp.required.owner, gp.required.repo, dirPath)
          const toDelete = files.filter((f) => !referenced.has(f.name))
          if (toDelete.length === 0) {
            new Notice(t('nothing to clean'), 2000)
            return
          }
          new ConfirmModal(this.app, t('confirm delete title'), toDelete.map((f) => f.name), () => {
            Promise.allSettled(toDelete.map(async (f) => await uploader.deleteRemote(f.path)))
              .then((results) => {
                const ok = results.filter((r) => r.status === 'fulfilled').length
                const fail = results.length - ok
                new Notice(`${t('clean result')}: ${ok} ✓ / ${fail} ✗`, 3000)
              })
          }).open()
        }).catch((err) => {
          console.log(err)
          new Notice(t('delete failed'), 3000)
        })
      })
    }
  })
}
```

- [ ] **Step 4: 类型检查通过**

Run: `npm run build`
Expected: 构建成功，无 TS 报错。若 `view.file` 类型报错，用 `(view as any).file` 或从 `MarkdownView` import 后类型断言。

- [ ] **Step 5: 手动集成验证（端到端）**

1. 新笔记粘贴 2 张图 → 确认 frontmatter 有 `md-id`，GitHub `path/<md-id>/` 下有 2 个文件。
2. 光标放到其中一条图片链接行 → 运行"删除光标处图片"命令 → 确认框确认 → GitHub 该文件消失，正文该行被删除。
3. 从正文手动删掉第 2 条链接（不删远程）→ 运行"清理当前文档未引用的图片"→ 确认清单列出该文件 → 确认 → GitHub 该文件消失。
4. 光标放在非 GitHub 链接行运行命令1 → 提示 `not github image`，不误删。

- [ ] **Step 6: 提交**

```bash
git add src/main.ts
git commit -m "feat: register delete-at-cursor and clean-doc github image commands"
```

---

## Self-Review 记录

- **Spec 覆盖**：目录改造→Task 2；deleteRemote/listDir→Task 3；URL 反解析→Task 1；正文文件名提取→Task 1；命令注册与流程→Task 5；确认框与错误提示→Task 4/5；同步删正文→Task 5 命令1。全覆盖。
- **占位符扫描**：无 TBD/TODO，所有代码步骤含完整代码。
- **类型一致性**：`GithubFileRef` 字段、`deleteRemote(filePath)`、`listDir(dirPath)` 返回 `{name,path,sha}`、`ConfirmModal(app,title,lines,onConfirm)`、`extractReferencedFileNames(body,owner,repo,dirPath)` 在 Task 1/3/4/5 间签名一致。
- **注意点**：`listDir` 传目录用 `gp.path + mdId`（无末尾斜杠），`extractReferencedFileNames` 的 `dirPath` 用带斜杠的 `gp.path + mdId + '/'`——两者用途不同，已在 Task 5 分别处理。
