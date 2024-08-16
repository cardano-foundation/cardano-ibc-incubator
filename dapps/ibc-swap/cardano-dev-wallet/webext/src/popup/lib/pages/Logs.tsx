import { useEffect, useState } from "preact/hooks";

interface Log {
  id: number;
  log: string;
}

export default function Page() {
  const [logsAvailable, setLogsAvailable] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);

  const onMessage = (message: any) => {
    if (message.method == "popup/log") {
      let id = message.id as number;
      let log = message.log as string;
      pushLog({ id, log });
    }
  };

  const onConnect = (port: chrome.runtime.Port) => {
    port.onMessage.addListener(onMessage);
  };

  useEffect(() => {
    if (window.chrome?.runtime?.onConnect == null) return;
    chrome.runtime.onConnect.addListener(onConnect);
    setLogsAvailable(true);
    return () => {
      chrome.runtime.onConnect.removeListener(onConnect);
    };
  });

  const pushLog = ({ id, log }: { id: number; log: string }) => {
    setLogs((logs) => [...logs, { id, log }]);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  let logsGrouped = [];
  let prevGroup: { id: number; logs: string[] } | null = null;
  for (let { id, log } of logs) {
    if (prevGroup == null || prevGroup.id != id) {
      prevGroup = { id, logs: [log] };
      logsGrouped.push(prevGroup);
    } else {
      prevGroup.logs.push(log);
    }
  }

  return (
    <section class="column gap-xl">
      {/* Header */}
      <div class="row align-baseline">
        <h2 class="L3">Logs</h2>
        <button class="button" onClick={clearLogs}>
          Clear <span class="icon -close" />
        </button>
      </div>

      {/* Contents */}
      <div class="gap-l">
        {logsGrouped.map(({ id, logs }) => {
          // show id only on the first log in a group
          let displayId = true;
          return (
            <div class="gap-s">
              {logs.map((log) => {
                let res = (
                  <div class="mono pre-wrap padx-s">
                    {displayId && id + ": "}
                    {log}
                  </div>
                );
                displayId = false;
                return res;
              })}
            </div>
          );
        })}
        {!logsAvailable &&
          "Unable to connect to the extension runtime. Logs not available."}
        {logsAvailable && logs.length == 0 && "Empty."}
      </div>
    </section>
  );
}
