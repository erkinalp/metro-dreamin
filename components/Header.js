import React, { useContext, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ReactGA from 'react-ga4';

import { FirebaseContext } from '/lib/firebase.js';
import { LOGO, LOGO_INVERTED } from '/lib/constants.js';

import { Notifications } from '/components/Notifications.js';

export function Header({ query = '', onToggleShowSettings, onToggleShowAuth }) {
  const router = useRouter();
  const firebaseContext = useContext(FirebaseContext);

  const [input, setInput] = useState(query);

  const handleSubmit = (e) => {
    e.preventDefault();
    updateHistoryAndQuery(input);
  }

  const updateHistoryAndQuery = (q) => {
    if (q) {
      router.push({
        pathname: '/explore',
        query: { search: `${q}` }
      });
    } else {
      router.push({
        pathname: '/explore'
      });

      ReactGA.event({
        category: 'Search',
        action: 'Clear'
      });
    }
  }

  const renderLeftContent = () => {
    const headerLeftLink = query ? (
      <div className="Header-backWrap">
        <button className="Header-backButton ViewHeaderButton"
                onClick={() => updateHistoryAndQuery('')}>
          <i className="fas fa-arrow-left fa-fw"></i>
        </button>
      </div>
    ) : (
      <div className="Header-logoWrap">
        <Link className="Header-logoLink" href={'/explore'}
              onClick={() => ReactGA.event({ category: 'Header', action: 'Logo' })}>
          <img className="Header-logo" src={firebaseContext.settings.lightMode ? LOGO_INVERTED : LOGO} alt="MetroDreamin' logo" />
        </Link>
      </div>
    );

    return headerLeftLink;
  }

  const renderInput = () => {
    return (
      <form className="Header-inputWrap" onSubmit={handleSubmit}>
        <input className="Header-input" value={input} placeholder={"Search for a map"}
              onChange={(e) => setInput(e.target.value)}
              onSubmit={(e) => updateHistoryAndQuery(e.target.value)}
        />
        <button className="Header-searchButton" type="submit" disabled={input ? false : true}>
          <i className="fas fa-search"></i>
        </button>
      </form>
    );
  }

  const renderRightContent = () => {
    if (!firebaseContext.authStateLoading) {
      if (firebaseContext.user) {
        return <>
          <Notifications />

          <Link className="Header-profileButton ViewHeaderButton"
                href={`/user/${firebaseContext.user.uid}`}
                onClick={() => {
                  ReactGA.event({
                    category: 'Header',
                    action: 'Profile Click'
                  });
                }}>
            <i className="fas fa-user"></i>
          </Link>

          <button className="Header-settingsButton ViewHeaderButton"
                  onClick={() => {
                                  onToggleShowSettings(isOpen => !isOpen);
                                  ReactGA.event({
                                    category: 'Header',
                                    action: 'Toggle Settings'
                                  });
                                 }}>
            <i className="fas fa-cog"></i>
          </button>
        </>
      } else {
        return (
          <button className="Header-signInButton ViewHeaderButton"
                  onClick={() => {
                    onToggleShowAuth(true);
                    ReactGA.event({ category: 'Header', action: 'Show Auth' });
                  }}>
            <i className="fa-solid fa-user"></i>
            <div className="Header-signInButtonText">
              Log in
            </div>
          </button>
        );
      }
    }
  }

  return <>
    <div className="ProgressBar">
        <div className="ProgressBar-bar"></div>
    </div>

    <header className="Header">
      <div className="Header-left">
        {renderLeftContent()}
      </div>

      <div className="Header-center">
        {renderInput()}
      </div>

      <div className={`Header-right Header-right--${!firebaseContext.authStateLoading && firebaseContext.user ? 'loggedIn' : 'notLoggedIn'}`}>
        {renderRightContent()}
      </div>
    </header>
  </>;
}
