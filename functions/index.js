'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors');
const express = require('express');
const app = express();

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: process.env.FIREBASE_CONFIG.databaseURL
});

const authenticate = async (req, res, next) => {
  if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
    req.user = {};
    next();
    return;
  }

  const idToken = req.headers.authorization.split('Bearer ')[1];
  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedIdToken;
    next();
    return;
  } catch(e) {
    req.user = {};
    next();
    return;
  }
};

app.use(authenticate, cors({ origin: true }));

// PUT /v1/stars?viewId={viewId}&action={add|remove}
// Add or remove a starred view
// Requires authentication
app.put('/v1/stars', async (req, res) => {
  if (!req.user || !req.user.uid) {
    res.status(401).send('Unauthorized');
    return;
  }

  const userId = req.user.uid;
  const viewId = `${req.query.viewId}`;
  const action = `${req.query.action}`;

  if (!viewId) {
    res.status(400).send('Bad Request: viewId is a required param');
    return;
  }

  console.log(`Attempting to star View ${viewId} for User ${userId}`);

  try {
    const userDocSnapshot = admin.firestore().doc(`users/${userId}`);
    const userDoc = await userDocSnapshot.get();
    const userDocData = userDoc.data();

    if (!userDocData) {
      res.status(404).send('Error: User doc not found');
      return;
    }

    const viewDocSnapshot = admin.firestore().doc(`views/${viewId}`);
    const viewDoc = await viewDocSnapshot.get();
    const viewDocData = viewDoc.data();

    if (!viewDocData) {
      res.status(404).send('Error: View doc not found');
      return;
    }

    let starredViews = userDocData.starredViews || [];
    let stars = viewDocData.stars || 0;
    switch (action) {
      case 'add':
        if (!starredViews.includes(viewId)) {
          starredViews.push(viewId);
          await userDocSnapshot.update({
            starredViews: starredViews
          });

          await viewDocSnapshot.update({
            stars: stars + 1
          });
        }

        res.status(200).json(`User ${userId} successfully starred ${viewId}`);
        return;
      case 'remove':
        if (starredViews.includes(viewId)) {
          starredViews = starredViews.filter(vId => vId !== viewId);
          await userDocSnapshot.update({
            starredViews: starredViews
          });

          await viewDocSnapshot.update({
            stars: Math.max(stars - 1, 0)
          });
        }

        res.status(200).json(`User ${userId} successfully un-starred ${viewId}`);
        return;
      default:
        res.status(400).send('Bad Request: action must be "add" or "remove"');
        return;
    }
  } catch(e) {
    console.log('Error starring view:', e.message);
    res.sendStatus(500);
    return;
  }
});

// PUT /v1/views/{viewId}?makePrivate={true|false}
// Update a view
// Requires authentication
app.put('/v1/views/:viewId', async (req, res) => {
  if (!req.user || !req.user.uid) {
    res.status(401).send('Unauthorized');
    return;
  }

  const userId = req.user.uid;
  const viewId = req.params.viewId;
  const makePrivate = `${req.query.makePrivate}`;

  if (!viewId) {
    res.status(400).send('Bad Request: viewId is a required param');
    return;
  }

  console.log(`Attempting to update View ${viewId}`);

  try {
    const viewDocSnapshot = admin.firestore().doc(`views/${viewId}`);
    const viewDoc = await viewDocSnapshot.get();
    const viewDocData = viewDoc.data();

    if (!viewDocData) {
      res.status(404).send('Error: View doc not found');
      return;
    }

    if (viewDocData.userId !== userId) {
      res.status(403).send('Error: User does not have access to this viewDoc');
      return;
    }

    switch (makePrivate) {
      case 'true':
        await viewDocSnapshot.update({
          isPrivate: true
        });

        res.status(200).json(`User ${userId} successfully made ${viewId} private`);
        return;
      case 'false':
        await viewDocSnapshot.update({
          isPrivate: false
        });

        res.status(200).json(`User ${userId} successfully made ${viewId} public`);
        return;
      default:
        res.status(400).send('Bad Request: makePrivate must be "true" or "false"');
        return;
    }
  } catch(e) {
    console.log('Error updating view:', e.message);
    res.sendStatus(500);
    return;
  }
});

exports.api = functions.https.onRequest(app);
