import { Logger } from '@nestjs/common';
import axios from 'axios';

const axiosInstance = axios.create({
  responseType: 'json',
  timeout: 15 * 1000,
});

axiosInstance.interceptors.request.use(
  (config) => {
    // Do something before request is sent
    // eslint-disable-next-line no-param-reassign
    return config;
  },
  (error) =>
    // Do something with request error
    Promise.reject(error),
);

// Add a response interceptor
axiosInstance.interceptors.response.use(
  (response) => {
    // Any status code that lie within the range of 2xx cause this function to trigger
    // Do something with response data
    Logger.log('[callApi.res]', `[${JSON.stringify(response.data)}]`);

    return response.data;
  },
  (error) => {
    // Any status codes that falls outside the range of 2xx cause this function to trigger
    // Do something with response error
    const { config, response, message } = error;

    if (response && !response.error) {
      return response.data;
    }
    Logger.error('[callApi.res.error]', `[${config && config.source}]`, `[${config && config.id}]`, message);

    return Promise.reject(new Error(message || error));
  },
);

export default axiosInstance;
