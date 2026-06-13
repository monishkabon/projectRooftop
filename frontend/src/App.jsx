import { Routes, Route } from 'react-router-dom';
import TabNav from './components/TabNav';
import MilitaryOps from './pages/MilitaryOps';
import CivilianTraffic from './pages/CivilianTraffic';
import MyRadar from './pages/MyRadar';
import './App.css';

export default function App() {
  return (
    <div className="app-shell">
      <div className="app-shell__container">
        <TabNav />
        <Routes>
          <Route path="/" element={<MilitaryOps />} />
          <Route path="/civilian" element={<CivilianTraffic />} />
          <Route path="/radar" element={<MyRadar />} />
        </Routes>
      </div>
    </div>
  );
}
