// rpc-utils.ts
async function callJsonRpcMethod<T>(url: string, method: string, params: any[] = [], id: number = 1): Promise<T> {
  const payload = {
    jsonrpc: '2.0',
    method,
    params,
    id,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.result as T;
  } catch (error) {
    console.error('Error making JSON-RPC call:', error);
    throw error;
  }
}

export { callJsonRpcMethod };
