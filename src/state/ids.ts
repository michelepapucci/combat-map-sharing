/** Random unique id (UUID v4). Available in secure contexts: https (GitHub Pages) and localhost. */
export function newId(): string {
  return crypto.randomUUID()
}
