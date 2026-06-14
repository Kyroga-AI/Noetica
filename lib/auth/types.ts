export type ConnectorId = 'google' | 'github' | 'slack' | 'matrix' | 'linear' | 'notion'

export type ConnectorAuthStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ConnectorAuthState = {
  status: ConnectorAuthStatus
  accessToken?: string
  refreshToken?: string
  expiresAt?: number  // unix ms
  scope?: string
  error?: string
  connectedAt?: string
  userInfo?: {
    name?: string
    email?: string
    avatar?: string
    login?: string
  }
}

export type MatrixAuthState = ConnectorAuthState & {
  homeserver?: string
  userId?: string
  deviceId?: string
}

export type ConnectorAuthStore = {
  google?: ConnectorAuthState
  github?: ConnectorAuthState
  slack?: ConnectorAuthState
  matrix?: MatrixAuthState
  linear?: ConnectorAuthState
  notion?: ConnectorAuthState
}

export type OAuthCallbackPayload = {
  code: string
  state: string
  provider: ConnectorId
}
