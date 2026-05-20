export async function callGoogle(): Promise<never> {
  throw new Error('Google provider is a post-M1 implementation target.')
}
