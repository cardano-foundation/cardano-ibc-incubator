import { ThemeProvider } from '@mui/material';
import './App.css';
import AppRouter from './router';
import { THEME } from './styles/theme';

function App() {
  return (
    <ThemeProvider theme={THEME}>
      <AppRouter />
    </ThemeProvider>
  );
}

export default App;
