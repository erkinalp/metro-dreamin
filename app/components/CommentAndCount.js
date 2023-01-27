import React, { useEffect } from 'react';
import Link from 'next/link';
import ReactGA from 'react-ga';
import ReactTooltip from 'react-tooltip';
import classNames from 'classnames';

export const CommentAndCount = ({ systemDocData, isPrivate, onClick = () => {} }) => {
  useEffect(() => {
    ReactTooltip.rebuild();
  }, [isPrivate]);

  return (
    <div className={classNames('CommentAndCount', { 'CommentAndCount--none': !systemDocData.commentsCount })}>
      <button className="CommentAndCount-icon"
            data-tip="Add a comment"
            onClick={onClick}>
        <i className="far fa-comment"></i>
      </button>
      <div className="CommentAndCount-count">
        {systemDocData.commentsCount ? systemDocData.commentsCount : ''}
      </div>
    </div>
  );
}