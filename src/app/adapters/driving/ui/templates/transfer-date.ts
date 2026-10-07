/**
 * The Date cell both history tables show: when the transfer was made.
 *
 * In the viewer's locale and time zone. Records written before dates were kept
 * carry none, and an unparseable one is no better: both show a dash rather
 * than "Invalid Date".
 */

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export type DateFormatter = (date: Date) => string

export function transferDate(iso: string | null | undefined, format?: DateFormatter): string {
  const date = iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return '—'
  return (format ?? ((d) => DATE_FORMAT.format(d)))(date)
}
