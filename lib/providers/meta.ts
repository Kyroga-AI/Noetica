export async function callMeta(): Promise<never> {
  throw new Error('Meta/local provider is a post-M1 implementation target routed through SourceOS.')
}
