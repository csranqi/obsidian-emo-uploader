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
