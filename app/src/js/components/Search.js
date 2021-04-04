import React, { useState, useContext } from 'react';
import { Link } from "react-router-dom";

import browserHistory from "../history.js";
import { FirebaseContext } from "../firebaseContext.js";
import { Result } from './Result.js';

const SPLIT_REGEX = /[\s,.\-_:;<>\/\\\[\]()=+|{}'"?!*#]+/;
const START_COUNT = 6;

export const Search = (props) => {
  const [prevSearch, setPrevSearch] = useState('');
  const [resultViews, setResultViews] = useState([]);
  const [numShown, setNumShown] = useState(START_COUNT);
  const [isFetching, setIsFetching] = useState(true);

  const firebaseContext = useContext(FirebaseContext);

  const fetchData = async (input) => {
    setIsFetching(true);
    if (firebaseContext.database && input && input !== prevSearch) {
      setPrevSearch(input);
      setNumShown(START_COUNT);
      browserHistory.push(`/explore?search=${input}`);

      const inputWords = input.toLowerCase().split(SPLIT_REGEX);
      const filteredWords = inputWords.filter((kw, ind) => kw && ind === inputWords.indexOf(kw));

      return await firebaseContext.database.collection('views')
        .where('isPrivate', '==', false)
        .where('numStations', '>', 0)
        .where('keywords', 'array-contains-any', filteredWords)
        .get()
        .then((querySnapshot) => {
          let views = [];
          querySnapshot.forEach((viewDoc) => {
            views.push(viewDoc.data());
          });
          setResultViews(views.sort((viewA, viewB) => {
            const numMatchesA = viewA.keywords.filter(word => filteredWords.includes(word)).length;
            const numMatchesB = viewB.keywords.filter(word => filteredWords.includes(word)).length;
            const intersectPercentA = ((numMatchesA / viewA.keywords.length) + (numMatchesA / filteredWords.length)) / 2;
            const intersectPercentB = ((numMatchesB / viewB.keywords.length) + (numMatchesB / filteredWords.length)) / 2;
            return intersectPercentB - intersectPercentA;
          }));
          setIsFetching(false);
        })
        .catch((error) => {
          console.log("Error getting documents: ", error);
          setIsFetching(false);
        });
    }
    return () => {};
  }

  if (props.search && props.search !== prevSearch) {
    // Initial search when query param is provided
    fetchData(props.search);
  }

  let resultItems = resultViews.slice(0, numShown).map((viewData, index) => {
    if (viewData) {
      return (
        <Result viewData={viewData} key={viewData.viewId} />
      );
    }
    return null;
  });

  let results;
  if (isFetching) {
    results = <div>waiting....</div>
  } else if (resultItems.length || !prevSearch) {
    results = (
      <div className={'Search-results ' + (resultViews.length ? 'Search-results--populated' : 'Search-results--empty')}>
        {resultItems}
      </div>
    );
  } else if (prevSearch) {
    results = (
      <div className="Search-noResults">
        <div className="Search-noResultsText">
          No maps found for search "{prevSearch}".
        </div>

        <Link className="Search-startOwn" to={'/view'}>
          Start your own!
        </Link>
      </div>
    );
  }

  let displayedText = !resultViews.length ? null : (
    <div className="Search-numDisplayed">
      ( {Math.min(resultViews.length, numShown)} of {resultViews.length} results )
    </div>
  );

  let showMore = numShown >= resultViews.length ? null : (
    <button className="Search-showMore" onClick={() => setNumShown(prevNum => prevNum + 3)}>
      <i className="fas fa-chevron-circle-down"></i>
      <span className="Search-moreText">Show more</span>
    </button>
  );

  return (
    <div className="Search">
      {results}
      {displayedText}
      {showMore}
    </div>
   );
}