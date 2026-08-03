import type { Editor } from 'obsidian'
import {
  Plugin,
  Notice,
  MarkdownView
} from 'obsidian'
import { t } from './lang/helpers'
import { EmoUploaderSettingTab } from './settings-tab'
import type { Config } from './config'
import { WindowShared, DEFAULT_SETTINGS, HostingProvider } from './config'
import type { EmoUploader } from './base/emo-uploader'
import { GithubUploader } from './uploader/uploader-github'
import { ImgurlUploader } from './uploader/uploader-imgurl'
import { CloudinaryUploader } from './uploader/uploader-cloudinary'
import { SmmsUploader } from './uploader/uploader-smms'
import { ImgbbUploader } from './uploader/uploader-imgbb'
import { ImgurUploader } from './uploader/uploader-imgur'
import { CatboxUploader } from './uploader/uploader-catbox'
import { CheveretoUploader } from './uploader/uploader-chevereto'
import { AlistUploader } from './uploader/uploader-alist'
import { EasyImageUploader } from './uploader/uploader-easyimage'
import { ConfirmModal } from './ui/confirm-modal'
import { parseGithubImageUrl, extractReferencedFileNames } from './utils/github-url'

export default class Emo extends Plugin {
  config!: Config

  // Plugin load steps
  async onload (): Promise<void> {
    console.log('loading  Emo uploader')
    await this.loadSettings()
    this.setupPasteHandler()
    this.addSettingTab(new EmoUploaderSettingTab(this.app, this))
    WindowShared.register(this.app)
    this.registerDeleteCommands()
    this.registerImageHoverDelete()
  }

  // Plugin shutdown steps
  onunload (): void {
    console.log('unloading Emo uploader')
    WindowShared.unregister()
  }

  // Load settings infromation
  async loadSettings (): Promise<void> {
    this.config = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  // When saving settings
  async saveSettings (): Promise<void> {
    await this.saveData(this.config)
  }

  setupPasteHandler (): void {
    // get files from drag or drop
    this.registerEvent(this.app.workspace.on('editor-drop', async (evt: DragEvent, editor: Editor) => {
      const { files } = evt.dataTransfer as DataTransfer
      this.startUpload(files, evt, editor)
    }))
    // get files from clipboard
    this.registerEvent(this.app.workspace.on('editor-paste', async (evt: ClipboardEvent, editor: Editor) => {
      const { files } = evt.clipboardData as DataTransfer
      this.startUpload(files, evt, editor)
    }))
  }

  startUpload (files: FileList, evt: Event, editor: Editor): void {
    let uploader: EmoUploader
    if (files.length > 0) {
      const UploaderMap = {
        [HostingProvider.Github]: () => new GithubUploader(this.config.github_parms),
        [HostingProvider.ImgURL]: () => new ImgurlUploader(this.config.imgurl_parms),
        [HostingProvider.Cloudinary]: () => new CloudinaryUploader(this.config.cloudinary_parms),
        [HostingProvider.Smms]: () => new SmmsUploader(this.config.smms_parms),
        [HostingProvider.Imgbb]: () => new ImgbbUploader(this.config.imgbb_parms),
        [HostingProvider.Imgur]: () => new ImgurUploader(this.config.imgur_parms),
        [HostingProvider.Catbox]: () => new CatboxUploader(this.config.catbox_parms),
        [HostingProvider.Chevereto]: () => new CheveretoUploader(this.config.chevereto_parms),
        [HostingProvider.Alist]: () => new AlistUploader(this.config.alist_parms),
        [HostingProvider.EasgyImage]: () => new EasyImageUploader(this.config.easyimage_parms)
      }
      uploader = UploaderMap[this.config.choice]()
      if (uploader.isValid()) { // check the necessary parameters
        evt.preventDefault()
        for (const file of files) {
          const randomString = (Math.random() * 10086).toString(36).slice(-6)
          const pastePlaceText = `![uploading...](${randomString})\n`
          editor.replaceSelection(pastePlaceText) // mark the uploading
          uploader.upload(file).then((markdownText) => {
            const showTag = file.type.startsWith('image') ? 0 : 1// whether use `!` at the beginning
            this.replaceText(editor, pastePlaceText, markdownText.slice(showTag)) // use image/file link
          }).catch(err => {
            this.replaceText(editor, pastePlaceText, `[${this.config.choice} upload error]()`)
            console.log(new Notice(this.config.choice + t('upload error'), 2000))
            console.log(err)
          })
        }
      } else {
        console.log(new Notice(t('parms error'), 2000))
        console.log(uploader)
      }
    }
  }

  // Function to replace text
  private replaceText (editor: Editor, target: string, replacement: string): void {
    target = target.trim()
    const lines = []
    for (let i = 0; i < editor.lineCount(); i++) {
      lines.push(editor.getLine(i))
    }
    for (let i = 0; i < lines.length; i++) {
      const ch = lines[i].indexOf(target)
      if (ch !== -1) {
        const from = { line: i, ch }
        const to = { line: i, ch: ch + target.length }
        editor.replaceRange(replacement, from, to)
        break
      }
    }
  }

  private registerDeleteCommands (): void {
    // 命令1：删除光标处图片
    this.addCommand({
      id: 'emo-delete-image-at-cursor',
      name: t('delete image cmd'),
      editorCallback: (editor) => { this.deleteImageAtCursor(editor, true) }
    })

    // 右键菜单：删除光标处图片（仅当当前行是本仓库图片链接时显示）
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
      const line = editor.getLine(editor.getCursor().line)
      const ref = parseGithubImageUrl(line)
      const gp = this.config.github_parms
      if (ref == null || ref.owner !== gp.required.owner || ref.repo !== gp.required.repo) return
      menu.addItem((item) => {
        item.setTitle(t('delete image cmd'))
          .setIcon('trash')
          .onClick(() => { this.deleteImageAtCursor(editor, false) })
      })
    }))

    // 命令2：清理当前文档未引用的图片
    this.addCommand({
      id: 'emo-clean-doc-images',
      name: t('clean doc cmd'),
      editorCallback: (editor, view) => {
        const file = (view as any).file
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
              let ok = 0
              let fail = 0
              const settle = (): void => {
                if (ok + fail === toDelete.length) {
                  new Notice(`${t('clean result')}: ${ok} ✓ / ${fail} ✗`, 3000)
                }
              }
              for (const f of toDelete) {
                uploader.deleteRemote(f.path).then(() => {
                  ok++
                  settle()
                }).catch((err) => {
                  console.log(err)
                  fail++
                  settle()
                })
              }
            }).open()
          }).catch((err) => {
            console.log(err)
            new Notice(t('delete failed'), 3000)
          })
        })
      }
    })
  }

  private registerImageHoverDelete (): void {
    const attachBtn = (img: HTMLImageElement): void => {
      if (img.dataset.emoDelete === '1') return
      const src = img.getAttribute('src') ?? ''
      const ref = parseGithubImageUrl(src)
      const gp = this.config.github_parms
      if (ref == null || ref.owner !== gp.required.owner || ref.repo !== gp.required.repo) return

      img.dataset.emoDelete = '1'
      const wrap = document.createElement('span')
      wrap.className = 'emo-img-wrap'
      img.parentNode?.insertBefore(wrap, img)
      wrap.appendChild(img)

      const btn = document.createElement('div')
      btn.className = 'emo-img-delete-btn'
      btn.setAttribute('aria-label', t('delete image cmd'))
      btn.setAttribute('role', 'button')
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`
      wrap.appendChild(btn)

      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        // find the active editor leaf to get sourcePath
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView)
        const sourcePath: string = (mdView as any)?.file?.path ?? ''
        const file = sourcePath ? this.app.vault.getAbstractFileByPath(sourcePath) as any : null
        new ConfirmModal(this.app, t('confirm delete title'), [ref.filePath], () => {
          const uploader = new GithubUploader(gp)
          uploader.deleteRemote(ref.filePath).then(() => {
            if (file != null) {
              this.app.vault.process(file, (content) => {
                const linkPattern = /!?\[[^\]]*\]\([^)]*\)/g
                return content.replace(linkPattern, (match) => {
                  const matchRef = parseGithubImageUrl(match)
                  return matchRef != null && matchRef.filePath === ref.filePath ? '' : match
                })
              })
            }
            new Notice(t('delete success'), 2000)
          }).catch((err) => {
            console.log(err)
            new Notice(t('delete failed'), 3000)
          })
        }).open()
      })
    }

    const scanImgs = (root: Element): void => {
      root.querySelectorAll('img').forEach((img) => attachBtn(img as HTMLImageElement))
    }

    // scan existing content when a leaf becomes active
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView)
      const container = (view as any)?.contentEl as Element | undefined
      if (container != null) scanImgs(container)
    }))

    // watch DOM for newly inserted images
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            if (node.tagName === 'IMG') attachBtn(node as HTMLImageElement)
            else scanImgs(node)
          }
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    this.register(() => observer.disconnect())
  }

  private deleteImageAtCursor (editor: Editor, notifyWhenNotImage: boolean): void {
    const lineNo = editor.getCursor().line
    const line = editor.getLine(lineNo)
    const ref = parseGithubImageUrl(line)
    const gp = this.config.github_parms
    if (ref == null || ref.owner !== gp.required.owner || ref.repo !== gp.required.repo) {
      if (notifyWhenNotImage) new Notice(t('not github image'), 3000)
      return
    }
    new ConfirmModal(this.app, t('confirm delete title'), [ref.filePath], () => {
      const uploader = new GithubUploader(gp)
      uploader.deleteRemote(ref.filePath).then(() => {
        // Remove only the matched image/link span on the captured line
        const linkPattern = /!?\[[^\]]*\]\([^)]*\)/g
        const currentLine = editor.getLine(lineNo)
        let match: RegExpExecArray | null
        let removed = false
        while ((match = linkPattern.exec(currentLine)) !== null) {
          const spanRef = parseGithubImageUrl(match[0])
          if (spanRef != null && spanRef.filePath === ref.filePath) {
            editor.replaceRange('', { line: lineNo, ch: match.index }, { line: lineNo, ch: match.index + match[0].length })
            removed = true
            break
          }
        }
        if (!removed) {
          // Remote deletion succeeded but span not found; leave body untouched
          console.log('emo-uploader: could not locate link span on line', lineNo)
        }
        new Notice(t('delete success'), 2000)
      }).catch((err) => {
        console.log(err)
        new Notice(t('delete failed'), 3000)
      })
    }).open()
  }
}
