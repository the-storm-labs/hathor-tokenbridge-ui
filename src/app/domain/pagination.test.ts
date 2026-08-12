import { describe, it, expect } from 'vitest'
import { paginate } from './pagination'

const items = Array.from({ length: 13 }, (_, i) => i)

describe('paginate', () => {
  it('reports no previous page on the first page', () => {
    const page = paginate(items, 1, 6)
    expect(page.pre_page).toBeNull()
    expect(page.next_page).toBe(2)
    expect(page.data).toEqual([0, 1, 2, 3, 4, 5])
    expect(page.total).toBe(13)
    expect(page.total_pages).toBe(3)
  })

  it('reports both neighbours in the middle', () => {
    const page = paginate(items, 2, 6)
    expect(page.pre_page).toBe(1)
    expect(page.next_page).toBe(3)
    expect(page.data).toEqual([6, 7, 8, 9, 10, 11])
  })

  it('reports no next page on the last, partial page', () => {
    const page = paginate(items, 3, 6)
    expect(page.pre_page).toBe(2)
    expect(page.next_page).toBeNull()
    expect(page.data).toEqual([12])
  })

  it('handles an exact multiple', () => {
    const page = paginate(Array.from({ length: 12 }, (_, i) => i), 2, 6)
    expect(page.total_pages).toBe(2)
    expect(page.next_page).toBeNull()
    expect(page.data).toHaveLength(6)
  })

  it('handles an empty list', () => {
    const page = paginate([], 1, 6)
    expect(page.data).toEqual([])
    expect(page.total).toBe(0)
    expect(page.total_pages).toBe(0)
    expect(page.pre_page).toBeNull()
    expect(page.next_page).toBeNull()
  })

  it('returns no data past the end', () => {
    expect(paginate(items, 9, 6).data).toEqual([])
  })

  it('defaults to page 1 with 5 per page', () => {
    const page = paginate(items)
    expect(page.page).toBe(1)
    expect(page.per_page).toBe(5)
    expect(page.data).toHaveLength(5)
  })
})
