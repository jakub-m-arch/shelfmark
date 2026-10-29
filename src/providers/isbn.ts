/** Returns the normalized ISBN if the query looks like an ISBN-10 or ISBN-13. */
export function asIsbn(query: string): string | undefined {
  const s = query.replace(/[\s-]/g, "").toUpperCase();
  return /^(97[89]\d{10}|\d{9}[\dX])$/.test(s) ? s : undefined;
}
