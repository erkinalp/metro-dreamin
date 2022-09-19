import React, { useState, useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import turfAlong from '@turf/along';
import turfCircle from '@turf/circle';
import { lineString as turfLineString } from '@turf/helpers';
import turfLength from '@turf/length';

import { checkForTransfer } from '../util.js';

mapboxgl.accessToken = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4M29iazA2Z2gycXA4N2pmbDZmangifQ.-g_vE53SD2WrJ6tFX7QHmA';
const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v10';
const DARK_STYLE = 'mapbox://styles/mapbox/dark-v10';

export function Map(props) {
  const mapEl = useRef(null);
  const [ map, setMap ] = useState();
  const [ styleLoaded, setStyleLoaded ] = useState(false);
  const [ hasSystem, setHasSystem ] = useState(false);
  const [ clickListened, setClickListened ] = useState(false);
  const [ enableClicks, setEnableClicks ] = useState(false);
  const [ interactive, setInteractive ] = useState(false);
  const [ focusedIdPrev, setFocusedIdPrev ] = useState();
  const [ focusedId, setFocusedId ] = useState();
  const [ useLight, setUseLight ] = useState(props.useLight);
  const [lineFeats, setLineFeats] = useState([]);
  const [segmentFeatsByOffset, setSegmentFeatsByOffset] = useState({});

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: props.useLight ? LIGHT_STYLE : DARK_STYLE,
      zoom: 2
    });

    // temporarily disable map interactions
    map.boxZoom.disable();
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.dragRotate.disable();
    map.keyboard.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();

    setMap(map);
    props.onMapInit(map);

    const interval = setInterval(() => {
      if (map.isStyleLoaded() && !styleLoaded) {
        setStyleLoaded(true);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // This handles changing the map style
    if (props.useLight && !useLight) {
      props.onToggleMapStyle(map, LIGHT_STYLE);
      setUseLight(true);
    } else if (!props.useLight && useLight) {
      props.onToggleMapStyle(map, DARK_STYLE);
      setUseLight(false);
    }
  }, [props.useLight]);

  useEffect(() => {
    // This determines which, if any, station should be focused
    if (props.focus && props.focus.station) {
      if (props.focus.station.id !== focusedId) {
        setFocusedIdPrev(focusedId);
        setFocusedId(props.focus.station.id);
      } else if (props.focus.station.id === focusedId) {
        // Already set
      }
    } else if (focusedId !== null) {
      setFocusedIdPrev(focusedId);
      setFocusedId(null);
    }
  }, [props.focus]);

  useEffect(() => {
    if (enableClicks && !clickListened) {
      map.on('click', (e) => {
        if (e.originalEvent.cancelBubble) {
          return;
        }

        const { lng, lat } = e.lngLat;
        props.onMapClick(lat, lng);
      });

      setClickListened(true);
    }
  }, [enableClicks]);

  useEffect(() => {
    const stations = props.system.stations;
    if (props.initial) {
      let bounds = new mapboxgl.LngLatBounds();
      for (const sId in stations) {
        bounds.extend(new mapboxgl.LngLat(stations[sId].lng, stations[sId].lat));
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          center: bounds.getCenter(),
          padding: Math.min(window.innerHeight, window.innerWidth) / 10
        });

        map.once('idle', () => {
          setEnableClicks(true);
        });
      }

      if (!bounds.isEmpty() || props.newSystemSelected) {
        enableStationsAndInteractions();
      }
    }
  }, [props.initial, props.system, map]);

  useEffect(() => {
    if (props.newSystemSelected) {
      map.once('idle', () => {
        setEnableClicks(true);
      });
    }
  }, [props.newSystemSelected]);

  useEffect(() => handleStations(), [focusedId]);

  useEffect(() => renderSystem(), [styleLoaded]);

  useEffect(() => {
    if (Object.keys(props.changing).length) {
      renderSystem();
    }
  }, [props.changing]);

  useEffect(() => {
    if (Object.keys(props.system.stations).length && !hasSystem) {
      renderSystem();
      setHasSystem(true);
    }
  }, [props.system]);

  useEffect(() => {
    const layerID = 'js-Map-lines';
    const layer = {
      "type": "line",
      "layout": {
          "line-join": "round",
          "line-cap": "round",
          "line-sort-key": 1
      },
      "source": {
        "type": "geojson"
      },
      "paint": {
        "line-width": 8,
        "line-color": ['get', 'color']
      }
    };

    let featCollection = {
      "type": "FeatureCollection",
      "features": lineFeats
    };

    renderLayer(layerID, layer, featCollection, true);
  }, [lineFeats]);

  useEffect(() => {
    const existingLayers = map ? map.getStyle().layers : [];
    for (const existingLayer of existingLayers.filter(eL => eL.id.startsWith('js-Map-segments--'))) {
      if (!(existingLayer.id.replace('js-Map-segments--', '') in segmentFeatsByOffset)) {
        // remove layers for this segment offset
        if (map.getLayer(existingLayer.id)) {
          map.removeLayer(existingLayer.id);
          map.removeSource(existingLayer.id);
        }
      }
    }

    for (const offsetKey in segmentFeatsByOffset) {
      const layerID = 'js-Map-segments--' + offsetKey;
      const layer = {
        "type": "line",
        "layout": {
            "line-join": "round",
            "line-cap": "round",
            "line-sort-key": 1
        },
        "source": {
          "type": "geojson"
        },
        "paint": {
          "line-width": 8,
          "line-color": ['get', 'color'],
          "line-translate": offsetKey.split('|').map(i => parseFloat(i)),
          // this is what i acually want https://github.com/mapbox/mapbox-gl-js/issues/6155
          // "line-translate": ['[]', ['get', 'translation-x'], ['get', 'translation-y']],
        }
      };

      let featCollection = {
        "type": "FeatureCollection",
        "features": segmentFeatsByOffset[offsetKey]
      };

      renderLayer(layerID, layer, featCollection, true);
    }
  }, [segmentFeatsByOffset]);

  const enableStationsAndInteractions = () => {
    if (map && !interactive) {
      map.once('idle', () => {
        // re-enable map interactions
        map.boxZoom.enable();
        map.scrollZoom.enable();
        map.dragPan.enable();
        map.dragRotate.enable();
        map.keyboard.enable();
        map.doubleClickZoom.enable();
        map.touchZoomRotate.enable();
      });
      setInteractive(true);
    }
  }

  const renderSystem = () => {
    if (styleLoaded) {
      handleStations();
      handleLines();
      handleSegments();
    }
  }

  const handleStations = () => {
    const stations = props.system.stations;
    const lines = props.system.lines;

    let stationIdsToHandle = [];
    if (props.changing.all) {
      stationIdsToHandle = Object.keys(stations);
    } else if (props.changing.stationIds) {
      stationIdsToHandle = props.changing.stationIds;
    }

    if (focusedId) {
      stationIdsToHandle.push(focusedId);
    }
    if (focusedIdPrev) {
      stationIdsToHandle.push(focusedIdPrev);
    }

    if (stationIdsToHandle.length) {
      const stationKeys = Object.keys(stations);
      for (const id of stationIdsToHandle) {
        const pin = document.getElementById('js-Map-station--' + id);
        const circleId = 'js-Map-focusCircle--' + id;
        if (stationKeys.includes(id) || props.initial) {
          if (pin) {
            pin.parentNode.removeChild(pin);
          }

          const { lng, lat } = stations[id];

          let color = '#888';
          let hasTransfer = false;
          for (const lineKey in lines) {
            if (lines[lineKey].stationIds.includes(id)) {
              color = '#fff';
              for (const otherLineKey in lines) {
                if (lineKey !== otherLineKey && checkForTransfer(id, lines[lineKey], lines[otherLineKey])) {
                  hasTransfer = true
                  break;
                }
              }
              if (hasTransfer) {
                break;
              };
            }
          }

          const svgWaypoint = `<svg height="16" width="16">
                                 <line x1="4" y1="4" x2="12" y2="12" stroke="${useLight ? '#353638' : '#e6e5e3'}" stroke-width="2" />
                                 <line x1="4" y1="12" x2="12" y2="4" stroke="${useLight ? '#353638' : '#e6e5e3'}" stroke-width="2" />
                               </svg>`;

          const svgStation = `<svg height="16" width="16">
                                <circle cx="8" cy="8" r="6" stroke="#000" stroke-width="2" fill="${color}" />
                              </svg>`;

          const svgInterchange = `<svg height="20" width="20">
                                    <rect rx="3" ry="3" x="0" y="0" height="14.14" width="14.14" stroke="#000" stroke-width="2" fill="${color}" transform="translate(10, 0) rotate(45)" />
                                  </svg>`;

          let el = document.createElement('button');
          el.id = 'js-Map-station--' + id;
          el.className = 'js-Map-station Map-station';
          if (stations[id].isWaypoint) {
            el.className += ' Map-station--waypoint';
          } else if (hasTransfer) {
            el.className += ' Map-station--interchange';
          }

          if (id === focusedId) {
            el.className += ' js-Map-station--focused Map-station--focused';

            if (!stations[id].isWaypoint && !map.getLayer(circleId)) {
              const circleData = turfCircle([parseFloat(lng), parseFloat(lat)], 0.5, {units: 'miles'});
              const circleLayer = {
                "type": "line",
                "layout": {
                    "line-join": "round",
                    "line-cap": "round",
                    "line-sort-key": 1
                },
                "source": {
                  "type": "geojson"
                },
                "paint": {
                  "line-color": useLight ? '#353638' : '#e6e5e3',
                  "line-width": 4,
                  "line-opacity": 0.5
                }
              };

              circleLayer.id = circleId;
              circleLayer.source.data = circleData;
              map.addLayer(circleLayer);
            } else if (stations[id].isWaypoint && map.getLayer(circleId)) {
              map.removeLayer(circleId);
              map.removeSource(circleId);
            }
          } else if (id === focusedIdPrev && map.getLayer(circleId)) {
            map.removeLayer(circleId);
            map.removeSource(circleId);
          }

          el.dataset.tip = stations[id].isWaypoint ? 'Waypoint' : stations[id].name || 'Station';
          el.innerHTML = stations[id].isWaypoint ? svgWaypoint : (hasTransfer ? svgInterchange : svgStation);

          el.addEventListener('click', (e) => {
            props.onStopClick(id);
            e.stopPropagation();
          });

          new mapboxgl.Marker(el)
            .setLngLat([lng, lat])
            .addTo(map);
        } else {
          if (pin) {
            pin.parentNode.removeChild(pin);
          }
          if (map.getLayer(circleId)) {
            map.removeLayer(circleId);
            map.removeSource(circleId);
          }
        }
      }
    }
  }

  const handleLines = () => {
    const stations = props.system.stations;
    const lines = props.system.lines;

    let updatedLineFeatures = {};
    if (props.changing.lineKeys || props.changing.all) {
      for (const lineKey of (props.changing.all ? Object.keys(lines) : props.changing.lineKeys)) {
        const vehicleId = 'js-Map-vehicle--' + lineKey;
        if (map.getLayer(vehicleId)) {
          map.removeLayer(vehicleId);
          map.removeSource(vehicleId);
        }

        if (!(lineKey in lines) || lines[lineKey].stationIds.length <= 1) {
          updatedLineFeatures[lineKey] = {};
          continue;
        }

        const coords = lines[lineKey].stationIds.map(id => [stations[id].lng, stations[id].lat]);
        if (coords.length > 1) {
          const feature = {
            "type": "Feature",
            "properties": {
              "line-key": lineKey,
              "color": lines[lineKey].color
            },
            "geometry": {
              "type": "LineString",
              "coordinates": coords
            }
          }

          updatedLineFeatures[lineKey] = feature;
        }

        // a section is the path between two non-waypoint stations
        let sections = [];
        let section = [];
        for (const [i, sId] of lines[lineKey].stationIds.entries()) {
          section.push(sId);
          if (i === 0) continue;
          if (!stations[sId].isWaypoint || i === lines[lineKey].stationIds.length - 1) {
            sections.push(section);
            section = [ sId ];
          }
        }

        let sectionIndex = Math.floor(Math.random() * sections.length);;
        let sectionCoords = sections[sectionIndex].map(id => [stations[id].lng, stations[id].lat]);
        let backwardCoords = sectionCoords.slice().reverse();

        map.addSource(vehicleId, {
          'type': 'geojson',
          'data': {
            'type': 'Point',
            'coordinates': sectionCoords[0]
          }
        });

        map.addLayer({
          'id': vehicleId,
          'source': vehicleId,
          'type': 'circle',
          'paint': {
            'circle-radius': 14,
            'circle-color': lines[lineKey].color
          }
        });

        // get the overall distance of each route so we can interpolate along them
        let routeDistance = turfLength(turfLineString(sectionCoords));

        let start;
        let forward = true;
        const isCircular = lines[lineKey].stationIds[0] === lines[lineKey].stationIds[lines[lineKey].stationIds.length - 1];

        async function frame(time) {
          if (!start) start = time;
          // phase determines how far through the animation we are
          const phase = (time - start) / (routeDistance * 1000);

          // when the animation is finished, reset start to loop the animation
          if (phase > 1) {
            // move to next station
            start = 0.0;
            sectionIndex += forward ? 1 : -1;

            if (sectionIndex >= sections.length) {
              sectionIndex = isCircular ? 0 : sections.length - 1;
              forward = isCircular ? forward : !forward; // circular lines do not switch direction
            } else if (sectionIndex < 0) {
              sectionIndex = 0;
              forward = isCircular ? forward : !forward; // circular lines do not switch direction
            }

            sectionCoords = sections[sectionIndex].map(id => [stations[id].lng, stations[id].lat]);
            backwardCoords = sectionCoords.slice().reverse();
            routeDistance = turfLength(turfLineString(sectionCoords));

            setTimeout(() => window.requestAnimationFrame(frame), 500); // pause at the station
            return
          }

          // find coordinates along route
          const alongRoute = turfAlong(
            turfLineString(forward ? sectionCoords : backwardCoords),
            routeDistance * phase
          ).geometry.coordinates;

          map.getSource(vehicleId).setData({
            'type': 'Point',
            'coordinates': [alongRoute[0], alongRoute[1]]
          });

          window.requestAnimationFrame(frame);
        }

        window.requestAnimationFrame(frame);
      }
    }

    if (Object.keys(updatedLineFeatures).length) {
      setLineFeats(lineFeats => {
        let newFeats = {};
        for (const feat of lineFeats) {
          newFeats[feat.properties['line-key']] = feat;
        }
        for (const featId in updatedLineFeatures) {
          newFeats[featId] = updatedLineFeatures[featId];
        }
        return Object.values(newFeats).filter(nF => nF.type);
      });
    }
  }

  const handleSegments = () => {
    const stations = props.system.stations;
    const lines = props.system.lines;
    const interlineSegments = props.interlineSegments;

    let updatedSegmentFeatures = {};
    for (const segmentKey of (props.changing.all ? Object.keys(interlineSegments) : (props.changing.segmentKeys || []))) {
      if (!(segmentKey in interlineSegments)) {
        for (const lineKey of Object.keys(lines)) {
          updatedSegmentFeatures[segmentKey + '|' + lines[lineKey].color] = {};
        }
        continue;
      }

      const segment = interlineSegments[segmentKey];
      for (const color of segment.colors) {
        const data = {
          "type": "Feature",
          "properties": {
            "segment-longkey": segmentKey + '|' + color,
            "color": color,
            "translation-x": Math.round(segment.offsets[color][0] * 2.0) / 2.0,
            "translation-y": Math.round(segment.offsets[color][1] * 2.0) / 2.0,
          },
          "geometry": {
            "type": "LineString",
            "coordinates": interlineSegments[segmentKey].stationIds.map(id => [stations[id].lng, stations[id].lat])
          }
        }

        updatedSegmentFeatures[segmentKey + '|' + color] = data;
      }
    }

    if (Object.keys(updatedSegmentFeatures).length) {
      setSegmentFeatsByOffset(segmentFeatsByOffset => {
        let newSegments = {};

        for (const offsetKey in segmentFeatsByOffset) {
          for (const feat of segmentFeatsByOffset[offsetKey]) {
            const segLongKeyParts = feat.properties['segment-longkey'].split('|'); // stationId stationId color
            if (segLongKeyParts.length === 3) {
              const potentialSeg = interlineSegments[segLongKeyParts.slice(0, 2).join('|')]; // "stationId|stationId"
              if (potentialSeg && potentialSeg.colors.includes(segLongKeyParts[2])) {
                newSegments[feat.properties['segment-longkey']] = feat;
              }
            }
          }
        }

        for (const featId in updatedSegmentFeatures) {
          if (updatedSegmentFeatures[featId].type) { // should be truthy unless intentionally removing it
            newSegments[featId] = updatedSegmentFeatures[featId];
          }
        }

        let newOffsetKeySegments = {};
        for (const seg of Object.values(newSegments)) {
          const offestKey = seg.properties['translation-x'] + '|' + seg.properties['translation-y'];
          if (!(offestKey in newOffsetKeySegments)) {
            newOffsetKeySegments[offestKey] = [];
          };
          newOffsetKeySegments[offestKey].push(seg);
        }

        return newOffsetKeySegments;
      });
    }
  }

  const renderLayer = (layerID, layer, data, underPrevLayer = false) => {
    if (map) {
      if (map.getLayer(layerID)) {
        // Update layer with new features
        map.getSource(layerID).setData(data);
      } else {
        initialLinePaint(layer, layerID, data);
      }
    }
  }

  const initialLinePaint = (layer, layerID, data) => {
    // Initial paint of line
    if (!map.getLayer(layerID)) {
      let newLayer = JSON.parse(JSON.stringify(layer));
      newLayer.id = layerID;
      newLayer.source.data = data;
      map.addLayer(newLayer);
    }
  }

  return (
    <div className="Map" ref={el => (mapEl.current = el)}></div>
  );
}
