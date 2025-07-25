import type { RequestUrlParam } from 'obsidian'
import { request } from 'obsidian'
import type { GithubParms } from '../parms/parms-github'
import { CDNprovider } from '../parms/parms-github'
import { getBase64, getRandomFileName } from '../utils/file-helper'
import { EmoUploader } from '../base/emo-uploader'
import { WindowShared } from '../config'

export class GithubUploader extends EmoUploader {
  parms!: GithubParms
  constructor (githubParms: GithubParms) {
    super()
    this.parms = githubParms
  }

  async upload (file: File): Promise<string> {
    const currentApp = WindowShared.getApp()
    const activeFile = currentApp.workspace.getActiveFile()
    let filePath = ''
    // get activity file creatime
    let pathPre = this.parms.path
    if (this.parms.prefixPath && activeFile != null) {
      const date = new Date(activeFile.stat.ctime)
      pathPre = pathPre + date.toISOString() + '/'
    }
    if (this.parms.random) { // use random filename
      const startSuffix = file.name.lastIndexOf('.')
      filePath = pathPre + getRandomFileName()
      filePath += startSuffix > 0 ? file.name.substring(startSuffix) : '' // for no suffix files
    } else {
      filePath = pathPre + file.name // original filename
    }
    const jsonBody = {
      owner: this.parms.required.owner,
      repo: this.parms.required.repo,
      branch: this.parms.required.branch,
      path: filePath,
      message: this.parms.required.message,
      content: await getBase64(file)
    }
    const form = JSON.stringify(jsonBody)
    const req: RequestUrlParam = {
      url: `https://api.github.com/repos/${this.parms.required.owner}/${this.parms.required.repo}/contents/${filePath}`,
      method: 'PUT',
      headers: {
        Authorization: `token ${this.parms.required.token}`
      },
      body: form
    }

    return await new Promise((resolve, reject) => {
      request(req).then(() => {
        let markdownText: string
        console.log(this.parms.cdn)
        switch (this.parms.cdn) {
          case CDNprovider.jsdelivr:
            markdownText = `![gh](https://cdn.jsdelivr.net/gh/${this.parms.required.owner}/${this.parms.required.repo}@${this.parms.required.branch}/${filePath})`
            break
          case CDNprovider.statically:
            markdownText = `![gh](https://cdn.statically.io/gh/${this.parms.required.owner}/${this.parms.required.repo}/${this.parms.required.branch}/${filePath})`
            break
          case CDNprovider.raw:
            markdownText = `![gh](https://raw.githubusercontent.com/${this.parms.required.owner}/${this.parms.required.repo}/${this.parms.required.branch}/${filePath})`
            break
          default:
            // use raw
            markdownText = `![gh](https://raw.githubusercontent.com/${this.parms.required.owner}/${this.parms.required.repo}/${this.parms.required.branch}/${filePath})`
            break
        }
        resolve(markdownText)
      }).catch(err => {
        reject(err)
      })
    })
  }
}
