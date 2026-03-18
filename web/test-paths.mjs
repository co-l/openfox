import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('__filename:', __filename)
console.log('__dirname:', __dirname)
console.log('index.html:', path.join(__dirname, 'index.html'))
console.log('index.html exists:', fs.existsSync(path.join(__dirname, 'index.html')))
console.log('src:', path.join(__dirname, 'src'))
console.log('src exists:', fs.existsSync(path.join(__dirname, 'src')))
