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
