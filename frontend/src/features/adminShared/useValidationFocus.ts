import { useEffect, useRef } from 'react';

// A new validation result may request focus once. Editing errors never does.
export function useValidationFocus(revision: number, fieldId: string | undefined) {
  const handled = useRef(revision);
  useEffect(() => {
    if (handled.current === revision) return;
    handled.current = revision;
    if (fieldId) document.getElementById(fieldId)?.focus();
  }, [revision, fieldId]);
}
