const ogmiosWsp = async (ogmiosUrl: string, methodname: string, args: unknown) => {
  const client = new WebSocket(ogmiosUrl);
  await new Promise((res) => {
    client.addEventListener('open', () => res(1), {
      once: true,
    });
  });
  client.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method: methodname,
      params: args,
    }),
  );
  return client;
};

const querySystemStart = async (ogmiosUrl: string) => {
  const client = await ogmiosWsp(ogmiosUrl, 'queryNetwork/startTime', {});
  const systemStart = await new Promise<string>((res, rej) => {
    client.addEventListener(
      'message',
      (msg: MessageEvent<string>) => {
        try {
          const { result } = JSON.parse(msg.data);
          res(result);
          client.close();
        } catch (e) {
          rej(e);
        }
      },
      {
        once: true,
      },
    );
  });
  const parsedSystemTime = Date.parse(systemStart);

  return parsedSystemTime;
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export { querySystemStart, sleep };
