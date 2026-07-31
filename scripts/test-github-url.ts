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
