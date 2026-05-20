export type SteeringStatus = 'applied' | 'not_configured' | 'noop'

export interface SteeringConfig {
  feature_id: string
  layer: string
  strength: number
  preset?: string
}

export interface SteeringResult {
  status: SteeringStatus
  baseline: string
  steered: string
  diff_summary: string
  feature_id: string
  layer: string
  strength: number
}
