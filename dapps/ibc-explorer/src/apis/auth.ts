import api from './api';

const login = async (email: string, password: string) => {
  const loginInfo = await api({
    method: 'POST',
    url: '/auths/login',
    data: { email, password },
  });

  return loginInfo;
};

export { login };
