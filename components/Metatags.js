import React, { useEffect, useState } from 'react';
import Head from 'next/head';

import { LOGO_PNG } from '/util/constants.js';

export function Metatags({
  systemDocData = {},
  title,
  thumbnail,
  description = 'MetroDreamin\' is a web application that allows users to design and visualize their dream transportation systems, and peruse the transit fantasies of other users from around the world.',
}) {
  const [titleToUse, setTitleToUse] = useState(systemDocData.title ? systemDocData.title : '');

  useEffect(() => {
    setTitleToUse(title);
  }, [title])

  const metaTitle = titleToUse ? `MetroDreamin\' | ${titleToUse}` : 'MetroDreamin\' | Build the Public Transit System of Your Dreams';
  const metaDesc = systemDocData.caption ? `MetroDreamin\' | ${systemDocData.caption}` : description;
  const image = thumbnail ? thumbnail : `https://metrodreamin.com${LOGO_PNG}`;

  return (
    <Head>
      <title>{metaTitle}</title>
      <meta property="description" content={metaDesc} />
      {systemDocData && systemDocData.systemId && <link rel="canonical" href={`https://metrodreamin.com/view/${encodeURIComponent(systemDocData.systemId)}`} />}

      <meta name="twitter:card" content={systemDocData && systemDocData.systemId ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:site" content="@metrodreamin" />
      <meta name="twitter:title" content={metaTitle} />
      <meta name="twitter:description" content={metaDesc} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={metaDesc} />

      <meta property="og:title" content={metaTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:image" content={image} />
      <meta property="og:image:alt" content={metaDesc} />
      <meta property="og:type" content="website" />
      <meta property="og:locale" content="en_US" />
    </Head>
  );
}
