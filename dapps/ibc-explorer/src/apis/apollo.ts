import { ApolloClient, InMemoryCache } from '@apollo/client';

const client = new ApolloClient({
  uri: process.env.REACT_APP_API_DOMAIN,
  cache: new InMemoryCache(),
});

export default client;
