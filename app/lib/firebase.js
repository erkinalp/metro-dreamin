
import React from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  query,
  where,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  orderBy
} from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import retry from 'async-retry';

import { shouldErrorCauseFailure } from '/lib/util.js';

const FIREBASE_CONFIGS = {
  PROD: {
    apiKey: "AIzaSyBIMlulR8OTOoF-57DHty1NuXM0kqVoL5c",
    authDomain: "metrodreamin.firebaseapp.com",
    databaseURL: "https://metrodreamin.firebaseio.com",
    projectId: "metrodreamin",
    storageBucket: "metrodreamin.appspot.com",
    messagingSenderId: "86165148906"
  },
  STAGING: {
    apiKey: "AIzaSyDYU-8dYy0OWGJ1RJ46V_S7fWJHlAA2DWg",
    authDomain: "metrodreaminstaging.firebaseapp.com",
    databaseURL: "https://metrodreaminstaging.firebaseio.com",
    projectId: "metrodreaminstaging",
    storageBucket: "metrodreaminstaging.appspot.com",
    messagingSenderId: "572980459956"
  }
};

let env = 'PROD';
let apiBaseUrl = 'https://us-central1-metrodreamin.cloudfunctions.net/api/v1';
let useEmulator = false;

if (process.env.NEXT_PUBLIC_STAGING === 'true') {
  env = 'STAGING';
  apiBaseUrl = 'https://us-central1-metrodreaminstaging.cloudfunctions.net/api/v1';
}

if (process.env.NEXT_PUBLIC_LOCAL === 'true') {
  env = 'STAGING';
  apiBaseUrl = 'http://localhost:5001/metrodreaminstaging/us-central1/api/v1';
  useEmulator = true;
}

if (env !== 'PROD') {
  console.log('~~~~ Using staging account ~~~~');
  console.log(`~~~~ Using function url ${apiBaseUrl} ~~~~`);
  if (useEmulator) console.log('~~~~ Using emulators ~~~~');
}

const app = initializeApp(FIREBASE_CONFIGS[env]);

export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const storage = getStorage(app);

if (useEmulator) {
  if (!auth.emulatorConfig) {
    connectAuthEmulator(auth, 'http://localhost:9099');
  }
  if (!firestore.emulatorConfig && (firestore._settings.host || '') !== 'localhost:8080') {
    connectFirestoreEmulator(firestore, 'localhost', 8080);
  }
}

export const FirebaseContext = React.createContext({
  apiBaseUrl: apiBaseUrl,
  user: null,
  database: firestore,
  auth: auth,
  settings: {},
  authStateLoading: true
});

/**
 * Updates a users/{uid} document
 * @param {string} uid
 * @param {Object} propertiesToSave
 */
 export async function updateUserDoc(uid, propertiesToSave) {
  if (!uid) {
    console.log('getUserDocData: uid is a required parameter');
    return;
  }

  if (Object.keys(propertiesToSave || {}).length === 0) {
    console.log('getUserDocData: propertiesToSave is empty');
    return;
  }

  await retry(async (bail) => {
    try {
      const userDoc = doc(firestore, `users/${uid}`);
      await updateDoc(userDoc, {
        lastLogin: Date.now(),
        ...propertiesToSave
      });
    } catch (e) {
      console.log('updateUserDoc error:', e);
      if (shouldErrorCauseFailure(e)) {
        bail(e);
        return;
      } else {
        throw e;
      }
    }
  });
}

/**
 * Gets a users/{uid} document
 * @param {string} uid
 */
export async function getUserDocData(uid) {
  if (!uid) {
    console.log('getUserDocData: uid is a required parameter');
    return;
  }

  return await retry(async (bail) => {
    try {
      const userDoc = await getDoc(doc(firestore, `users/${uid}`));

      if (userDoc.exists()) {
        return userDoc.data();
      } else {
        console.log('getUserDocData: unable to get user doc');
        throw new Error('Not Found');
      }
    } catch (e) {
      console.log('getUserDocData error:', e);
      if (shouldErrorCauseFailure(e)) {
        bail(e);
        return;
      } else {
        throw e;
      }
    }
  });
}

/**
 * Gets a users/{uid} document
 * @param {string} uid
 */
export async function getSystemsByUser(uid) {
  if (!uid) {
    console.log('getSystemsByUser: uid is a required parameter');
    return;
  }

  return await retry(async (bail) => {
    try {
      const systemsByUserQuery = query(collection(firestore, 'systems'),
                                       where('userId', '==', uid),
                                       orderBy('lastUpdated', 'desc'));
      const systemDocs = await getDocs(systemsByUserQuery);
      let systemsByUser = [];
      systemDocs.forEach((systemDoc) => {
        systemsByUser.push(systemDoc.data());
      });
      return systemsByUser;
    } catch (e) {
      console.log('getSystemsByUser error:', e);
      if (shouldErrorCauseFailure(e)) {
        bail(e);
        return;
      } else {
        throw e;
      }
    }
  });
}

/**
 * Gets systems/{systemId}/lines systems/{systemId}/stations etc documents and
 * puts them into expected system format
 * @param {string} systemId
 */
export async function getFullSystem(systemId) {
  if (!systemId) {
    console.log('getFullSystem: systemId is a required parameter');
    return;
  }

  return await retry(async (bail) => {
    try {
      const systemDoc = await getDoc(doc(firestore, `systems/${systemId}`));
      if (!systemDoc.exists()) {
        throw new Error('Not Found');
      }
      const systemDocData = systemDoc.data();

      const mapDoc = await getDoc(doc(firestore, `systems/${systemId}/map/map`));
      if (!mapDoc.exists()) {
        throw new Error('Not Found');
      }
      const mapDocData = mapDoc.data();
      const map = {
        stations: mapDocData.stations || {},
        lines: mapDocData.lines || {},
        interchanges: mapDocData.interchanges || {}
      }

      // The /lines, /stations, and /interchanges collections previously accessed below were
      // removed to reduce the number of database operations, and instead are all included
      // in the same `/map/map` document.

      // const linesPromise = new Promise((resolve) => {
      //   getDocs(collection(firestore, `systems/${systemId}/lines`)).then((linesSnap) => {
      //     let lines = {};
      //     linesSnap.forEach((lineDoc) => {
      //       const lineData = lineDoc.data();
      //       lines[lineData.id] = lineData;
      //     });
      //     resolve({ lines: lines });
      //   });
      // });

      // const stationsPromise = new Promise((resolve) => {
      //   getDocs(collection(firestore, `systems/${systemId}/stations`)).then((stationsSnap) => {
      //     let stations = {};
      //     stationsSnap.forEach((stationDoc) => {
      //       const stationData = stationDoc.data();
      //       stations[stationData.id] = stationData;
      //     });
      //     resolve({ stations: stations });
      //   });
      // });

      // const interchangesPromise = new Promise((resolve) => {
      //   getDocs(collection(firestore, `systems/${systemId}/interchanges`)).then((interchangesSnap) => {
      //     let interchanges = {};
      //     interchangesSnap.forEach((interchangeDoc) => {
      //       const interchangeData = interchangeDoc.data();
      //       interchanges[interchangeData.id] = interchangeData;
      //     });
      //     resolve({ interchanges: interchanges });
      //   });
      // });

      // const promisesData = await Promise.all([ linesPromise, stationsPromise, interchangesPromise ]);
      // let map = {};
      // for (const pData of promisesData) {
      //   map = { ...map, ...pData };
      // }

      // filter out invalid station references in lines
      for (const lineId in (map.lines || {})) {
        map.lines[lineId].stationIds = (map.lines[lineId].stationIds || []).filter(sId => (map.stations || {})[sId]);
      }

      // filter out invalid station references in interchanges
      for (const interchangeId in (map.interchanges || {})) {
        map.interchanges[interchangeId].stationIds = (map.interchanges[interchangeId].stationIds || []).filter(sId => (map.stations || {})[sId]);
      }

      return {
        map: {
          ...map,
          title: systemDocData.title,
          caption: systemDocData.caption ? systemDocData.caption : ''
        },
        meta: systemDocData.meta
      }
    } catch (e) {
      console.log('getFullSystem error:', e);
      if (shouldErrorCauseFailure(e)) {
        bail(e);
        return;
      } else {
        throw e;
      }
    }
  });
}

/**
 * Gets a views/{systemId} document
 * @param {string} systemId
 */
export async function getSystemDocData(systemId) {
  if (!systemId) {
    console.log('getSystemDocData: systemId is a required parameter');
    return;
  }

  return await retry(async (bail) => {
    try {
      const systemDoc = await getDoc(doc(firestore, `systems/${systemId}`));
      if (!systemDoc.exists()) {
        throw new Error('Not Found');
      }
      return systemDoc.data();
    } catch (e) {
      console.log('getSystemDocData error:', e);
      if (shouldErrorCauseFailure(e)) {
        bail(e);
        return;
      } else {
        throw e;
      }
    }
  });
}

/**
 * Gets a correctly formatted system and ancestors from another system or a default system in the db
 * @param {string} systemId
 * @param {bool} isDefault
 */
export async function getSystemFromBranch(systemId, isDefault = false) {
  if (!systemId) {
    console.log('systemId: systemId is a required parameter');
    return;
  }

  const docString = `${isDefault ? 'defaultSystems' : 'systems'}/${systemId}`;

  return await retry(async (bail) => {
    try {
      const systemDoc = await getDoc(doc(firestore, docString));
      if (!systemDoc.exists()) {
        throw new Error('Not Found');
      }
      const systemDocData = systemDoc.data();

      if (systemDocData.isPrivate) {
        throw new Error('System is private; cannot branch');
      }

      const meta = systemDocData.meta;
      delete meta.systemNumStr;

      const ancestorId = isDefault ? `defaultSystems/${systemId}` : systemId;
      const ancestors = [ ...(systemDocData.ancestors || []), ancestorId ];

      const mapDoc = await getDoc(doc(firestore, `systems/${systemId}/map/map`));
      if (!mapDoc.exists()) {
        throw new Error('Not Found');
      }
      const mapDocData = mapDoc.data();
      const map = {
        stations: mapDocData.stations || {},
        lines: mapDocData.lines || {},
        interchanges: mapDocData.interchanges || {}
      }

      // The /lines, /stations, and /interchanges collections previously accessed below were
      // removed to reduce the number of database operations, and instead are all included
      // in the same `/map/map` document.

      // const linesPromise = new Promise((resolve) => {
      //   getDocs(collection(firestore, `${docString}/lines`)).then((linesSnap) => {
      //     let lines = {};
      //     linesSnap.forEach((lineDoc) => {
      //       const lineData = lineDoc.data();
      //       lines[lineData.id] = lineData;
      //     });
      //     resolve({ lines: lines });
      //   });
      // });

      // const stationsPromise = new Promise((resolve) => {
      //   getDocs(collection(firestore, `${docString}/stations`)).then((stationsSnap) => {
      //     let stations = {};
      //     stationsSnap.forEach((stationDoc) => {
      //       const stationData = stationDoc.data();
      //       stations[stationData.id] = stationData;
      //     });
      //     resolve({ stations: stations });
      //   });
      // });

      // const interchangesPromise = new Promise((resolve) => {
      //   getDocs(collection(firestore, `${docString}/interchanges`)).then((interchangesSnap) => {
      //     let interchanges = {};
      //     interchangesSnap.forEach((interchangeDoc) => {
      //       const interchangeData = interchangeDoc.data();
      //       interchanges[interchangeData.id] = interchangeData;
      //     });
      //     resolve({ interchanges: interchanges });
      //   });
      // });

      // const promisesData = await Promise.all([ linesPromise, stationsPromise, interchangesPromise ]);
      // let map = {};
      // for (const pData of promisesData) {
      //   map = { ...map, ...pData };
      // }

      // filter out invalid station references in lines
      for (const lineId in (map.lines || {})) {
        map.lines[lineId].stationIds = (map.lines[lineId].stationIds || []).filter(sId => (map.stations || {})[sId]);
      }

      // filter out invalid station references in interchanges
      for (const interchangeId in (map.interchanges || {})) {
        map.interchanges[interchangeId].stationIds = (map.interchanges[interchangeId].stationIds || []).filter(sId => (map.stations || {})[sId]);
      }

      return {
        map: {
          ...map,
          title: systemDocData.title, // TODO: consider changing title
          caption: '' // do not copy caption
        },
        meta,
        ancestors
      }
    } catch (e) {
      console.log('getSystemFromBranch error:', e);
      if (shouldErrorCauseFailure(e) || e.message === 'System is private; cannot branch') {
        bail(e);
        return;
      } else {
        throw e;
      }
    }
  });
}

/**
 * Gets a views/{systemId} document
 * @param {string} systemId
 */
export async function getGlobalStatsData() {
  return await retry(async (bail) => {
    try {
      const globalStatsDoc = await getDoc(doc(firestore, `stats/global`));
      if (!globalStatsDoc.exists()) {
        throw new Error('Not Found');
      }
      return globalStatsDoc.data();
    } catch (e) {
      console.log('getGlobalStatsData error:', e);
      if (shouldErrorCauseFailure(e)) {
        bail(e);
        return;
      } else {
        throw e;
      }
    }
  });
}

/**
 * Gets a public url for a blob in firebase storage
 * @param {string} blobId
 */
export async function getUrlForBlob(blobId) {
  if (!blobId) {
    console.log('getUrlForBlob: blobId is a required parameter');
    return;
  }

  try {
    const imageRef = ref(storage, blobId);
    return await getDownloadURL(imageRef);
  } catch (e) {
    console.log('getUrlForBlob error:', e);
    return;
  }
}
