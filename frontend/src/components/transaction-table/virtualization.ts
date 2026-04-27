export const TABLE_PREPARING_THRESHOLD = 200;

export function shouldShowTablePreparingState(
  rowCount: number,
  isReady: boolean,
) {
  return rowCount >= TABLE_PREPARING_THRESHOLD && !isReady;
}
