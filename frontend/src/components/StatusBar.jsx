import './StatusBar.css';

export default function StatusBar({ rightSlot }) {
  return (
    <div className="status-bar">
      <div className="status-bar__left text-code-sm">
        [SYSTEM_STATUS: LIVE_FEED // SOURCE: MLAT_NETWORK]{' '}
        <span className="blink">█</span>
      </div>
      {rightSlot && (
        <div className="status-bar__right">
          {rightSlot}
        </div>
      )}
    </div>
  );
}
