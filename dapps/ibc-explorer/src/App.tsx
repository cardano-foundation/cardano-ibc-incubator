import { ThemeProvider } from '@mui/material';
import { ApolloProvider } from '@apollo/client';

import './App.css';
import AppRouter from './router';
import { THEME } from './styles/theme';
import client from './apis/apollo';

function App() {
  return (
    <ThemeProvider theme={THEME}>
      <ApolloProvider client={client}>
        <AppRouter />
      </ApolloProvider>
    </ThemeProvider>
  );
}

export default App;
