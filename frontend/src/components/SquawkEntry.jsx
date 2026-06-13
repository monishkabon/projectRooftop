import { useState, useEffect } from 'react';
import './SquawkEntry.css';

export default function SquawkEntry({
  id,
  squawkCode,
  callsign,
  type,
  squawkTime,
  altitude,
  signalStrength,
  heading,
  latLong,
  status,
  detectedAt,
}) {
  const [expanded, setExpanded] = useState(true);
  const [locationName, setLocationName] = useState('ACQUIRING...');

  useEffect(() => {
    if (!expanded || !latLong || latLong === 'N/A') return;

    let isMounted = true;
    
    const fetchLocation = async () => {
      try {
        const match = latLong.match(/([\d.]+)° ([NS]), ([\d.]+)° ([EW])/);
        if (!match) {
          if (isMounted) setLocationName('UNKNOWN');
          return;
        }
        
        const lat = match[2] === 'S' ? -parseFloat(match[1]) : parseFloat(match[1]);
        const lon = match[4] === 'W' ? -parseFloat(match[3]) : parseFloat(match[3]);

        const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        
        const locParts = [data.city || data.locality, data.principalSubdivision, data.countryCode].filter(Boolean);
        if (isMounted) {
          setLocationName(locParts.length > 0 ? locParts.join(', ').toUpperCase() : 'UNKNOWN');
        }
      } catch (err) {
        if (isMounted) setLocationName('UNKNOWN');
      }
    };

    fetchLocation();
    
    return () => { isMounted = false; };
  }, [expanded, latLong]);

  const formattedDate = detectedAt
    ? new Date(detectedAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      })
    : null;

  return (
    <div className={`squawk-entry ${expanded ? 'squawk-entry--expanded' : ''}`}>
      {/* Header Row */}
      <button
        className="squawk-entry__header text-body-lg"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="material-symbols-outlined squawk-entry__arrow">
          play_arrow
        </span>
        <div className="squawk-entry__info">
          <span className="squawk-entry__code">[{squawkCode}]</span>
          <span className="squawk-entry__callsign">CALLSIGN: {callsign}</span>
          <span className="squawk-entry__type">// TYPE: {type}</span>
        </div>
        <span className="material-symbols-outlined squawk-entry__chevron">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="squawk-entry__details text-code-sm">
          {formattedDate && (
            <div className="squawk-entry__row">
              <span>DETECTED: {formattedDate}</span>
            </div>
          )}
          <div className="squawk-entry__row">
            <span>SQUAWK_TIME: {squawkTime || (formattedDate ? formattedDate.split(', ')[1] : 'N/A')}</span>
          </div>
          <div className="squawk-entry__row">
            <span>ALT: {altitude}</span>
            <span>SIGNAL_STRENGTH: {signalStrength}</span>
          </div>
          <div className="squawk-entry__row" style={{ alignItems: 'flex-start' }}>
            <span>HDG: {heading}</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }}>
              <span>LAT/LONG: {latLong}</span>
              <span style={{ color: 'rgba(51, 255, 51, 0.6)' }}>LOCATION: {latLong !== 'N/A' ? locationName : 'N/A'}</span>
            </div>
          </div>
          <div className="squawk-entry__status">STATUS: {status}</div>
          {id && (
            <a
              className="squawk-entry__track-btn"
              href={`https://globe.adsbexchange.com/?icao=${id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
              TRACK_ON_ADSBX // {id.toUpperCase()}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
