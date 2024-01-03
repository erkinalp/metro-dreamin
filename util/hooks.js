import { useEffect, useState, useContext, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAuthState } from 'react-firebase-hooks/auth';
import { collection, collectionGroup, query, where, orderBy, doc, getDoc, updateDoc, setDoc, onSnapshot, limit } from 'firebase/firestore';
import ReactGA from 'react-ga4';

import { sortSystems } from '/util/helpers.js';
import { FirebaseContext } from '/util/firebase.js';
import { setThemeCookie } from '/util/cookies.js';

// Custom hook to read  auth record and user profile doc
export function useUserData({ theme = 'DarkMode' }) {
  const firebaseContext = useContext(FirebaseContext);

  const [user, loading] = useAuthState(firebaseContext.auth);
  const [settings, setSettings] = useState({ lightMode: theme === 'LightMode' });
  const [ownSystemDocs, setOwnSystemDocs] = useState([]);
  const [starredSystemIds, setStarredSystemIds] = useState([]);
  const [userIdsBlocked, setUserIdsBlocked] = useState(new Set());
  const [blockedByUserIds, setBlockedByUserIds] = useState(new Set());
  const [authStateLoading, setAuthStateLoading] = useState(true);

  useEffect(() => {
    let unsubUser = () => {};
    let unsubOwn = () => {};
    let unsubStars = () => {};
    let unsubBlocks = () => {};
    let unsubBlockedBy = () => {};

    if (user && user.uid) {
      const userDoc = doc(firebaseContext.database, `users/${user.uid}`);
      updateLastLogin(userDoc);
      unsubUser = listenToUserDoc(userDoc);

      unsubOwn = listenToOwnSystems(user.uid);
      unsubStars = listenToStarredSystems(user.uid);

      unsubBlocks = listenToUserIdsBlocked(user.uid);
      unsubBlockedBy = listenToBlockedByUserIds(user.uid);

      ReactGA.set({ 'user_id': user.uid });
    } else {
      setAuthStateLoading(loading);
    }

    return () => {
      unsubUser();
      unsubOwn();
      unsubStars();
      unsubBlocks();
      unsubBlockedBy();
    };
  }, [user, loading]);

  const generateNewUser = async (userDoc) => {
    if (!user || !user.uid || !userDoc) {
      console.log('generateNewUser: user and userDoc are required');
      return;
    };

    console.log('Initializing user.');

    let email = '';
    let displayName = '';
    let phoneNumber = '';

    if (user.email) email = user.email;
    if (user.displayName) displayName = user.displayName;
    if (user.phoneNumber) phoneNumber = user.phoneNumber;

    // some providers have slightly different object structures, from what I recall
    for (const pData of (user.providerData || [])) {
      if (!email && pData.email) email = pData.email;
      if (!displayName && pData.displayName) displayName = pData.displayName;
      if (!phoneNumber && pData.phoneNumber) phoneNumber = pData.phoneNumber;
    }

    displayName = displayName.trim();
    if (displayName.length >= 2 && displayName[0] === '[' && displayName[displayName.length - 1] === ']') {
      displayName = `(${displayName.substring(1, displayName.length - 1)})`;
    }
    displayName = displayName ? displayName : 'Anon';

    await setDoc(userDoc, {
      userId: user.uid,
      displayName: displayName,
      systemsCreated: 0,
      creationDate: Date.now(),
      lastLogin: Date.now()
    });

    const privateDoc = doc(firebaseContext.database, `users/${user.uid}/private/info`);
    await setDoc(privateDoc, {
      email: email.toLowerCase(),
      phoneNumber: phoneNumber,
      userId: user.uid
    });

    ReactGA.event({
      category: 'Auth',
      action: 'Initialized Account'
    });
  }

  const listenToUserDoc = (userDoc) => {
    return onSnapshot(userDoc, (userSnap) => {
      if (userSnap.exists() && (userSnap.data() || {}).userId) {
        setSettings(settings => {
          return { ...settings, ...userSnap.data() };
        });

        setThemeCookie(location.hostname, userSnap.data().lightMode ? 'LightMode' : 'DarkMode');
      }
      setAuthStateLoading(loading);
    }, (error) => {
      console.log('Unexpected Error:', error);
      setAuthStateLoading(loading);
    });
  }

  const updateLastLogin = async (userDoc) => {
    return getDoc(userDoc).then((userSnap) => {
      if (userSnap.exists() && (userSnap.data() || {}).userId) {
        updateDoc(userDoc, {
          lastLogin: Date.now()
        }).then(() => {
          ReactGA.event({
            category: 'Auth',
            action: 'Signed In'
          });
        }).catch((error) => {
          console.log('Unexpected Error:', error);
        });
      } else {
        // user doc does not exist; create it
        generateNewUser(userDoc);
      }
      setAuthStateLoading(loading);
    }).catch((error) => {
      console.log('Unexpected Error:', error);
      setAuthStateLoading(loading);
    });
  }

  const listenToOwnSystems = (userId) => {
    const ownSystemsQuery = query(collection(firebaseContext.database, 'systems'), where('userId', '==', userId));

    return onSnapshot(ownSystemsQuery, (ownSystemsSnapshot) => {
      let sysDocs = [];
      for (const sysDoc of ownSystemsSnapshot.docs || []) {
        sysDocs.push(sysDoc.data());
      }
      setOwnSystemDocs(sysDocs.sort(sortSystems));
    }, (error) => {
      console.log('Unexpected Error:', error);
    });
  }

  const listenToStarredSystems = (userId) => {
    const starsQuery = query(collectionGroup(firebaseContext.database, 'stars'), where('userId', '==', userId));

    return onSnapshot(starsQuery, (starsSnapshot) => {
      let sysIds = [];
      for (const starDoc of starsSnapshot.docs || []) {
        sysIds.push(starDoc.data().systemId);
      }
      setStarredSystemIds(sysIds);
    }, (error) => {
      console.log('Unexpected Error:', error);
    });
  }

  const listenToUserIdsBlocked = (userId) => {
    const blockedUsersQuery = query(collection(firebaseContext.database, `users/${userId}/blocks`));

    return onSnapshot(blockedUsersQuery, (blocksSnapshot) => {
      let uidsBlocked = new Set();
      for (const blockDoc of blocksSnapshot.docs || []) {
        uidsBlocked.add(blockDoc.data().blockedUserId);
      }
      setUserIdsBlocked(uidsBlocked);
    }, (error) => {
      console.log('Unexpected Error:', error);
    });
  }

  const listenToBlockedByUserIds = (userId) => {
    const blockedByUsersQuery = query(collectionGroup(firebaseContext.database, 'blocks'), where('blockedUserId', '==', userId));

    return onSnapshot(blockedByUsersQuery, (blocksSnapshot) => {
      let uidsBlocked = new Set();
      for (const blockDoc of blocksSnapshot.docs || []) {
        uidsBlocked.add(blockDoc.data().blockerId);
      }
      setBlockedByUserIds(uidsBlocked);
    }, (error) => {
      console.log('Unexpected Error:', error);
    });
  }

  /**
   * Checks whether the current user blocks the other user or if the other user block th current user.
   * @param {uid} otherUserId the other user's id
   * @returns {boolean} if either user is blocked
   */
  const checkBidirectionalBlocks = (otherUserId) => {
    if (!otherUserId) return false;

    if (userIdsBlocked && userIdsBlocked.has(otherUserId)) return true;
    if (blockedByUserIds && blockedByUserIds.has(otherUserId)) return true;

    return false;
  }

  return { authStateLoading, user, settings, ownSystemDocs, starredSystemIds, checkBidirectionalBlocks };
}


// Custom hook to listen for comments on a system
export function useCommentsForSystem({ systemId }) {
  const firebaseContext = useContext(FirebaseContext);

  const [comments, setComments] = useState([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);

  const INITIAL_PAGE_SIZE = 10;

  useEffect(() => {
    if (!systemId) return;

    let unsubAllComments = () => {};
    let unsubLatestComments = () => {};

    if (showAllComments) {
      const commentsQuery = query(collection(firebaseContext.database, `systems/${systemId}/comments`),
                                  orderBy('timestamp', 'desc'));

      unsubLatestComments();
      unsubAllComments = listenToComments(commentsQuery, Number.MAX_SAFE_INTEGER - 1);
    } else {
      const commentsQuery = query(collection(firebaseContext.database, `systems/${systemId}/comments`),
                                  orderBy('timestamp', 'desc'),
                                  limit(INITIAL_PAGE_SIZE + 1));

      unsubAllComments();
      unsubLatestComments = listenToComments(commentsQuery, INITIAL_PAGE_SIZE);
    }

    return () => {
      unsubAllComments();
      unsubLatestComments();
    };
  }, [showAllComments]);

  const listenToComments = (commentsQuery, countLimit) => {
    return onSnapshot(commentsQuery, (commentsSnapshot) => {
      const removedComment = commentsSnapshot.docChanges().find(dChange => (dChange.type || '') === 'removed');
      if (commentsSnapshot.size < countLimit + 1 && !removedComment) {
        // always show all comments when there are fewer than 11 comments
        // and none got removed in the latest updates
        setShowAllComments(true);
      }

      setComments(commentsSnapshot.docs
                  .slice(0, countLimit)
                  .map(commentDoc => {
        return { ...commentDoc.data(), id: commentDoc.id };
      }));
      setCommentsLoaded(true);
    }, (error) => {
      console.log('Unexpected Error:', error);
      setCommentsLoaded(false);
    });
  }

  return { comments, commentsLoaded, showAllComments, setShowAllComments };
}


// Custom hook to listen for stars on a system
export function useStarsForSystem({ systemId }) {
  const firebaseContext = useContext(FirebaseContext);

  const [stars, setStars] = useState([]);
  const [starsLoaded, setStarsLoaded] = useState(false);

  useEffect(() => {
    let unsubStars = () => {};
    if (systemId) {
      const starsQuery = query(collection(firebaseContext.database, `systems/${systemId}/stars`), orderBy('timestamp', 'desc'));
      unsubStars = listenToStars(starsQuery);
    }

    return () => {
      unsubStars();
    };
  }, []);

  const listenToStars = (starsQuery) => {
    return onSnapshot(starsQuery, (starsSnapshot) => {
      setStars(starsSnapshot.docs.map(starDoc => {
        return { ...starDoc.data(), id: starDoc.id };
      }));
      setStarsLoaded(true);
    }, (error) => {
      console.log('Unexpected Error:', error);
      setStarsLoaded(false);
    });
  }

  return { stars, starsLoaded };
}


// Custom hook to listen for branches to a system
export function useDescendantsOfSystem({ systemId }) {
  const firebaseContext = useContext(FirebaseContext);

  const [directDescendants, setDirectDescendants] = useState([]);
  const [indirectDescendants, setIndirectDescendants] = useState([]);
  const [descendantsLoaded, setDescendantsLoaded] = useState(false);

  useEffect(() => {
    let unsubDesc = () => {};
    if (systemId) {
      const descQuery = query(collection(firebaseContext.database, 'systems'),
                                         where('ancestors', 'array-contains', systemId),
                                         where('isPrivate', '==', false));
      unsubDesc = listenToDescendants(descQuery);
    }

    return () => {
      unsubDesc();
    };
  }, []);

  const listenToDescendants = (descQuery) => {
    return onSnapshot(descQuery, (descSnapshot) => {
      const allDescendants = descSnapshot.docs.map(descDoc => {
        return descDoc.data();
      });

      let newDirect = [];
      let newIndirect = [];
      for (const desc of allDescendants) {
        const ancestors = desc.ancestors || [];
        if (ancestors.indexOf(systemId) === ancestors.length - 1) {
          newDirect.push(desc);
        } else {
          newIndirect.push(desc);
        }
      }

      setDirectDescendants(newDirect);
      setIndirectDescendants(newIndirect);
      setDescendantsLoaded(true);
    }, (error) => {
      console.log('Unexpected Error:', error);
      setDescendantsLoaded(false);
    });
  }

  return { directDescendants, indirectDescendants, descendantsLoaded };
}


// allows catching navigation while user has unsaved changes to the map
// adapted from comment by @cuginoAle in https://github.com/vercel/next.js/discussions/32231
export function useNavigationObserver({ shouldStopNavigation, onNavigate }) {
  const router = useRouter();
  const currentPath = router.asPath;
  const nextPath = useRef('');

  const killRouterEvent = useCallback(() => {
    router.events.emit({ type: 'routeChangeComplete' });

    ReactGA.event({
      category: 'Edit',
      action: 'Catch Unsaved Navigation'
    });

    // Throwing an actual error class trips the Next.JS 500 Page, this string literal does not.
    throw 'Abort route change due to unsaved changes to map. Triggered by useNavigationObserver. Please ignore this error.';
  }, [router])

  useEffect(() => {
    const onRouteChange = (url) => {
      if (shouldStopNavigation && url !== currentPath) {
        nextPath.current = url;
        onNavigate(url);
        killRouterEvent();
      }
    }

    router.events.on('routeChangeStart', onRouteChange);

    return () => {
      router.events.off('routeChangeStart', onRouteChange);
    }
  },
  [
    currentPath,
    killRouterEvent,
    onNavigate,
    router.events,
    shouldStopNavigation,
  ]);

  const navigate = () => {
    router.push(nextPath.current);
  }

  return navigate;
}


// detects state and direction of scrolling
// adapted from react-use-scroll-direction
export function useScrollDirection() {
  const [scrollDirection, setScrollDirection] = useState(null);

  const isScrolling = scrollDirection !== null;
  const isScrollingX = scrollDirection === 'LEFT' || scrollDirection === 'RIGHT';
  const isScrollingY = scrollDirection === 'UP' || scrollDirection === 'DOWN';
  const isScrollingUp = scrollDirection === 'UP';
  const isScrollingDown = scrollDirection === 'DOWN';
  const isScrollingLeft = scrollDirection === 'LEFT';
  const isScrollingRight = scrollDirection === 'RIGHT';

  useEffect(() => {
    if (process.browser && typeof window === 'object') {
      let scrollTimeout;
      let lastScrollTop = getScrollTop();
      let lastScrollLeft = getScrollLeft();

      const handleScroll = () => {
        // Reset scroll direction when scrolling stops
        window.clearTimeout(scrollTimeout);
        scrollTimeout = window.setTimeout(() => {
          setScrollDirection(null);
        }, 66);

        // Set vertical direction while scrolling
        const scrollTop = getScrollTop();
        if (scrollTop > lastScrollTop) {
          setScrollDirection('DOWN');
        } else if (scrollTop < lastScrollTop) {
          setScrollDirection('UP');
        }
        lastScrollTop = scrollTop;

        // Set horizontal scroll direction
        const scrollLeft = getScrollLeft();
        if (scrollLeft > lastScrollLeft) {
          setScrollDirection('RIGHT');
        } else if (scrollLeft < lastScrollLeft) {
          setScrollDirection('LEFT');
        }
        lastScrollLeft = scrollLeft;
      }

      document.addEventListener('scroll', handleScroll);
      return () => document.removeEventListener('scroll', handleScroll);
    }
  }, [process.browser]);

  const getScrollTop = () => {
    return (
      window.scrollY ||
      window.pageYOffset ||
      document.body.scrollTop ||
      (document.documentElement && document.documentElement.scrollTop) ||
      0
    );
  }

  const getScrollLeft = () => {
    return (
      window.scrollX ||
      window.pageXOffset ||
      document.body.scrollLeft ||
      (document.documentElement && document.documentElement.scrollLeft) ||
      0
    );
  }

  return {
    scrollDirection, isScrolling,
    isScrollingX, isScrollingY,
    isScrollingUp, isScrollingDown,
    isScrollingLeft, isScrollingRight,
  }
}
