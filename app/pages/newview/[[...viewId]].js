import React, { useState, useEffect, useContext } from 'react';
import { collection, doc, getDoc } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/router';
// import ReactCSSTransitionGroup from 'react-addons-css-transition-group';
import ReactGA from 'react-ga';
import mapboxgl from 'mapbox-gl';

import { FirebaseContext } from '/lib/firebaseContext.js';
import { getUserDocData, getSystemDocData, getViewDocData } from '/lib/firebase.js';
import {
  sortSystems,
  getViewPath,
  getViewURL,
  getViewId,
  getDistance,
  addAuthHeader,
  buildInterlineSegments,
  diffInterlineSegments
} from '/lib/util.js';
import {
  INITIAL_SYSTEM, INITIAL_META, DEFAULT_LINES, MAX_HISTORY_SIZE,
  LOGO, LOGO_INVERTED
} from '/lib/constants.js';

import { Controls } from '/components/Controls.js';
import { Line } from '/components/Line.js';
import { Map } from '/components/Map.js';
import { Metatags } from '/components/Metatags.js';
import { Notifications } from '/components/Notifications.js';
import { Shortcut } from '/components/Shortcut.js';
// import { Start } from '/components/Start.js';
import { Station } from '/components/Station.js';
import { ViewOnly } from '/components/ViewOnly.js';

mapboxgl.accessToken = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4M29iazA2Z2gycXA4N2pmbDZmangifQ.-g_vE53SD2WrJ6tFX7QHmA';

export async function getServerSideProps({ params }) {
  const { viewId } = params;

  if (viewId && viewId[0]) {
    try {
      const decodedId = Buffer.from(viewId[0], 'base64').toString('ascii');
      const decodedIdParts = decodedId.split('|');
      const ownerUid = decodedIdParts[0];
      const systemId = decodedIdParts[1];

      if (ownerUid && systemId) {
        // TODO: make a promise group for these
        const ownerDocData = await getUserDocData(ownerUid);
        const systemDocData = await getSystemDocData(ownerUid, systemId);
        const viewDocData = await getViewDocData(viewId[0]);
        return { props: { ownerDocData, systemDocData, viewDocData } };
      }
      return { props: { ownerDocData: decodedId } };
    } catch (e) {
      console.log('Unexpected Error:', e);
      // TODO: redirect to /view or /explore
      return { props: {} };
    }
  }

  return { props: {} };
}

export default function View({ ownerDocData, systemDocData, viewDocData }) {
  const router = useRouter();
  const firebaseContext = useContext(FirebaseContext);

  const [viewOnly, setViewOnly] = useState(!(ownerDocData.userId && firebaseContext.user && firebaseContext.user.uid && (ownerDocData.userId === firebaseContext.user.uid)))
  const [system, setSystem] = useState(INITIAL_SYSTEM);
  const [history, setHistory] = useState([]);
  const [meta, setMeta] = useState(INITIAL_META);
  const [isSaved, setIsSaved] = useState(true);
  const [waypointsHidden, setWaypointsHidden] = useState(false);
  const [focus, setFocus] = useState({});
  const [recent, setRecent] = useState({});
  const [changing, setChanging] = useState({ all: true });
  const [interlineSegments, setInterlineSegments] = useState({});
  const [alert, setAlert] = useState('');
  const [toast, setToast] = useState('');
  const [prompt, setPrompt] = useState();
  const [segmentUpdater, setSegmentUpdater] = useState(0);
  const [map, setMap] = useState();
  // const [windowDims, setWindowDims] = useState({ width: window.innerWidth || 0, height: window.innerHeight || 0 });

  useEffect(() => {
    setSystemFromDocument(systemDocData);
  }, []);

  useEffect(() => {
    setViewOnly(!(ownerDocData.userId && firebaseContext.user && firebaseContext.user.uid && (ownerDocData.userId === firebaseContext.user.uid)))
  }, [firebaseContext.user, firebaseContext.authStateLoading, ownerDocData]);

  useEffect(() => {
    if (system.manualUpdate) {
      setHistory(prevHistory => {
        // do not allow for infinitely large history
        if (prevHistory.length < MAX_HISTORY_SIZE + 1) {
          return prevHistory.concat([JSON.parse(JSON.stringify(system))]);
        }
        return prevHistory.slice(-MAX_HISTORY_SIZE).concat([JSON.parse(JSON.stringify(system))]);
      });
    }
  }, [system.manualUpdate]);

  useEffect(() => {
    setInterlineSegments(currSegments => {
      const newSegments = buildInterlineSegments(system, Object.keys(system.lines));
      setChanging(currChanging => {
        currChanging.segmentKeys = diffInterlineSegments(currSegments, newSegments);
        return currChanging;
      })
      setInterlineSegments(newSegments);
    });
  }, [segmentUpdater]);

  const refreshInterlineSegments = () => {
    setSegmentUpdater(currCounter => currCounter + 1);
  }

  const setSystemFromDocument = (systemDocData) => {
    if (systemDocData && systemDocData.map) {
      systemDocData.map.manualUpdate = 1;
      setSystem(systemDocData.map);
      setMeta({
        systemId: systemDocData.systemId,
        nextLineId: systemDocData.nextLineId,
        nextStationId: systemDocData.nextStationId
      });
      refreshInterlineSegments();
    }
  }

  const setupSignIn = () => {
    window.alert('TODO: sign up');
  }

  const handleMapInit = (map) => {
    setMap(map);
  }

  const handleHomeClick = () => {
    ReactGA.event({
      category: 'Main',
      action: 'Home'
    });

    const goHome = () => {
      router.push({
        pathname: '/explore'
      });
    }

    if (!isSaved) {
      setPrompt({
        message: 'You have unsaved changes to your map. Do you want to save before leaving?',
        confirmText: 'Yes, save it!',
        denyText: 'No, do not save.',
        confirmFunc: () => {
          setPrompt(null);
          // this.handleSave(goHome);
        },
        denyFunc: () => {
          setPrompt(null);
          setIsSaved(true); // needed to skip the unload page alert
          goHome();
          // this.setState({
          //   prompt: null,
          //   isSaved: true // needed to skip the unload page alert
          // }, goHome);
        }
      });
    } else {
      goHome();
    }
  }

  const handleUndo = () => {
    if (viewOnly) return;
    if (history.length < 2) {
      handleSetToast('Undo history is empty');
      return;
    };

    // go back two entries since most recent entry is current system
    const prevSystem = history[history.length - 2];

    let stationSet = new Set();
    Object.keys(system.stations).forEach(sID => stationSet.add(sID));
    Object.keys(prevSystem.stations).forEach(sID => stationSet.add(sID));

    let lineSet = new Set();
    Object.keys(system.lines).forEach(lID => lineSet.add(lID));
    Object.keys(prevSystem.lines).forEach(lID => lineSet.add(lID));

    setSystem(prevSystem);
    setHistory(currHistory => currHistory.slice(0, currHistory.length - 2));
    setChanging({
      stationIds: Array.from(stationSet),
      lineKeys: Array.from(lineSet)
    })
    setFocus({});
    refreshInterlineSegments();

    ReactGA.event({
      category: 'Action',
      action: 'Undo'
    });
  }

  const handleToggleMapStyle = (map, style) => {
    console.log('update map style', style)
    map.setStyle(style);

    map.once('styledata', () => {
      console.log('style loaded, update changing')
      setChanging({ all: true });
    });

    setChanging({});
  }

  const handleToggleWaypoints = () => {
    ReactGA.event({
      category: 'Action',
      action: waypointsHidden ? 'Show waypoints' : 'Hide waypoints'
    });

    setWaypointsHidden(currWaypointsHidden => currWaypointsHidden ? false : true);
    setChanging({
      stationIds: Object.values(system.stations).filter(s => s.isWaypoint).map(s => s.id)
    })
  }

  const handleGetTitle = (title, showAlert) => {
    setSystem(currSystem => {
      currSystem.title = title;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setIsSaved(false);

    // if (showAlert) {
    //   this.handleSetAlert('Tap the map to add a station!');
    // }
  }

  const handleMapClick = async (lat, lng) => {
    if (viewOnly) return;

    let station = {
      lat: lat,
      lng: lng,
      id: meta.nextStationId,
      name: 'Station Name'
    }

    getStationName(station);

    setMeta(currMeta => {
      currMeta.nextStationId = `${parseInt(currMeta.nextStationId) + 1}`;
      return currMeta;
    });
    setSystem(currSystem => {
      currSystem.stations[station.id] = station;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      stationIds: [ station.id ]
    });
    setFocus({
      station: station
    });
    setRecent(recent => {
      recent.stationId = station.id;
      return recent;
    });
    setIsSaved(false);

    ReactGA.event({
      category: 'Action',
      action: 'Add New Station'
    });
  }

  const handleStopClick = (id) => {
    setChanging({});
    setFocus({
      station: system.stations[id]
    });
  }

  const handleLineClick = (id) => {
    setChanging({});
    setFocus({
      line: system.lines[id]
    });
  }

  const getStationName = (station) => {
    let geocodingEndpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${station.lng},${station.lat}.json?access_token=${mapboxgl.accessToken}`;
    let req = new XMLHttpRequest();
    req.addEventListener('load', () => {
      const resp = JSON.parse(req.response);
      for (const feature of resp.features) {
        if (feature.text) {
          station.name = feature.text;
          break;
        }
      }

      // TODO: replace history state instead of append
      setSystem(currSystem => {
        currSystem.stations[station.id] = station;
        return currSystem;
      });

      setFocus(currFocus => {
        // ensure focus gets updated
        if ('station' in currFocus && currFocus.station.id === station.id) {
          return { station: station };
        }
        return currFocus;
      });
    });
    req.open('GET', geocodingEndpoint);
    req.send();
  }

  const getNearestIndex = (currSystem, lineKey, station) => {
    const line = currSystem.lines[lineKey];
    const stations = currSystem.stations;

    if (line.stationIds.length === 0 || line.stationIds.length === 1) {
      return 0;
    }

    let nearestIndex = 0;
    let nearestId;
    let nearestDist = Number.MAX_SAFE_INTEGER;
    for (const [i, stationId] of line.stationIds.entries()) {
      let dist = getDistance(station, stations[stationId]);
      if (dist < nearestDist) {
        nearestIndex = i;
        nearestId = stationId;
        nearestDist = dist;
      }
    }

    if (nearestIndex !== 0 && line.stationIds[0] === nearestId) {
      // If nearest is loop point at start
      return 0;
    } else if (nearestIndex !== line.stationIds.length - 1 &&
               line.stationIds[line.stationIds.length - 1] === nearestId) {
      // If nearest is loop point at end
      return line.stationIds.length;
    }

    if (nearestIndex === 0) {
      const nearStation = stations[line.stationIds[nearestIndex]];
      const nextStation = stations[line.stationIds[nearestIndex + 1]];
      const otherDist = getDistance(nearStation, nextStation);
      const nextDist = getDistance(station, nextStation);
      if (nextDist > otherDist) {
        return 0;
      }
      return 1;
    } else if (nearestIndex === line.stationIds.length - 1) {
      const nearStation = stations[line.stationIds[nearestIndex]];
      const nextStation = stations[line.stationIds[nearestIndex - 1]];
      const otherDist = getDistance(nearStation, nextStation);
      const nextDist = getDistance(station, nextStation);
      if (nextDist > otherDist) {
        return line.stationIds.length;
      }
      return line.stationIds.length - 1;
    } else {
      const prevStation = stations[line.stationIds[nearestIndex - 1]];
      const nextStation = stations[line.stationIds[nearestIndex + 1]];
      const prevDist = getDistance(station, prevStation);
      const nextDist = getDistance(station, nextStation);
      const nearToPrevDist = getDistance(stations[line.stationIds[nearestIndex]], prevStation);
      const nearToNextDist = getDistance(stations[line.stationIds[nearestIndex]], nextStation);
      if (prevDist < nextDist) {
        if (nearToPrevDist < prevDist) return nearestIndex + 1;
        return nearestIndex;
      } else {
        if (nearToNextDist < nextDist) return nearestIndex;
        return nearestIndex + 1;
      }
    }
  }

  const handleStationInfoChange = (stationId, info, replace = false) => {
    if (!(stationId in (system.stations || {}))) {
      // if station has been deleted since info change
      return;
    }

    let station = system.stations[stationId];
    if (station.isWaypoint) {
      // name and info not needed for waypoint
      return;
    }

    if (replace) {
      // TODO: figure out a way for this to actually replace last history entry
      setSystem(currSystem => {
        currSystem.stations[stationId] = { ...station, ...info };
        return currSystem
      });
    } else {
      setSystem(currSystem => {
        currSystem.stations[stationId] = { ...station, ...info };
        currSystem.manualUpdate++;
        return currSystem
      });
      setRecent(recent => {
        recent.stationId = station.id;
        return recent;
      });
      ReactGA.event({
        category: 'Action',
        action: 'Change Station Info'
      });
    }

    setFocus(currFocus => {
      // ensure focus gets updated
      if ('station' in currFocus && currFocus.station.id === stationId) {
        return { station: { ...station, ...info } };
      }
      return currFocus;
    });
    setChanging({});
    setIsSaved(false);
  }

  const handleAddStationToLine = (lineKey, station, position) => {
    setSystem(currSystem => {
      let line = currSystem.lines[lineKey];

      if (!line) return currSystem;

      if (position !== 0 && !position) {
        position = getNearestIndex(currSystem, lineKey, station);
      }

      if (position === 0) {
        line.stationIds = [station.id].concat(line.stationIds);
      } else if (position < line.stationIds.length) {
        line.stationIds.splice(position, 0, station.id);
      } else {
        line.stationIds = line.stationIds.concat([station.id]);
      }

      currSystem.lines[lineKey] = line;
      currSystem.manualUpdate++;
      return currSystem;
    });

    setChanging({
      lineKeys: [ lineKey ],
      stationIds: [ station.id ]
    });
    setFocus({
      station: station
    });
    setRecent({
      lineKey: lineKey,
      stationId: station.id
    });
    setIsSaved(false);
    refreshInterlineSegments();

    ReactGA.event({
      category: 'Action',
      action: `Add ${station.isWaypoint ? 'Waypoint' : 'Station'} to Line`
    });
  }

  const handleStationDelete = (station) => {
    let modifiedLines = [];
    for (const lineKey in system.lines) {
      const stationCountBefore = system.lines[lineKey].stationIds.length;
      const stationCountAfter = system.lines[lineKey].stationIds.filter(sId => sId !== station.id).length;
      if (stationCountBefore !== stationCountAfter) {
        modifiedLines.push(lineKey);
      }
    }

    setSystem(currSystem => {
      delete currSystem.stations[station.id];
      for (const lineKey of modifiedLines) {
        currSystem.lines[lineKey].stationIds = currSystem.lines[lineKey].stationIds.filter(sId => sId !== station.id);
      }
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      lineKeys: modifiedLines,
      stationIds: [ station.id ]
    });
    setFocus({});
    setRecent(recent => {
      delete recent.stationId;
      return recent;
    });
    setIsSaved(false);
    refreshInterlineSegments();

    ReactGA.event({
      category: 'Action',
      action: `Delete ${station.isWaypoint ? 'Waypoint' : 'Station'}`
    });
  }

  const handleConvertToWaypoint = (station) => {
    station.isWaypoint = true;
    delete station.name;
    delete station.info;

    setSystem(currSystem => {
      currSystem.stations[station.id] = station;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      stationIds: [ station.id ],
      lineKeys: Object.values(system.lines)
                  .filter(line => line.stationIds.includes(station.id))
                  .map(line => line.id)
    });
    setFocus({
      station: station
    });
    setRecent({
      stationId: station.id
    });
    setIsSaved(false);

    ReactGA.event({
      category: 'Action',
      action: 'Convert to Waypoint'
    });
  }

  const handleConvertToStation = (station) => {
    delete station.isWaypoint;
    station.name = 'Station Name';
    getStationName(station);

    setSystem(currSystem => {
      currSystem.stations[station.id] = station;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      stationIds: [ station.id ],
      lineKeys: Object.values(system.lines)
                  .filter(line => line.stationIds.includes(station.id))
                  .map(line => line.id)
    });
    setFocus({
      station: station
    });
    setRecent({
      stationId: station.id
    });
    setIsSaved(false);

    ReactGA.event({
      category: 'Action',
      action: 'Convert to Station'
    });
  }

  const handleLineInfoChange = (line, renderMap) => {
    setSystem(currSystem => {
      currSystem.lines[line.id] = line;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setFocus({
      line: line
    });
    setRecent(recent => {
      recent.lineKey = line.id;
      return recent;
    });
    setIsSaved(false);

    if (renderMap) {
      setChanging({
        lineKeys: [ line.id ]
      })
      refreshInterlineSegments();
    }

    ReactGA.event({
      category: 'Action',
      action: 'Change Line Info'
    });
  }

  const handleRemoveStationFromLine = (line, stationId) => {
    line.stationIds = line.stationIds.filter(sId => sId !== stationId);

    setSystem(currSystem => {
      currSystem.lines[line.id] = line;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      lineKeys: [ line.id ],
      stationIds: [ stationId ]
    });
    setFocus({
      line: line
    });
    setRecent({
      lineKey: line.id,
      stationId: stationId
    });
    setIsSaved(false);
    refreshInterlineSegments();

    ReactGA.event({
      category: 'Action',
      action: 'Remove Station from Line'
    });
  }

  const handleRemoveWaypointsFromLine = (line, waypointIds) => {
    line.stationIds = line.stationIds.filter(sId => !waypointIds.includes(sId));

    setSystem(currSystem => {
      currSystem.lines[line.id] = line;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      lineKeys: [ line.id ],
      stationIds: waypointIds
    });
    setFocus({
      line: line
    });
    setRecent({
      lineKey: line.id
    });
    setIsSaved(false);
    refreshInterlineSegments();

    ReactGA.event({
      category: 'Action',
      action: 'Remove Waypoints from Line'
    });
  }

  const handleReverseStationOrder = (line) => {
    line.stationIds = line.stationIds.slice().reverse();

    setSystem(currSystem => {
      currSystem.lines[line.id] = line;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      lineKeys: [ line.id ]
    });
    setFocus({
      line: line
    });
    setRecent({
      lineKey: line.id
    });
    setIsSaved(false);

    ReactGA.event({
      category: 'Action',
      action: 'Reverse Station Order'
    });
  }

  const handleAddLine = () => {
    const lineKeys = Object.keys(system.lines);

    let currColors = [];
    for (const key of lineKeys) {
      currColors.push(system.lines[key].color);
    }

    let index = 0;
    if (lineKeys.length >= 21) {
      index = Math.floor(Math.random() * 21);
    }
    let nextLine = DEFAULT_LINES[index];
    for (const defLine of DEFAULT_LINES) {
      if (!currColors.includes(defLine.color)) {
        nextLine = defLine;
        break;
      }
    }

    const lineKey = meta.nextLineId;
    nextLine.stationIds = [];
    nextLine.id = lineKey;

    setMeta(currMeta => {
      currMeta.nextLineId = `${parseInt(currMeta.nextLineId) + 1}`;
      return currMeta;
    });
    setSystem(currSystem => {
      currSystem.lines[lineKey] = nextLine;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setFocus({
      line: nextLine
    });
    setFocus({
      line: nextLine
    });
    setRecent(recent => {
      recent.lineKey = lineKey;
      return recent;
    });
    setChanging({});
    setIsSaved(false);

    ReactGA.event({
      category: 'Action',
      action: 'Add New Line'
    });
  }

  const handleLineDelete = (line) => {
    setSystem(currSystem => {
      delete currSystem.lines[line.id];
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      lineKeys: [ line.id ],
      stationIds: line.stationIds,
    });
    setFocus({});
    setRecent(recent => {
      delete recent.lineKey;
      return recent;
    });
    setIsSaved(false);
    refreshInterlineSegments();

    ReactGA.event({
      category: 'Action',
      action: 'Delete Line'
    });
  }

  const handleLineDuplicate = (line) => {
    let forkedLine = JSON.parse(JSON.stringify(line));
    forkedLine.id = meta.nextLineId;
    forkedLine.name = line.name + ' - Fork';

    setMeta(meta => {
      meta.nextLineId = `${parseInt(meta.nextLineId) + 1}`;
      return meta;
    });
    setSystem(currSystem => {
      currSystem.lines[forkedLine.id] = forkedLine;
      currSystem.manualUpdate++;
      return currSystem;
    });
    setChanging({
      lineKeys: [ forkedLine.id ]
    });
    setFocus({
      line: forkedLine
    });
    setRecent(recent => {
      recent.lineKey = forkedLine.id;
      return recent;
    });

    ReactGA.event({
      category: 'Action',
      action: 'Fork Line'
    });
  }

  const handleCloseFocus = () => {
    setFocus({});

    ReactGA.event({
      category: 'Action',
      action: 'Close Focus'
    });
  }

  const handleSetAlert = (message) => {
    setAlert(message);

    setTimeout(() => {
      setAlert('');
    }, 3000);
  }

  const handleSetToast = (message) => {
    setToast(message);

    setTimeout(() => {
      setToast('');
    }, 2000);
  }

  const renderFocus = () => {
    let content;
    if ('station' in focus) {
      content = <Station station={focus.station} lines={system.lines} stations={system.stations}
                         viewOnly={viewOnly} useLight={firebaseContext.settings.lightMode}
                         onAddToLine={handleAddStationToLine}
                         onDeleteStation={handleStationDelete}
                         onConvertToWaypoint={handleConvertToWaypoint}
                         onConvertToStation={handleConvertToStation}
                         onLineClick={(line) => handleLineClick(line.id)}
                         onStationInfoChange={handleStationInfoChange}
                         onFocusClose={handleCloseFocus} />;
    } else if ('line' in focus) {
      content =  <Line line={focus.line} system={system} viewOnly={viewOnly}
                       onLineInfoChange={handleLineInfoChange}
                       onStationRemove={handleRemoveStationFromLine}
                       onWaypointsRemove={handleRemoveWaypointsFromLine}
                       onReverseStationOrder={handleReverseStationOrder}
                       onDeleteLine={handleLineDelete}
                       onDuplicateLine={handleLineDuplicate}
                       onStopClick={handleStopClick}
                       onFocusClose={handleCloseFocus} />;
    }
    return content;
  }

  const renderAlert = () => {
    if (alert) {
      return (
        <div className="Main-alert FadeAnim">
          <div className="Main-alertMessage">
            {alert}
          </div>
        </div>
      );
    }
  }

  const renderToast = () => {
    if (toast) {
      return (
        <div className="Main-toast FadeAnim">
          <div className="Main-toastMessage">
            {toast}
          </div>
        </div>
      );
    }
  }

  const renderPrompt = () => {
    if (prompt && prompt.message && prompt.denyFunc && prompt.confirmFunc) {
      return (
        <div className="Main-prompt FadeAnim">
          <div className="Main-promptContent">
            <div className="Main-promptMessage">
              {prompt.message}
            </div>
            <div className="Main-promptButtons">
              <button className="Main-promptDeny Button--inverse" onClick={prompt.denyFunc}>
                {prompt.denyText ? prompt.denyText : 'No'}
              </button>
              <button className="Main-promptConfirm Button--primary" onClick={prompt.confirmFunc}>
                {prompt.confirmText ? prompt.confirmText : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  const renderShortcut = () => {
    if (!viewOnly && map) {
      return (
        <Shortcut map={map} focus={focus} system={system} recent={recent}
                  onAddToLine={handleAddStationToLine}
                  onConvertToWaypoint={handleConvertToWaypoint}
                  onConvertToStation={handleConvertToStation}
                  onDeleteStation={handleStationDelete} />
      );
    }
  }

  const renderViewOnly = () => {
    if (viewOnly && !firebaseContext.authStateLoading) {
      return (
        <ViewOnly system={system} ownerName={ownerDocData.displayName} viewId={viewDocData.viewId || router.query.viewId}
                  viewDocData={viewDocData}
                  // setupSignIn={() => this.setupSignIn()}
                  // onStarredViewsUpdated={this.props.onStarredViewsUpdated}
                  onSetToast={handleSetToast} />
      );
    }
  }

  const renderHeader = () => {
    const notifOrCreate = firebaseContext.user ?
      <Notifications page={'view'} /> :
      <button className="Main-signInButton Link" onClick={setupSignIn}>
        Sign in
      </button>;

    return (
      <div className="Main-header">
        <div className="Main-headerLeft">
          <button className="Main-homeLink ViewHeaderButton" onClick={handleHomeClick}>
            <i className="fas fa-home"></i>
          </button>
        </div>
        <div className="Main-headerRight">
          {!firebaseContext.authStateLoading && notifOrCreate}

          <button className="Main-settingsButton ViewHeaderButton"
                  onClick={() => {
                                   this.props.onToggleShowSettings(isOpen => !isOpen);
                                   ReactGA.event({
                                     category: 'Main',
                                     action: 'Toggle Settings'
                                   });
                                 }}>
            <i className="fas fa-cog"></i>
          </button>
        </div>
      </div>
    );
  }

  const mainClass = `Main ${firebaseContext.settings.lightMode ? 'LightMode' : 'DarkMode'}`
  return (
    <main className={mainClass}>
      <Metatags title={viewDocData && viewDocData.title ? 'MetroDreamin\' | ' + viewDocData.title : null} />

      {renderHeader()}

      <Map system={system} interlineSegments={interlineSegments} changing={changing} focus={focus}
           systemLoaded={systemDocData && systemDocData.map} viewOnly={viewOnly} waypointsHidden={waypointsHidden}
           //  initial={this.state.initial} gotData={this.state.gotData}
           useLight={firebaseContext.settings.lightMode} useLow={firebaseContext.settings.lowPerformance} // newSystemSelected={this.state.newSystemSelected || false}
           onStopClick={handleStopClick}
           onLineClick={handleLineClick}
           onMapClick={handleMapClick}
           onMapInit={handleMapInit}
           onToggleMapStyle={handleToggleMapStyle} />

      <Controls system={system} router={router} settings={firebaseContext.settings} viewOnly={viewOnly}
                useLight={firebaseContext.settings.lightMode} ownerDocData={ownerDocData} // initial={this.state.initial} gotData={this.state.gotData}
                meta={meta} // systemChoices={this.state.systemChoices}
                // newSystemSelected={this.state.newSystemSelected || false}
                isPrivate={viewDocData.isPrivate || false} waypointsHidden={waypointsHidden}
                viewId={viewDocData.viewId || this.props.router.query.viewId} viewDocData={viewDocData}
                // signOut={() => this.props.signOut()}
                // setupSignIn={() => this.setupSignIn()}
                // onSave={() => this.handleSave()}
                onUndo={handleUndo}
                onAddLine={handleAddLine}
                onLineElemClick={(line) => handleLineClick(line.id)}
                setToast={handleSetToast}
                // onShareToFacebook={() => this.handleShareToFacebook()}
                // onOtherSystemSelect={(systemId) => this.handleOtherSystemSelect(systemId)}
                onGetTitle={handleGetTitle}
                // onTogglePrivate={() => this.handleTogglePrivate()}
                onToggleWapoints={handleToggleWaypoints}
                // onStarredViewsUpdated={this.props.onStarredViewsUpdated}
                onSetAlert={handleSetAlert}
                onSetToast={handleSetToast}
                onHomeClick={handleHomeClick} />

      {renderFocus()}
      {renderViewOnly()}
      {renderPrompt()}
      {renderAlert()}
      {renderToast()}
      {renderShortcut()}
    </main>
  );
}
