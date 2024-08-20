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

const genesisConfiguration = async (ogmiosUrl: string) => {
  const client = await ogmiosWsp(ogmiosUrl, 'queryNetwork/genesisConfiguration', { era: 'shelley' });
  const genesisConfig = await new Promise<any>((res, rej) => {
    client.addEventListener(
      'message',
      (msg: MessageEvent) => {
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

  return genesisConfig;
};

const blockHeight = async (ogmiosUrl: string) => {
  const client = await ogmiosWsp(ogmiosUrl, 'queryNetwork/blockHeight', {});
  const blockHeightRs = await new Promise((res, rej) => {
    client.addEventListener(
      'message',
      (msg: MessageEvent) => {
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

  return blockHeightRs;
};

const systemStart = async (ogmiosUrl: string) => {
  const client = await ogmiosWsp(ogmiosUrl, 'queryNetwork/startTime', {});
  const sysStart = await new Promise<string>((res, rej) => {
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
  const parsedSystemTime = Date.parse(sysStart);

  return parsedSystemTime;
};

export { genesisConfiguration, blockHeight, systemStart };
