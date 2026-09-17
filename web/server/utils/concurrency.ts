export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (_item: T, _index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1))
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const run = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await task(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()))
  return results
}
