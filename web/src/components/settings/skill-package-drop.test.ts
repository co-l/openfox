import { describe, expect, it } from 'vitest'
import { packageFromFileList } from './skill-package-drop'

function packageFile(path: string, content: string): File {
  const file = new File([content], path.split('/').at(-1)!)
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

describe('packageFromFileList', () => {
  it('keeps nested files relative to one portable package root', () => {
    const result = packageFromFileList([
      packageFile('image-tools/SKILL.md', 'skill'),
      packageFile('image-tools/assets/template.txt', 'asset'),
    ])

    expect(result.packageName).toBe('image-tools')
    expect(result.files.map((file) => file.path)).toEqual(['SKILL.md', 'assets/template.txt'])
  })
})
