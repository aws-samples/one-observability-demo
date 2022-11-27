import * as React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Amplify, API } from 'aws-amplify';
import awsExports from './aws-exports';
import {
  BrowserRouter as Router,
} from "react-router-dom";

Amplify.configure(awsExports);

const rootElement = document.getElementById('root');
const root = createRoot(rootElement);

Amplify.configure({
  API: {
    endpoints: [
      {
        name: "voteapi",
        endpoint: $ECS_API_URL
      }
    ]
  },
  ...awsExports
})
API.configure();

root.render(
  <Router>
    <App />
  </Router>
);


