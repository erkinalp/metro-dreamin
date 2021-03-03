import React, { useState, useEffect } from 'react';

import mapboxgl from 'mapbox-gl';

import { Discover } from './components/Discover.js';
import { Search } from './components/Search.js';

mapboxgl.accessToken = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4M29iazA2Z2gycXA4N2pmbDZmangifQ.-g_vE53SD2WrJ6tFX7QHmA';

export function Explore(props) {
  const [input, setInput] = useState(props.search || '');
  const [query, setQuery] = useState(props.search || '');
  const [ windowDims, setWindowDims ] = useState({
    width: window.innerWidth || 0,
    height: window.innerHeight || 0
  });

  useEffect(() => {
    if (!!navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform)) {
      document.body.classList.add('isIOS');
    }

    window.addEventListener('resize', () => setWindowDims({ height: window.innerHeight, width: window.innerWidth }));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    setQuery(input);
  }

  const content = query ?
    <Search database={props.database} search={query} user={props.user} settings={props.settings} database={props.database} /> :
    <Discover database={props.database} user={props.user} settings={props.settings} database={props.database} />;

  const exploreClass = `Explore ${props.settings.lightMode ? 'LightMode' : 'DarkMode'}`
  return (
    <div className={exploreClass}>
      <div className="Explore-container">
        <form className="Explore-inputWrap" onSubmit={handleSubmit}>
          <input className="Explore-input" value={input} placeholder={"Search for a map"}
                onChange={(e) => setInput(e.target.value)}
                onBlur={(e) => query ? setQuery(e.target.value) : null}
          />
          <button className="Explore-searchButton" type="submit">
            <i className="fas fa-search"></i>
          </button>
        </form>
        {content}
      </div>
    </div>
  );
}
