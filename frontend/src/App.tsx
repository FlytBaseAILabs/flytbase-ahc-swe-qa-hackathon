import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CockpitPage } from './pages/CockpitPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CockpitPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
