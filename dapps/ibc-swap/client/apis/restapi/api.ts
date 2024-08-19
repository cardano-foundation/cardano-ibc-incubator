import axios from 'axios';
import camelCase from 'camelcase-keys';

const axiosInstance = axios.create({
  baseURL: `${process.env.NEXT_PUBLIC_GATEWAY_TX_BUILDER_ENDPOINT}`,
  responseType: 'json',
  timeout: 30 * 1000,
  transformResponse: [
    (data) => {
      if (typeof data === 'string')
        return camelCase(JSON.parse(data), {
          deep: true,
        });
      return camelCase(data, { deep: true });
    },
  ],
});

export default axiosInstance;
