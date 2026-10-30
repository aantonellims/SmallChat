/** URL of the bundled checklist page, pointing it at the agent API when one is configured. */
export function checklistSrc(apiBase: string, documentBase: string = document.baseURI): string {
  const url = new URL('checklist/index.html', documentBase);
  const base = apiBase.trim().replace(/\/$/, '');
  if (base) url.searchParams.set('api', base);
  return url.toString();
}
