/**
 * Slice a list into a page. Moved out of js/localStorage.js, which despite its
 * name held async and pagination helpers rather than storage code.
 */

export interface Page<T> {
  readonly page: number
  readonly per_page: number
  /** Previous page number, or null on the first page. */
  readonly pre_page: number | null
  /** Next page number, or null on the last page. */
  readonly next_page: number | null
  readonly total: number
  readonly total_pages: number
  readonly data: readonly T[]
}

/**
 * Field names are snake_case to match the object the render code already reads.
 * They get normalised when the history component takes over the markup.
 */
export function paginate<T>(items: readonly T[], page = 1, perPage = 5): Page<T> {
  const offset = (page - 1) * perPage
  const data = items.slice(offset).slice(0, perPage)
  const totalPages = Math.ceil(items.length / perPage)

  return {
    page,
    per_page: perPage,
    // `page - 1 ? ... : null` in the original: page 1 yields 0, which is falsy,
    // so the first page correctly reports no previous page.
    pre_page: page - 1 ? page - 1 : null,
    next_page: totalPages > page ? page + 1 : null,
    total: items.length,
    total_pages: totalPages,
    data,
  }
}
