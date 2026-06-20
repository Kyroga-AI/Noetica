import type { ChatMessage } from '@/lib/types/message'

// New chats start empty — the chat surface renders a clean hero (greeting + quick
// actions) for the empty state instead of a seeded "scaffold online" system note.
export const initialMessages: ChatMessage[] = []
