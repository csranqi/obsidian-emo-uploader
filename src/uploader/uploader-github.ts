import type { RequestUrlParam } from 'obsidian'
import { request } from 'obsidian'
import type { GithubParms } from '../parms/parms-github'
import { CDNprovider } from '../parms/parms-github'
import { getBase64, getRandomFileName } from '../utils/file-helper'
import { EmoUploader } from '../base/emo-uploader'
import { WindowShared } from '../config'
import { generateMdId } from '../utils/github-url'

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
      const mdId = await this.getOrCreateMdId()
      pathPre = pathPre + mdId + '/'
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
}
