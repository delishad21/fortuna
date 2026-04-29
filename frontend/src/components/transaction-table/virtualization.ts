export const TABLE_PREPARING_THRESHOLD = 200;

export function shouldShowTablePreparingState(
  rowCount: number,
  isReady: boolean,
) {
  return rowCount >= TABLE_PREPARING_THRESHOLD && !isReady;
}

interface TextareaSizeTarget {
  scrollHeight: number;
  style: {
    height: string;
  };
}

export function resizeTextareaToContent(textarea: TextareaSizeTarget) {
  const nextHeight = `${textarea.scrollHeight}px`;
  if (textarea.style.height === nextHeight) return false;

  textarea.style.height = "auto";
  textarea.style.height = nextHeight;
  return true;
}
