/**
 * ocr — on-device text recognition. Fully local, no model download, no network.
 *   macOS: Apple Vision framework (VNRecognizeTextRequest), compiled once from Swift via swiftc.
 *   Linux: tesseract-ocr (install: apt install tesseract-ocr / dnf install tesseract / pacman -S tesseract).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

// ─── macOS: Vision framework via compiled Swift helper ────────────────────────

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

async function runOcrMacos(imagePath: string): Promise<string> {
  if (!(await ensureOcrBinary())) return 'OCR unavailable — could not compile the Vision helper (are the Xcode command-line tools installed? `xcode-select --install`).'
  try {
    const { stdout } = await execFileP(BIN, [imagePath], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout.trim() || '(no text detected in image)'
  } catch {
    return 'OCR failed — check that the image is a supported format (PNG/JPEG/TIFF).'
  }
}

// ─── Linux: tesseract-ocr ─────────────────────────────────────────────────────
// tesseract <image> stdout outputs recognized text to stdout (available since Tesseract 4.x).
// Install: apt install tesseract-ocr  /  dnf install tesseract  /  pacman -S tesseract

async function runOcrLinux(imagePath: string): Promise<string> {
  try {
    const { stdout } = await execFileP('tesseract', [imagePath, 'stdout', '-l', 'eng'], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout.trim() || '(no text detected in image)'
  } catch {
    return 'OCR unavailable on Linux — install tesseract-ocr (apt install tesseract-ocr / dnf install tesseract / pacman -S tesseract).'
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runOcr(imagePath: string): Promise<string> {
  if (!fs.existsSync(imagePath)) return `OCR error: no such image: ${imagePath}`
  if (process.platform === 'linux') return runOcrLinux(imagePath)
  return runOcrMacos(imagePath)
}
