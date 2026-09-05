export function lockDocumentScroll(document: Document): () => void {
  const elements = [document.documentElement, document.body];
  const previous = elements.map(element => element.style.overflow);

  for (const element of elements) element.style.overflow = 'hidden';

  return () => {
    elements.forEach((element, index) => {
      // Do not undo a scroll policy installed by another owner while locked.
      if (element.style.overflow === 'hidden') element.style.overflow = previous[index];
    });
  };
}
