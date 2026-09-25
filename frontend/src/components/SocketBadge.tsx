import { useEffect, useState } from 'react';
import { socketClient, type SocketStatus } from '../socket/socket-client';
import { TESTIDS } from '../testids';

export function SocketBadge() {
  const [status, setStatus] = useState<SocketStatus>(socketClient.status);
  useEffect(() => socketClient.onStatus(setStatus), []);
  return (
    <span className={`badge badge-${status}`} data-testid={TESTIDS.socketStatus} title="Socket connection">
      socket {status}
    </span>
  );
}
