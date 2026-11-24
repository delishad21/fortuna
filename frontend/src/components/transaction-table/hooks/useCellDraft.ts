import { useEffect, useRef, useState } from "react";

/**
 * The text of a cell that saves when it is left. A value arriving meanwhile doesn't replace
 * what is being typed, and text in a row that scrolls out of the rendered window is kept.
 */
export function useCellDraft(
  value: string,
  /** Returns false to refuse the text and show the saved value again. */
  onCommit: (draft: string) => void | false,
) {
  const [draft, setDraft] = useState(value);
  const typing = useRef(false);
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };

  useEffect(() => {
    if (!typing.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const { draft, value, onCommit } = latest.current;
    typing.current = false;
    if (draft !== value && onCommit(draft) === false) setDraft(value);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(
    () => () => {
      if (typing.current) commitRef.current();
    },
    [],
  );

  return {
    draft,
    setDraft: (next: string) => {
      typing.current = true;
      setDraft(next);
    },
    commit,
  };
}
