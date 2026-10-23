import { createRoot } from 'react-dom/client';
import './fonts.css';
import './tokens.css';
import './main.css';
import { Shell } from './shell/Shell.tsx';
import { createViewStore } from './view.ts';

const root = document.getElementById('root');
if (root) createRoot(root).render(<Shell store={createViewStore(window)} />);
