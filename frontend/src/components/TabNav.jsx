import { NavLink } from 'react-router-dom';
import './TabNav.css';

const tabs = [
  { id: '01', label: 'MILITARY_OPS', path: '/' },
  { id: '02', label: 'CIVILIAN_TRAFFIC', path: '/civilian' },
  { id: '03', label: 'MY_RADAR', path: '/radar' },
];

export default function TabNav() {
  return (
    <nav className="tab-nav" aria-label="Main navigation">
      {tabs.map((tab) => (
        <NavLink
          key={tab.id}
          to={tab.path}
          end={tab.path === '/'}
          className={({ isActive }) =>
            `tab-nav__link text-headline-sm ${isActive ? 'tab-nav__link--active' : ''}`
          }
        >
          [ {tab.id}&nbsp;&nbsp;{tab.label} ]
        </NavLink>
      ))}
    </nav>
  );
}
