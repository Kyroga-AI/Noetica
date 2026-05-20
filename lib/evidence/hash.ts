import { createHash } from 'crypto'

export type EvidencePayload = string | number | boolean | null | EvidencePayload[] | { [key: string]: EvidencePayload }

export function canonicalJson(value: EvidencePayload): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function evidenceHash(payload: EvidencePayload): string {
  return sha256Hex(canonicalJson(payload))
}
