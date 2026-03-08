import axios from 'axios';
import camelCase from 'camelcase-keys';
import { GATEWAY_TX_BUILDER_ENDPOINT } from '@/configs/runtime';

const axiosInstance = axios.create({
  baseURL: GATEWAY_TX_BUILDER_ENDPOINT,
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
