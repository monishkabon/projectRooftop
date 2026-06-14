import { useState, useEffect, useCallback, useRef } from 'react';
import StatusBar from '../components/StatusBar';
import SquawkEntry from '../components/SquawkEntry';
import './ListPage.css';

const API_BASE = '';
const POLL_INTERVAL = 5000;
const SEARCH_DEBOUNCE = 300;

export default function CivilianTraffic() {
  const [squawks, setSquawks] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showingHistory, setShowingHistory] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  const fetchSquawks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/squawks`);
      if (!res.ok) throw new Error('Uplink failed');
      const data = await res.json();
      setSquawks(data.civilian);
      setError(null);

      if (data.civilian.length === 0) {
        fetchHistory();
      } else {
        setShowingHistory(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/history/squawks?days=30`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.civilian.length > 0) {
        setHistory(data.civilian);
        setShowingHistory(true);
      }
    } catch {
      // Silently fail — history is supplementary
    }
  };

  // Debounced search
  const executeSearch = useCallback(async (query) => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      // Search live civilian feed
      const liveRes = await fetch(`${API_BASE}/api/search/civilian?q=${encodeURIComponent(query)}`);
      const liveData = liveRes.ok ? await liveRes.json() : { data: [] };

      // Search historical squawk events (civilian only)
      const histRes = await fetch(`${API_BASE}/api/search/history?q=${encodeURIComponent(query)}&category=civilian`);
      const histData = histRes.ok ? await histRes.json() : { data: [] };

      // Merge: live results first, then historical (deduplicated by hex)
      const seenHex = new Set();
      const merged = [];

      for (const entry of liveData.data) {
        if (!seenHex.has(entry.id)) {
          seenHex.add(entry.id);
          merged.push(entry);
        }
      }

      for (const entry of histData.data) {
        const key = entry.hex || entry._id;
        if (!seenHex.has(key)) {
          seenHex.add(key);
          merged.push(entry);
        }
      }

      setSearchResults({ data: merged, liveCount: liveData.data.length, historyCount: histData.data.length });
    } catch {
      setSearchResults({ data: [], liveCount: 0, historyCount: 0 });
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value.trim()) {
      setSearchResults(null);
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      executeSearch(value);
    }, SEARCH_DEBOUNCE);
  };

  useEffect(() => {
    fetchSquawks();
    const timer = setInterval(fetchSquawks, POLL_INTERVAL);
    return () => {
      clearInterval(timer);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [fetchSquawks]);

  // Determine what to display
  const isSearchActive = searchQuery.trim().length > 0;
  const displayEntries = isSearchActive
    ? (searchResults?.data || [])
    : (squawks.length > 0 ? squawks : (showingHistory ? history : []));

  // Heading text
  let headingText;
  if (isSearchActive) {
    headingText = <>&gt;&gt;&gt; SEARCH_RESULTS // QUERY: "{searchQuery.toUpperCase()}"</>;
  } else if (showingHistory) {
    headingText = <>&gt;&gt;&gt; HISTORICAL_SQUAWK_LOG // CIVILIAN (LAST 30 DAYS)</>;
  } else {
    headingText = <>&gt;&gt;&gt; CIVILIAN_EMERGENCY_SQUAWKS (7500/7600/7700)</>;
  }

  // Search meta
  let searchMeta = '';
  if (isSearchActive && searchResults) {
    searchMeta = `${searchResults.data.length} FOUND (${searchResults.liveCount} LIVE / ${searchResults.historyCount} HIST)`;
  } else if (isSearchActive && searching) {
    searchMeta = 'SCANNING...';
  }

  return (
    <main className="list-page scanlines">
      <div className="list-page__inner">
        <StatusBar />

        <h1 className="list-page__heading text-headline-md glow-text">
          {headingText}
        </h1>

        <div className="list-page__entries">
          {loading && !isSearchActive && (
            <div className="text-body-md blink glow-text" style={{ textAlign: 'center', padding: '32px 0' }}>
              &gt;&gt;&gt; ESTABLISHING UPLINK...
            </div>
          )}

          {!loading && error && !isSearchActive && (
            <div className="text-body-md text-glow-error" style={{ textAlign: 'center', padding: '32px 0' }}>
              &gt;&gt;&gt; UPLINK_ERROR: {error}
            </div>
          )}

          {isSearchActive && searching && (
            <div className="text-body-md blink glow-text" style={{ textAlign: 'center', padding: '32px 0' }}>
              &gt;&gt;&gt; SCANNING FEEDS...
            </div>
          )}

          {!loading && !error && !searching && displayEntries.length === 0 && (
            <div className="text-body-md glow-text" style={{ textAlign: 'center', padding: '32px 0', opacity: 0.6 }}>
              {isSearchActive
                ? <>&gt;&gt;&gt; NO MATCHES FOUND FOR "{searchQuery.toUpperCase()}"</>
                : <>&gt;&gt;&gt; NO ACTIVE OR HISTORICAL CIVILIAN EMERGENCY SQUAWKS DETECTED</>}
            </div>
          )}

          {displayEntries.map((entry) => (
            <SquawkEntry key={entry.id || entry._id} {...entry} />
          ))}
        </div>

        {/* Search Footer */}
        <div className="list-page__search-footer">
          <span className="list-page__search-prompt text-code-sm">&gt;_SEARCH:</span>
          <input
            id="civilian-search-input"
            className="list-page__search-input text-code-sm"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="CALLSIGN / HEX / TYPE / SQUAWK..."
            spellCheck={false}
            autoComplete="off"
          />
          {searchMeta && (
            <span className={`list-page__search-meta text-code-sm ${searchResults ? 'list-page__search-meta--active' : ''}`}>
              [{searchMeta}]
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
