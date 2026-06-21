/**
 * ocr — on-device text recognition via the macOS Vision framework. Fully local, no model
 * download, no network. The Swift helper (mirror of scripts/ocr.swift) is embedded here,
 * written to ~/.noetica/bin and compiled once with swiftc (works in the bundled binary too).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const BIN_DIR = path.join(os.homedir(), '.noetica', 'bin')
const SRC = path.join(BIN_DIR, 'ocr.swift')
const BIN = path.join(BIN_DIR, 'noetica-ocr')

const OCR_SWIFT = `import Foundation
import Vision
import AppKit
guard CommandLine.arguments.count > 1 else { exit(2) }
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot load image\\n".data(using: .utf8)!); exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    print(lines.joined(separator: "\\n"))
} catch { FileHandle.standardError.write("ocr failed\\n".data(using: .utf8)!); exit(1) }
`

let compiling: Promise<boolean> | null = null
async function ensureOcrBinary(): Promise<boolean> {
  if (fs.existsSync(BIN)) return true
  if (compiling) return compiling
  compiling = (async () => {
    try {
      fs.mkdirSync(BIN_DIR, { recursive: true })
      fs.writeFileSync(SRC, OCR_SWIFT)
      await execFileP('swiftc', ['-O', SRC, '-o', BIN], { timeout: 90_000 })
      return fs.existsSync(BIN)
    } catch { return false } finally { compiling = null }
  })()
  return compiling
}

export async function runOcr(imagePath: string): Promise<string> {
  if (!fs.existsSync(imagePath)) return `OCR error: no such image: ${imagePath}`
  if (!(await ensureOcrBinary())) return 'OCR unavailable — could not compile the Vision helper (are the Xcode command-line tools installed? `xcode-select --install`).'
  try {
    const { stdout } = await execFileP(BIN, [imagePath], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout.trim() || '(no text detected in image)'
  } catch (e) {
    return `OCR failed: ${e instanceof Error ? e.message : String(e)}`
  }
}
