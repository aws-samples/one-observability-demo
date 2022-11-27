import React, { useState, createContext } from "react";
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import theme from './utils/theme';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Colors from "./views/Colors";
import Choice from "./views/Choice";

export const VoteStatusContext = createContext();

export default function App() {

  const [voted, setVoted] = useState(false);
  const [color, setColor] = useState(undefined);
  const [colorCode, setColorCode] = useState(undefined);

  return (
    <VoteStatusContext.Provider value={{ voted, setVoted, color, setColor, colorCode, setColorCode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Container maxWidth="md">
          <Box sx={{ my: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom>
              re:Invent COP301 - Observability the Open Source Way
            </Typography>
            {!voted &&
              <Colors />
            }
            {voted &&
              < Choice />
            }
          </Box>
        </Container>
      </ThemeProvider>
    </VoteStatusContext.Provider>
  );
}
