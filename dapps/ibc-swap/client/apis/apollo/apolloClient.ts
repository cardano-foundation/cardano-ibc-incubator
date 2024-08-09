import { ApolloClient, InMemoryCache } from '@apollo/client';

const client = new ApolloClient({
  uri: process.env.NEXT_PUBLIC_GRAPHQL_URL, // Thay bằng URL của GraphQL server của bạn
  cache: new InMemoryCache(),
});

export default client;
