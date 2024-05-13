const ogmiosWsp = async (ogmiosUrl: string, methodname: string, args: unknown) => {
  const client = new WebSocket(ogmiosUrl);
  await new Promise((res) => {
    client.addEventListener('open', () => res(1), {
      once: true,
    });
  });
  client.send(
    JSON.stringify({
      type: 'jsonwsp/request',
      version: '1.0',
      servicename: 'ogmios',
      methodname,
      args,
    }),
  );
  return client;
};

const querySystemStart = async (ogmiosUrl: string) => {
  const client = await ogmiosWsp(ogmiosUrl, 'Query', {
    query: 'systemStart',
  });
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

const getNanoseconds = (d) => {
  let nanoSeconds = d.split('.')[1].split('Z')[0];
  nanoSeconds = Number(nanoSeconds).toString();
  return parseInt(nanoSeconds);
};

export { querySystemStart, getNanoseconds };
