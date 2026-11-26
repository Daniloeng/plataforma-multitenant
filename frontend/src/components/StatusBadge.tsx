import type { PlatformStatus } from '../api/status';
import { PLATFORM_STATUS_LABEL } from '../utils/format';

export function StatusBadge({ status }: { status: PlatformStatus }) {
  return (
    <span className={`badge badge--${status.toLowerCase()}`} data-testid="overall-status">
      <span className="dot" aria-hidden="true" />
      {PLATFORM_STATUS_LABEL[status]}
    </span>
  );
}
