// Meta / open-weight local models run through the local Ollama runtime.
// The real streaming implementation lives in ./ollama; this module re-exports it
// under the provider's canonical name so the chat route can dispatch on provider.
export { streamOllama as streamMeta, callOllama as callMeta } from './ollama'
