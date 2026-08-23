import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(React.createElement(React.StrictMode, null, React.createElement(App)));
