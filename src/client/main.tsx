import { createRoot } from 'react-dom/client';
import './fonts.css';
import './tokens.css';
import './main.css';

// M1 ships an empty client. The shell (sidebar, dock, views) arrives in M2.
function App() {
  return (
    <main className="foundation">
      <h1>ECHO</h1>
      <p>Foundation build. The player arrives in a later milestone.</p>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
