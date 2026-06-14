import { useRef, useEffect, useState, useCallback } from 'react';
import StatusBar from '../components/StatusBar';
import CornerBrackets from '../components/CornerBrackets';
import './MyRadar.css';

const API_BASE = '';
const POLL_INTERVAL = 5000;

/* ---------- Dynamic Range Tuning ---------- */
const INITIAL_RADIUS = 25;   // start at 25nm
const MIN_RADIUS     = 5;    // never go below 5nm
const MAX_RADIUS     = 250;  // never exceed 250nm (API limit)
const MAX_BLIPS      = 25;   // shrink if more than this many visible contacts
const IDEAL_MIN      = 2;    // grow if fewer than this many contacts

/* ---------- Geo Helpers ---------- */

/**
 * Convert a blip's lat/lon to percentage-based CSS position
 * relative to the radar scope center (user's location).
 * Returns { top: '...%', left: '...%' }
 */
function latLonToScopePosition(blipLat, blipLon, centerLat, centerLon, radiusNm) {
  if (blipLat == null || blipLon == null) return null;

  // 1 degree latitude ≈ 60 nautical miles
  const NM_PER_DEG_LAT = 60;
  const NM_PER_DEG_LON = 60 * Math.cos((centerLat * Math.PI) / 180);

  const dx = (blipLon - centerLon) * NM_PER_DEG_LON; // east is positive
  const dy = (blipLat - centerLat) * NM_PER_DEG_LAT; // north is positive

  // Normalise to -1..1 within the scope radius, then map to 0%..100%
  // CSS: top=0 is north, left=0 is west
  const scopeX = (dx / radiusNm) * 0.45 + 0.5; // 0.45 = scope visual radius
  const scopeY = (-dy / radiusNm) * 0.45 + 0.5; // invert Y for CSS

  // Clamp to scope bounds (keep 5% margin so labels don't clip)
  if (scopeX < 0.03 || scopeX > 0.97 || scopeY < 0.03 || scopeY > 0.97) return null;

  return {
    left: `${(scopeX * 100).toFixed(1)}%`,
    top: `${(scopeY * 100).toFixed(1)}%`,
  };
}

/* ---------- GLSL Shader Sources ---------- */
const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

varying vec2 v_texCoord;

#define PI 3.14159265359

void main() {
    vec2 uv = v_texCoord;
    float vmin = min(u_resolution.x, u_resolution.y);
    float targetSize = min(vmin * 0.9, 800.0);
    vec2 p = (uv - 0.5) * u_resolution * (0.9 / targetSize);

    float dist = length(p);
    float angle = atan(p.y, p.x);

    float normAngle = mod(angle / (2.0 * PI) + 0.25, 1.0);

    float sweepSpeed = 0.5;
    float currentSweepPos = mod(u_time * sweepSpeed, 1.0);

    float diff = mod(currentSweepPos - normAngle, 1.0);

    float trail = exp(-diff * 8.0);

    vec3 terminalGreen = vec3(0.2, 1.0, 0.2);
    vec3 background = vec3(0.0196, 0.0784, 0.0196);
    vec3 gridColor = terminalGreen * 0.3;
    vec3 emergencyRed = vec3(1.0, 0.26, 0.26);

    vec3 color = background;

    float scopeRadius = 0.45;
    float scopeRing = smoothstep(0.005, 0.0, abs(dist - scopeRadius));
    color += scopeRing * terminalGreen;

    if (dist < scopeRadius) {
        float ring1 = smoothstep(0.002, 0.0, abs(dist - 0.15));
        float ring2 = smoothstep(0.002, 0.0, abs(dist - 0.30));
        color += (ring1 + ring2) * gridColor;

        float crosshair = smoothstep(0.001, 0.0, abs(p.x)) + smoothstep(0.001, 0.0, abs(p.y));
        color += crosshair * gridColor * 0.5;

        color += trail * terminalGreen * 0.6;

        float leadingEdge = smoothstep(0.003, 0.0, diff);
        color += leadingEdge * terminalGreen;
    }

    gl_FragColor = vec4(color, 1.0);
}`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function initWebGL(canvas) {
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return null;

  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  const pos = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

  return {
    gl,
    uTime: gl.getUniformLocation(program, 'u_time'),
    uRes: gl.getUniformLocation(program, 'u_resolution'),
    uMouse: gl.getUniformLocation(program, 'u_mouse'),
  };
}

/* ---------- Blip Label Component ---------- */
function BlipLabel({ id, aircraft, category, isEmergency, position, onClick }) {
  if (!position) return null;
  const style = { position: 'absolute', ...position };

  if (isEmergency) {
    return (
      <div 
        className="blip-label blip-label--emergency blip-label--clickable" 
        style={style}
        onClick={() => onClick(id)}
      >
        <div className="blip-dot blip-dot--emergency" />
        <div className="blip-tag blip-tag--emergency text-code-sm text-glow-error">
          &gt;&gt;&gt; EMERGENCY &lt;&lt;&lt;<br />
          [{aircraft}] // ({category})
        </div>
      </div>
    );
  }

  return (
    <div 
      className="blip-label blip-label--clickable" 
      style={style}
      onClick={() => onClick(id)}
    >
      <div className="blip-dot" />
      <div className="blip-tag text-code-sm glow-text">
        [{aircraft}]<br />
        ({category})
      </div>
    </div>
  );
}

/* ---------- MyRadar Page ---------- */
export default function MyRadar() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  // Geolocation state
  const [userLocation, setUserLocation] = useState(null);
  const [geoError, setGeoError] = useState(null);

  // Radar data state
  const [radarBlips, setRadarBlips] = useState([]);
  const [radarLoading, setRadarLoading] = useState(true);
  const [radius, setRadius] = useState(INITIAL_RADIUS);
  const radiusRef = useRef(INITIAL_RADIUS); // ref for use inside callbacks

  // Flight detail popup state
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [flightDetails, setFlightDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /* ---------- Get user geolocation ---------- */
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported');
      setRadarLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      (err) => {
        console.warn('[RADAR] Geolocation denied or failed:', err.message);
        setGeoError('Location required for radar data');
        setRadarLoading(false);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  /* ---------- Adaptive range logic ---------- */
  const adjustRadius = useCallback((contactCount) => {
    let current = radiusRef.current;
    // Step size scales with current radius (bigger jumps at larger ranges)
    const step = Math.max(5, Math.round(current * 0.3));

    if (contactCount > MAX_BLIPS) {
      // Too cluttered — shrink
      current = Math.max(MIN_RADIUS, current - step);
    } else if (contactCount < IDEAL_MIN) {
      // Empty scope — grow
      current = Math.min(MAX_RADIUS, current + step);
    }
    // else: count is between IDEAL_MIN..MAX_BLIPS — hold steady

    if (current !== radiusRef.current) {
      console.log(`[RADAR] Range adjusted: ${radiusRef.current}nm → ${current}nm (${contactCount} contacts)`);
      radiusRef.current = current;
      setRadius(current);
    }
  }, []);

  /* ---------- Fetch radar data ---------- */
  const fetchRadar = useCallback(async () => {
    if (!userLocation) return;
    try {
      const { lat, lon } = userLocation;
      const r = radiusRef.current;
      const res = await fetch(`${API_BASE}/api/radar/${lat}/${lon}/${r}`);
      if (!res.ok) throw new Error('Radar uplink failed');
      const data = await res.json();
      const blips = data.data || [];
      setRadarBlips(blips);

      // After receiving data, check if range needs adjusting
      adjustRadius(blips.length);
    } catch (err) {
      console.error('[RADAR] Fetch error:', err.message);
    } finally {
      setRadarLoading(false);
    }
  }, [userLocation, adjustRadius]);

  useEffect(() => {
    if (!userLocation) return;
    fetchRadar();
    const timer = setInterval(fetchRadar, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [userLocation, fetchRadar, radius]);

  /* ---------- Flight detail click handler ---------- */
  const handleBlipClick = async (id) => {
    setSelectedFlightId(id);
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/flights/${id}`);
      if (!response.ok) throw new Error('Failed to fetch flight details');
      const data = await response.json();
      setFlightDetails(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const closePopup = () => {
    setSelectedFlightId(null);
    setFlightDetails(null);
  };

  /* ---------- WebGL setup ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function syncSize() {
      const w = canvas.clientWidth || 1280;
      const h = canvas.clientHeight || 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(canvas);
    syncSize();

    const ctx = initWebGL(canvas);
    if (!ctx) return;

    const { gl, uTime, uRes, uMouse } = ctx;

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        mouseRef.current.x =
          ((event.clientX - rect.left) / rect.width) * canvas.width;
        mouseRef.current.y =
          (1.0 - (event.clientY - rect.top) / rect.height) * canvas.height;
      }
    };
    window.addEventListener('mousemove', handleMouseMove);

    let raf;
    function render(t) {
      syncSize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouseRef.current.x, mouseRef.current.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    }
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  /* ---------- Compute positioned blips ---------- */
  const positionedBlips = userLocation
    ? radarBlips
        .map((blip) => ({
          ...blip,
          position: latLonToScopePosition(
            blip.lat, blip.lon,
            userLocation.lat, userLocation.lon,
            radius
          ),
        }))
        .filter((b) => b.position !== null)
    : [];

  /* ---------- Status bar content ---------- */
  const statusRight = (
    <>
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
        satellite_alt
      </span>
      <span className="text-code-sm" style={{ letterSpacing: '0.1em' }}>
        {geoError 
          ? `ERROR // ${geoError.toUpperCase()}`
          : radarLoading
            ? 'ACQUIRING...'
            : `UPLINK_SECURE // ${positionedBlips.length} CONTACTS // ${radius}NM`}
      </span>
    </>
  );

  return (
    <main className="radar-page">
      {/* Status Bar */}
      <div className="radar-page__status">
        <StatusBar rightSlot={statusRight} />
      </div>

      {/* Radar Area */}
      <div className="radar-page__scope">
        {/* WebGL Canvas */}
        <canvas ref={canvasRef} className="radar-page__canvas" />

        {/* Blip Labels Overlay */}
        <div className="radar-page__labels">
          <div className="radar-page__labels-inner">
            {/* Range markers along the horizontal axis */}
            <div className="radar-page__range-marker text-code-sm" style={{ left: '95%', top: '50%' }}>
              {radius}NM
            </div>
            <div className="radar-page__range-marker text-code-sm" style={{ left: '80%', top: '50%' }}>
              {Math.round(radius * 0.66)}NM
            </div>
            <div className="radar-page__range-marker text-code-sm" style={{ left: '65%', top: '50%' }}>
              {Math.round(radius * 0.33)}NM
            </div>

            {positionedBlips.map((blip) => (
              <BlipLabel 
                key={blip.id} 
                {...blip} 
                onClick={handleBlipClick} 
              />
            ))}
          </div>
        </div>

        {/* Flight Details Popup */}
        {selectedFlightId && (
          <div className="flight-details-popup-overlay" onClick={closePopup}>
            <div className="flight-details-popup" onClick={(e) => e.stopPropagation()}>
              <div className="flight-details-popup__header">
                <div>
                  <div className="text-headline-sm glow-text">FLIGHT_DATA_UPLINK</div>
                  <div className="text-code-sm text-glow-error blink" style={{ marginTop: '4px' }}>
                    STATUS: {isLoading ? 'RECEIVING...' : (error ? 'ERROR' : 'SECURE')}
                  </div>
                </div>
                <button className="flight-details-popup__close text-headline-sm" onClick={closePopup}>[X]</button>
              </div>
              
              {isLoading && (
                <div className="text-body-md blink glow-text" style={{ textAlign: 'center', padding: '32px 0' }}>
                  &gt;&gt;&gt; ESTABLISHING CONNECTION...
                </div>
              )}
              
              {error && (
                <div className="text-body-md text-glow-error" style={{ textAlign: 'center', padding: '32px 0' }}>
                  &gt;&gt;&gt; CONNECTION FAILED: {error}
                </div>
              )}

              {!isLoading && !error && flightDetails && (
                <>
                  <div className="flight-details-popup__grid text-code-sm">
                    <div className="flight-details-popup__label">AIRCRAFT:</div>
                    <div className="flight-details-popup__value glow-text">[{flightDetails.aircraft}] // {flightDetails.category}</div>
                    
                    <div className="flight-details-popup__label">CALLSIGN:</div>
                    <div className="flight-details-popup__value">{flightDetails.callsign}</div>
                    
                    <div className="flight-details-popup__label">SQUAWK:</div>
                    <div className="flight-details-popup__value">{flightDetails.squawkCode}</div>
                    
                    <div className="flight-details-popup__label">ALTITUDE:</div>
                    <div className="flight-details-popup__value">{flightDetails.altitude}</div>
                    
                    <div className="flight-details-popup__label">SPEED:</div>
                    <div className="flight-details-popup__value">{flightDetails.speed}</div>
                    
                    <div className="flight-details-popup__label">HEADING:</div>
                    <div className="flight-details-popup__value">{flightDetails.heading}</div>
                    
                    <div className="flight-details-popup__label">REGISTRATION:</div>
                    <div className="flight-details-popup__value">{flightDetails.registration}</div>

                    <div className="flight-details-popup__label">ORIGIN:</div>
                    <div className="flight-details-popup__value">{flightDetails.origin}</div>
                    
                    <div className="flight-details-popup__label">DESTINATION:</div>
                    <div className="flight-details-popup__value">{flightDetails.destination}</div>
                    
                    <div className="flight-details-popup__label">FUEL LEVEL:</div>
                    <div className="flight-details-popup__value">{flightDetails.fuelLevel}</div>

                    <div className="flight-details-popup__label">STATUS:</div>
                    <div className={`flight-details-popup__value ${flightDetails.status === 'GENERAL_EMERGENCY' ? 'text-glow-error blink' : 'glow-text'}`}>
                      {flightDetails.status}
                    </div>
                  </div>

                  {/* Track on ADS-B Exchange */}
                  <a
                    className="flight-details-popup__track-btn"
                    href={`https://globe.adsbexchange.com/?icao=${selectedFlightId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
                    TRACK_ON_ADSBX // {selectedFlightId.toUpperCase()}
                  </a>
                </>
              )}
            </div>
          </div>
        )}

        {/* Corner Brackets */}
        <CornerBrackets />
      </div>
    </main>
  );
}
