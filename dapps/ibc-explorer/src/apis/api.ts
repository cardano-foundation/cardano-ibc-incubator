import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import camelCase from 'camelcase-keys';
import { API_URL } from '@src/configs';

const axiosClient = axios.create({
  baseURL: `${API_URL}/api/v1`,
  responseType: 'json',
  timeout: 15 * 1000,
});

axiosClient.interceptors.request.use(
  (config: AxiosRequestConfig) => config,
  (error: any) => Promise.reject(error),
);

axiosClient.interceptors.response.use(
  (response: AxiosResponse) => camelCase(response.data, { deep: true }),
  (error: any) => Promise.reject(error),
);

export default axiosClient;
