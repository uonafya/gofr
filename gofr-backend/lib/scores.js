/* eslint-disable no-param-reassign */
/* eslint-disable no-use-before-define */
/* eslint-disable no-loop-func */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable func-names */
const async = require('async');
const URI = require('urijs');
const levenshtein = require('fast-levenshtein');
const redis = require('redis');

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || '127.0.0.1',
});
const geodist = require('geodist');
const lodash = require('lodash');
const mixin = require('./mixin');
const config = require('./config');
const mcsd = require('./mcsd')();
const logger = require('./winston');

const topOrgName = config.get('mCSD:fakeOrgName');

module.exports = function () {
  return {
    getJurisdictionScore(
      mcsdSource1,
      mcsdSource2,
      mcsdMapped,
      mcsdSource2All,
      mcsdSource1All,
      source1DB,
      source2DB,
      mappingDB,
      recoLevel,
      totalLevels,
      clientId,
      parentConstraint,
      getPotential,
      callback,
    ) {
      const scoreRequestId = `scoreResults${clientId}`;
      const scoreResults = [];
      const matchBrokenCode = config.get('mapping:matchBrokenCode');
      const maxSuggestions = config.get('matchResults:maxSuggestions');
      const topOrgId1 = mixin.getTopOrgId(source1DB, 'Location');

      if (mcsdSource2.total == 0) {
        logger.error('No Source2 data found for this orgunit');
        return callback();
      }
      if (mcsdSource1.total == 0) {
        logger.error('No Source1 data found');
        return callback();
      }
      const totalSource1Records = mcsdSource1.entry.length;
      const totalSource2Records = mcsdSource2.entry.length;
      let count = 0;
      let countSaved = 0;
      updateDataSavingPercent('initialize');
      const ignore = [];
      let source2ParentNames = {};
      let source2MappedParentIds = {};
      let source2MappedParentNames = {};
      const source2Unmatched = [];
      const source2MatchedIDs = [];
      const matchesToSave = [];
      let totalAllMapped = mcsdMapped.entry.length;
      let totalAllNoMatch = 0;
      let totalAllIgnored = 0;
      let totalAllFlagged = 0;
      let useCachedParents = false;

      redisClient.get(`parents${recoLevel}${source2DB}`, (error, results) => {
        if (error) {
          logger.error(error);
          logger.error(`An error has occured while getting parents for ${source2DB}`);
        } else if (results) {
          try {
            results = JSON.parse(results);
            useCachedParents = true;
            source2MappedParentIds = results.source2MappedParentIds;
            source2MappedParentNames = results.source2MappedParentNames;
            source2ParentNames = results.source2ParentNames;
          } catch (err) {
            logger.error(err);
          }
        }
        useCachedParents = false;
        if (!useCachedParents) {
          logger.info('Populating parents');
          for (const entry of mcsdSource2.entry) {
            if (entry.resource.hasOwnProperty('partOf')) {
              source2ParentNames[entry.resource.id] = [];
              source2MappedParentIds[entry.resource.id] = [];
              source2MappedParentNames[entry.resource.id] = [];
              const entityParent = entry.resource.partOf.reference;
              mcsd.getLocationParentsFromData(entityParent, mcsdSource2All, 'all', (parents) => {
                // lets make sure that we use the mapped parent for comparing against Source1
                async.each(parents, (parent, parentCallback) => {
                  const parentIdentifier = URI(config.get('mCSD:url'))
                    .segment(source2DB)
                    .segment('Location')
                    .segment(parent.id)
                    .toString()
                  this.matchStatus(mcsdMapped, parentIdentifier, (mapped) => {
                    if (mapped) {
                      source2MappedParentIds[entry.resource.id].push(mapped.resource.id);
                      source2MappedParentNames[entry.resource.id].push(mapped.resource.name);
                      source2ParentNames[entry.resource.id].push(parent.text);
                    } else {
                      source2MappedParentIds[entry.resource.id].push(parent.id);
                      source2ParentNames[entry.resource.id].push(parent.text);
                    }
                    parentCallback();
                  });
                }, () => {
                  count += 1;
                  const percent = parseFloat((count * 100 / totalSource2Records).toFixed(1));
                  const scoreResData = JSON.stringify({
                    status: '2/3 - Scanning Source2 Location Parents',
                    error: null,
                    percent,
                    stage: 'not last',
                  });
                  redisClient.set(scoreRequestId, scoreResData, 'EX', 1200);
                  if (count === mcsdSource2.entry.length) {
                    const source2Parents = {};
                    source2Parents.source2MappedParentIds = source2MappedParentIds;
                    source2Parents.source2MappedParentNames = source2MappedParentNames;
                    source2Parents.source2ParentNames = source2ParentNames;
                    redisClient.set(`parents${recoLevel}${source2DB}`, JSON.stringify(source2Parents), 'EX', 1200);
                    logger.info('Done populating parents');
                  }
                });
              });
            }
          }
        }
        logger.info('Calculating scores now');
        count = 0;
        async.eachSeries(mcsdSource1.entry, (source1Entry, source1Callback) => {
          // check if this Source1 Orgid is mapped
          const source1Id = source1Entry.resource.id;
          let matchBroken = false;
          if (source1Entry.resource.meta.hasOwnProperty('tag')) {
            const matchBrokenTag = source1Entry.resource.meta.tag.find(tag => tag.code == matchBrokenCode);
            if (matchBrokenTag) {
              matchBroken = true;
            }
          }
          const source1Identifier = URI(config.get('mCSD:url'))
            .segment(source1DB)
            .segment('Location')
            .segment(source1Id)
            .toString();
          this.matchStatus(mcsdMapped, source1Identifier, (match) => {
            // if this Source1 Org is already mapped
            if (match) {
              const noMatchCode = config.get('mapping:noMatchCode');
              const ignoreCode = config.get('mapping:ignoreCode');
              const flagCode = config.get('mapping:flagCode');
              const flagCommentCode = config.get('mapping:flagCommentCode');
              const matchCommentsCode = config.get('mapping:matchCommentsCode');
              let entityParent = null;
              if (source1Entry.resource.hasOwnProperty('partOf')) {
                entityParent = source1Entry.resource.partOf.reference;
              }
              mcsd.getLocationParentsFromData(entityParent, mcsdSource1All, 'names', (source1Parents) => {
                const source1IdHierarchy = mixin.createIdHierarchy(mcsdSource1, source1Entry.resource.id);
                const thisRanking = {};
                thisRanking.source1 = {
                  name: source1Entry.resource.name,
                  parents: source1Parents.slice(0, source1Parents.length - 1),
                  id: source1Entry.resource.id,
                  source1IdHierarchy,
                };
                thisRanking.potentialMatches = {};
                thisRanking.exactMatch = {};
                let noMatch = null;
                let ignorered = null;
                let flagged = null;
                let matchCommentsTag = {};
                if (match.resource.meta.hasOwnProperty('tag')) {
                  noMatch = match.resource.meta.tag.find(tag => tag.code == noMatchCode);
                  ignorered = match.resource.meta.tag.find(tag => tag.code == ignoreCode);
                  flagged = match.resource.meta.tag.find(tag => tag.code == flagCode);
                  matchCommentsTag = match.resource.meta.tag.find(tag => tag.code == matchCommentsCode);
                }
                if (flagged) {
                  totalAllFlagged += 1;
                  thisRanking.source1.tag = 'flagged';
                  const flagComment = match.resource.meta.tag.find(tag => tag.code == flagCommentCode);
                  if (flagComment) {
                    thisRanking.source1.flagComment = flagComment.display;
                  }
                }
                // in case this is marked as no match then process next Source1
                if (noMatch || ignorered) {
                  if (noMatch) {
                    totalAllNoMatch += 1;
                    thisRanking.source1.tag = 'noMatch';
                  }
                  if (ignorered) {
                    totalAllIgnored += 1;
                    thisRanking.source1.tag = 'ignore';
                  }
                  scoreResults.push(thisRanking);
                  count += 1;
                  const percent = parseFloat((count * 100 / totalSource1Records).toFixed(1));
                  const scoreResData = JSON.stringify({
                    status: '3/3 - Running Automatching',
                    error: null,
                    percent,
                    stage: 'last',
                  });
                  redisClient.set(scoreRequestId, scoreResData);
                  updateDataSavingPercent();
                  return source1Callback();
                }
                const matchedSource2Id = mixin.getIdFromIdentifiers(match.resource.identifier, 'https://digitalhealth.intrahealth.org/source2');
                const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, matchedSource2Id);
                const matchInSource2 = mcsdSource2.entry.find(entry => entry.resource.id == matchedSource2Id);

                if (matchInSource2) {
                  source2MatchedIDs.push(matchedSource2Id);
                  const matchComments = [];
                  if (matchCommentsTag && matchCommentsTag.hasOwnProperty('display')) {
                    matchComments.push(matchCommentsTag.display);
                  }
                  thisRanking.exactMatch = {
                    name: matchInSource2.resource.name,
                    parents: source2ParentNames[matchedSource2Id].slice(0, source2ParentNames[matchedSource2Id].length - 1),
                    mappedParentName: source2MappedParentNames[matchedSource2Id][0],
                    id: matchedSource2Id,
                    source2IdHierarchy,
                    matchComments,
                  };
                }
                scoreResults.push(thisRanking);
                count += 1;
                const percent = parseFloat((count * 100 / totalSource1Records).toFixed(2));
                const scoreResData = JSON.stringify({
                  status: '3/3 - Running Automatching',
                  error: null,
                  percent,
                  stage: 'last',
                });
                redisClient.set(scoreRequestId, scoreResData, 'EX', 1200);
                updateDataSavingPercent();
                return source1Callback();
              });
            } else { // if not mapped
              const source1Name = source1Entry.resource.name;
              let source1Parents = [];
              const source1ParentNames = [];
              const source1ParentIds = [];
              let source1ParentReceived;
              if (source1Entry.resource.hasOwnProperty('partOf')) {
                const entityParent = source1Entry.resource.partOf.reference;
                source1ParentReceived = new Promise((resolve) => {
                  mcsd.getLocationParentsFromData(entityParent, mcsdSource1All, 'all', (parents) => {
                    source1Parents = parents;
                    let fakeLocationExist = false;
                    async.eachSeries(parents, (parent, nxtParent) => {
                      if (parent.id == topOrgId1) {
                        fakeLocationExist = true;
                      }
                      source1ParentNames.push(
                        parent.text,
                      );
                      source1ParentIds.push(
                        parent.id,
                      );
                      return nxtParent();
                    }, () => {
                      if (!fakeLocationExist) {
                        source1ParentNames.push(topOrgName);
                        source1ParentIds.push(topOrgId1);
                        source1Parents.push({
                          id: topOrgId1,
                          text: topOrgName,
                        });
                      }
                      resolve();
                    });
                  });
                });
              } else {
                source1ParentReceived = Promise.resolve([]);
              }
              source1ParentReceived.then(() => {
                const source1IdHierarchy = mixin.createIdHierarchy(mcsdSource1, source1Entry.resource.id);
                const thisRanking = {};
                thisRanking.source1 = {
                  name: source1Name,
                  parents: source1ParentNames.slice(0, source1Parents.length - 1),
                  id: source1Entry.resource.id,
                  source1IdHierarchy,
                };
                thisRanking.potentialMatches = {};
                thisRanking.exactMatch = {};
                let source2Filtered;
                if (parentConstraint.enabled) {
                  source2Filtered = mcsdSource2.entry.filter(entry => source2MappedParentIds[entry.resource.id].includes(mixin.getMappingId(source1ParentIds[0])));
                } else {
                  source2Filtered = mcsdSource2.entry;
                }
                let noNeedToSave = true;
                const promises2 = [];
                for (let x = 0; x < source2Filtered.length; x++) {
                  const source2Entry = source2Filtered[x];
                  promises2.push(new Promise((resolve) => {
                    const matchComments = [];
                    const id = source2Entry.resource.id;
                    const source2Identifier = URI(config.get('mCSD:url'))
                      .segment(source2DB)
                      .segment('Location')
                      .segment(id)
                      .toString();
                    const ignoreThis = ignore.find(toIgnore => toIgnore == id);
                    if (ignoreThis) {
                      return resolve();
                    }
                    // check if this is already mapped
                    this.matchStatus(mcsdMapped, source2Identifier, (mapped) => {
                      if (mapped) {
                        ignore.push(source2Entry.resource.id);
                        return resolve();
                      }
                      let parentsDiffer = false;
                      if (!source2MappedParentIds[source2Entry.resource.id].includes(mixin.getMappingId(source1ParentIds[0])) && recoLevel != 2) {
                        parentsDiffer = true;
                        matchComments.push('Parents differ');
                      }
                      const source2Name = source2Entry.resource.name;
                      const source2Id = source2Entry.resource.id;

                      const lev = levenshtein.get(source2Name.toLowerCase(), source1Name.toLowerCase());
                      // when parent constraint is On then automatch by name is also enabled by default
                      // when parent constraint is off then check if name automatch is also on
                      if (lev == 0
                        && !matchBroken
                        && (parentsDiffer == false || (parentConstraint.enabled == false && parentConstraint.nameAutoMatch == true) || recoLevel == 2)
                      ) {
                        const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                        ignore.push(source2Entry.resource.id);
                        thisRanking.exactMatch = {
                          name: source2Name,
                          parents: source2ParentNames[source2Id].slice(0, source2ParentNames[source2Id].length - 1),
                          mappedParentName: source2MappedParentNames[source2Id][0],
                          id: source2Entry.resource.id,
                          source2IdHierarchy,
                          matchComments,
                        };
                        thisRanking.potentialMatches = {};
                        noNeedToSave = false;
                        matchesToSave.push({
                          source1Id,
                          source2Id: source2Entry.resource.id,
                          source2IdHierarchy,
                          source1DB,
                          source2DB,
                          mappingDB,
                          recoLevel,
                          totalLevels,
                        });
                        totalAllMapped += 1;
                        source2MatchedIDs.push(source2Entry.resource.id);
                        // we will need to break here and start processing nxt Source1
                        return resolve();
                      }
                      if (lev == 0) {
                        if (!getPotential) {
                          return resolve();
                        }
                        const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                        if (!thisRanking.potentialMatches.hasOwnProperty('0')) {
                          thisRanking.potentialMatches['0'] = [];
                        }
                        thisRanking.potentialMatches['0'].push({
                          name: source2Name,
                          parents: source2ParentNames[source2Id].slice(0, source2ParentNames[source2Id].length - 1), // slice to remove fake topOrgId
                          mappedParentName: source2MappedParentNames[source2Id][0],
                          id: source2Entry.resource.id,
                          source2IdHierarchy,
                        });
                        return resolve();
                      }
                      if (Object.keys(thisRanking.exactMatch).length == 0 && getPotential) {
                        if (thisRanking.potentialMatches.hasOwnProperty(lev) || Object.keys(thisRanking.potentialMatches).length < maxSuggestions) {
                          const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                          if (!thisRanking.potentialMatches.hasOwnProperty(lev)) {
                            thisRanking.potentialMatches[lev] = [];
                          }
                          thisRanking.potentialMatches[lev].push({
                            name: source2Name,
                            parents: source2ParentNames[source2Id].slice(0, source2ParentNames[source2Id].length - 1),
                            mappedParentName: source2MappedParentNames[source2Id][0],
                            id: source2Entry.resource.id,
                            source2IdHierarchy,
                          });
                        } else {
                          const existingLev = Object.keys(thisRanking.potentialMatches);
                          const max = lodash.max(existingLev);
                          if (lev < max) {
                            const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                            delete thisRanking.potentialMatches[max];
                            thisRanking.potentialMatches[lev] = [];
                            thisRanking.potentialMatches[lev].push({
                              name: source2Name,
                              parents: source2ParentNames[source2Id].slice(0, source2ParentNames[source2Id].length - 1), // slice to remove fake topOrgId
                              mappedParentName: source2MappedParentNames[source2Id][0],
                              id: source2Entry.resource.id,
                              source2IdHierarchy,
                            });
                          }
                        }
                      }
                      return resolve();
                    });
                  }));
                }
                Promise.all(promises2).then(() => {
                  scoreResults.push(thisRanking);
                  count += 1;
                  const percent = parseFloat((count * 100 / totalSource1Records).toFixed(1));
                  const scoreResData = JSON.stringify({
                    status: '3/3 - Running Automatching',
                    error: null,
                    percent,
                    stage: 'last',
                  });
                  redisClient.set(scoreRequestId, scoreResData, 'EX', 1200);
                  if (noNeedToSave) {
                    updateDataSavingPercent();
                  }
                  return source1Callback();
                });
              }).catch((err) => {
                logger.error(err);
              });
            }
          });
        }, () => {
          async.each(mcsdSource2.entry, (entry, nxtEntry) => {
            if (!source2MatchedIDs.includes(entry.resource.id)) {
              const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, entry.resource.id);
              source2Unmatched.push({
                id: entry.resource.id,
                source2IdHierarchy,
                name: entry.resource.name,
                parents: source2ParentNames[entry.resource.id].slice(0, source2ParentNames[entry.resource.id].length - 1),
                mappedParentName: source2MappedParentNames[entry.resource.id][0],
              });
            }
            return nxtEntry();
          }, () => {
            mcsdSource2All = {};
            callback(scoreResults, source2Unmatched, totalAllMapped, totalAllFlagged, totalAllIgnored, totalAllNoMatch);
            let timeout = 0;
            if (matchesToSave.length > 1000) {
              timeout = 2000;
            }
            setTimeout(() => {
              const promises = [];
              for (const match of matchesToSave) {
                promises.push(new Promise((resolve) => {
                  mcsd.saveMatch(match.source1Id, match.source2Id, match.source1DB, match.source2DB, match.mappingDB, match.recoLevel, match.totalLevels, 'match', true, false, () => {
                    updateDataSavingPercent();
                    resolve();
                  });
                }));
              }
              Promise.all(promises).then(() => {
                updateDataSavingPercent('done');
              });
            }, timeout);
          });
        });
      });

      function updateDataSavingPercent(status) {
        if (status == 'initialize') {
          countSaved = 0;
        } else if (status == 'done') {
          countSaved = totalSource1Records;
        } else {
          countSaved += 1;
        }
        const percent = parseFloat((countSaved * 100 / totalSource1Records).toFixed(1));
        const scoreSavingStatId = `scoreSavingStatus${clientId}`;
        const scoreSavingData = JSON.stringify({
          status: '1/1 - Saving Data',
          error: null,
          percent,
        });
        redisClient.set(scoreSavingStatId, scoreSavingData, 'EX', 1200);
      }
    },

    getBuildingsScores(
      mcsdSource1,
      mcsdSource2,
      mcsdMapped,
      mcsdSource2All,
      mcsdSource1All,
      source1DB,
      source2DB,
      mappingDB,
      recoLevel,
      totalLevels,
      clientId,
      parentConstraint,
      getPotential,
      callback,
    ) {
      const scoreRequestId = `scoreResults${clientId}`;
      const scoreResults = [];
      const matchBrokenCode = config.get('mapping:matchBrokenCode');
      const maxSuggestions = config.get('matchResults:maxSuggestions');
      const topOrgId1 = mixin.getTopOrgId(source1DB, 'Location');

      if (mcsdSource2.total == 0) {
        logger.error('No Source2 data found for this orgunit');
        return callback();
      }
      if (mcsdSource1.total == 0) {
        logger.error('No Source1 data found');
        return callback();
      }
      const totalSource1Records = mcsdSource1.entry.length;
      const totalSource2Records = mcsdSource2.entry.length;
      const ignore = [];
      let count = 0;
      let countSaved = 0;
      updateDataSavingPercent('initialize');
      let source2ParentNames = {};
      let source2MappedParentIds = {};
      let source2MappedParentNames = {};
      const source2LevelMappingStatus = {};
      const source2Unmatched = [];
      const source2MatchedIDs = [];
      const matchesToSave = [];
      let totalAllMapped = mcsdMapped.entry.length;
      let totalAllNoMatch = 0;
      let totalAllIgnored = 0;
      let totalAllFlagged = 0;
      let useCachedParents = false;

      redisClient.get(`parents${recoLevel}${source2DB}`, (error, results) => {
        if (error) {
          logger.error(error);
          logger.error(`An error has occured while getting parents for ${source2DB}`);
        } else if (results) {
          try {
            results = JSON.parse(results);
            useCachedParents = true;
            source2MappedParentIds = results.source2MappedParentIds;
            source2MappedParentNames = results.source2MappedParentNames;
            source2ParentNames = results.source2ParentNames;
          } catch (err) {
            logger.error(err);
          }
        }

        if (!useCachedParents) {
          logger.info('Populating parents');
          for (let i = 0, len = mcsdSource2.entry.length; i < len; i++) {
            const entry = mcsdSource2.entry[i];
            const source2Identifier = URI(config.get('mCSD:url'))
              .segment(source2DB)
              .segment('Location')
              .segment(entry.resource.id)
              .toString();
            source2LevelMappingStatus[entry.resource.id] = [];
            this.matchStatus(mcsdMapped, source2Identifier, (mapped) => {
              if (mapped) {
                source2LevelMappingStatus[entry.resource.id] = true;
              } else {
                source2LevelMappingStatus[entry.resource.id] = false;
              }
            });
            if (entry.resource.hasOwnProperty('partOf')) {
              source2ParentNames[entry.resource.id] = [];
              source2MappedParentIds[entry.resource.id] = [];
              source2MappedParentNames[entry.resource.id] = [];
              const entityParent = entry.resource.partOf.reference;
              mcsd.getLocationParentsFromData(entityParent, mcsdSource2All, 'all', (parents) => {
                // lets make sure that we use the mapped parent for comparing against Source1
                async.each(parents, (parent, parentCallback) => {
                  const parentIdentifier = URI(config.get('mCSD:url'))
                    .segment(source2DB)
                    .segment('Location')
                    .segment(parent.id)
                    .toString();
                  this.matchStatus(mcsdMapped, parentIdentifier, (mapped) => {
                    if (mapped) {
                      source2MappedParentIds[entry.resource.id].push(mapped.resource.id);
                      source2MappedParentNames[entry.resource.id].push(mapped.resource.name);
                      source2ParentNames[entry.resource.id].push(parent.text);
                    } else {
                      source2MappedParentIds[entry.resource.id].push(parent.id);
                      source2ParentNames[entry.resource.id].push(parent.text);
                    }
                    parentCallback();
                  });
                }, () => {
                  count += 1;
                  const percent = parseFloat((count * 100 / totalSource2Records).toFixed(1));
                  const scoreResData = JSON.stringify({
                    status: '2/3 - Scanning Source2 Location Parents',
                    error: null,
                    percent,
                    stage: 'not last',
                  });
                  redisClient.set(scoreRequestId, scoreResData, 'EX', 1200);
                  if (count === mcsdSource2.entry.length) {
                    const source2Parents = {};
                    source2Parents.source2MappedParentIds = source2MappedParentIds;
                    source2Parents.source2MappedParentNames = source2MappedParentNames;
                    source2Parents.source2ParentNames = source2ParentNames;
                    redisClient.set(`parents${recoLevel}${source2DB}`, JSON.stringify(source2Parents), 'EX', 1200);
                    logger.info('Done populating parents');
                  }
                });
              });
            }
          }
        }

        // clear mcsdSource2All
        mcsdSource2All = {};
        logger.info('Calculating scores now');
        count = 0;
        async.eachSeries(mcsdSource1.entry, (source1Entry, source1Callback) => {
          // check if this Source1 Orgid is mapped
          const source1Id = source1Entry.resource.id;
          const source1Identifiers = source1Entry.resource.identifier;
          let source1Latitude = null;
          let source1Longitude = null;
          if (source1Entry.resource.hasOwnProperty('position')) {
            source1Latitude = source1Entry.resource.position.latitude;
            source1Longitude = source1Entry.resource.position.longitude;
          }

          let matchBroken = false;
          if (source1Entry.resource.meta.hasOwnProperty('tag')) {
            const matchBrokenTag = source1Entry.resource.meta.tag.find(tag => tag.code == matchBrokenCode);
            if (matchBrokenTag) {
              matchBroken = true;
            }
          }
          const source1Identifier = URI(config.get('mCSD:url'))
            .segment(source1DB)
            .segment('Location')
            .segment(source1Id)
            .toString();
          this.matchStatus(mcsdMapped, source1Identifier, (match) => {
            // if this Source1 Org is already mapped
            let thisRanking = {};
            if (match) {
              const noMatchCode = config.get('mapping:noMatchCode');
              const ignoreCode = config.get('mapping:ignoreCode');
              const flagCode = config.get('mapping:flagCode');
              const flagCommentCode = config.get('mapping:flagCommentCode');
              const matchCommentsCode = config.get('mapping:matchCommentsCode');
              let entityParent = null;
              if (source1Entry.resource.hasOwnProperty('partOf')) {
                entityParent = source1Entry.resource.partOf.reference;
              }
              mcsd.getLocationParentsFromData(entityParent, mcsdSource1All, 'names', (source1Parents) => {
                const source1BuildingId = source1Entry.resource.id;
                const source1IdHierarchy = mixin.createIdHierarchy(mcsdSource1, source1BuildingId);
                thisRanking.source1 = {
                  name: source1Entry.resource.name,
                  parents: source1Parents.slice(0, source1Parents.length - 1),
                  lat: source1Latitude,
                  long: source1Longitude,
                  id: source1BuildingId,
                  source1IdHierarchy,
                };
                thisRanking.potentialMatches = {};
                thisRanking.exactMatch = {};
                let noMatch = null;
                let ignorered = null;
                let flagged = null;
                let matchCommentsTag = {};
                if (match.resource.meta.hasOwnProperty('tag')) {
                  noMatch = match.resource.meta.tag.find(tag => tag.code == noMatchCode);
                  ignorered = match.resource.meta.tag.find(tag => tag.code == ignoreCode);
                  flagged = match.resource.meta.tag.find(tag => tag.code == flagCode);
                  matchCommentsTag = match.resource.meta.tag.find(tag => tag.code == matchCommentsCode);
                }
                if (flagged) {
                  totalAllFlagged += 1;
                  thisRanking.source1.tag = 'flagged';
                  const flagComment = match.resource.meta.tag.find(tag => tag.code == flagCommentCode);
                  if (flagComment) {
                    thisRanking.source1.flagComment = flagComment.display;
                  }
                }
                // in case this is marked as no match then process next Source1
                if (noMatch || ignorered) {
                  if (noMatch) {
                    totalAllNoMatch += 1;
                    thisRanking.source1.tag = 'noMatch';
                  }
                  if (ignorered) {
                    totalAllIgnored += 1;
                    thisRanking.source1.tag = 'ignore';
                  }
                  scoreResults.push(thisRanking);
                  count += 1;
                  const percent = parseFloat((count * 100 / totalSource1Records).toFixed(1));
                  const scoreResData = JSON.stringify({
                    status: '3/3 - Running Automatching',
                    error: null,
                    percent,
                    stage: 'last',
                  });
                  redisClient.set(scoreRequestId, scoreResData, 'EX', 1200);
                  updateDataSavingPercent();
                  return source1Callback();
                }

                const matchedSource2Id = mixin.getIdFromIdentifiers(match.resource.identifier, 'https://digitalhealth.intrahealth.org/source2');
                const matchInSource2 = mcsdSource2.entry.find(entry => entry.resource.id == matchedSource2Id);
                if (matchInSource2) {
                  const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, matchedSource2Id);
                  source2MatchedIDs.push(matchedSource2Id);
                  const matchComments = [];
                  if (matchCommentsTag && matchCommentsTag.hasOwnProperty('display')) {
                    matchComments.push(matchCommentsTag.display);
                  }
                  thisRanking.exactMatch = {
                    name: matchInSource2.resource.name,
                    parents: source2ParentNames[matchedSource2Id],
                    mappedParentName: source2MappedParentNames[matchedSource2Id][0],
                    id: matchedSource2Id,
                    source2IdHierarchy,
                    matchComments,
                  };
                }
                scoreResults.push(thisRanking);
                count += 1;
                const percent = parseFloat((count * 100 / totalSource1Records).toFixed(1));
                const scoreResData = JSON.stringify({
                  status: '3/3 - Running Automatching',
                  error: null,
                  percent,
                  stage: 'last',
                });
                redisClient.set(scoreRequestId, scoreResData, 'EX', 1200);
                updateDataSavingPercent();
                return source1Callback();
              });
            } else { // if not mapped
              const source1Name = source1Entry.resource.name;
              const source1ParentNames = [];
              const source1ParentIds = [];
              let source1Parents;
              let source1ParentReceived;
              if (source1Entry.resource.hasOwnProperty('partOf')) {
                const entityParent = source1Entry.resource.partOf.reference;
                source1ParentReceived = new Promise((resolve) => {
                  mcsd.getLocationParentsFromData(entityParent, mcsdSource1All, 'all', (parents) => {
                    source1Parents = parents;
                    for (const parent of parents) {
                      source1ParentNames.push(parent.text);
                      source1ParentIds.push(parent.id);
                    }
                    resolve();
                  });
                });
              } else {
                source1ParentReceived = Promise.resolve([]);
              }
              source1ParentReceived.then(() => {
                thisRanking = {};
                const source1BuildingId = source1Entry.resource.id;
                let parents;
                if (source1Parents[source1Parents.length - 1].id == topOrgId1) {
                  parents = source1ParentNames.slice(0, source1Parents.length - 1);
                } else {
                  parents = source1ParentNames;
                }
                const source1IdHierarchy = mixin.createIdHierarchy(mcsdSource1, source1BuildingId);
                thisRanking.source1 = {
                  name: source1Name,
                  parents,
                  lat: source1Latitude,
                  long: source1Longitude,
                  id: source1BuildingId,
                  source1IdHierarchy,
                };
                thisRanking.potentialMatches = {};
                thisRanking.exactMatch = {};
                let source2Filtered;
                if (parentConstraint.enabled) {
                  source2Filtered = mcsdSource2.entry.filter(entry => source2MappedParentIds[entry.resource.id].includes(mixin.getMappingId(source1ParentIds[0])));
                } else {
                  source2Filtered = mcsdSource2.entry;
                }

                let noNeedToSave = true;
                async.each(source2Filtered, (source2Entry, source2Callback) => {
                  if (Object.keys(thisRanking.exactMatch).length > 0) {
                    return source2Callback();
                  }
                  const matchComments = [];
                  const { id } = source2Entry.resource;
                  const source2Identifiers = source2Entry.resource.identifier;
                  // if this source2 is already mapped then skip it
                  const ignoreThis = ignore.find(toIgnore => toIgnore == id);
                  if (ignoreThis) {
                    return source2Callback();
                  }
                  // if this is already mapped then ignore
                  if (source2LevelMappingStatus[id]) {
                    return source2Callback();
                  }
                  let parentsDiffer = false;
                  if (!source2MappedParentIds[source2Entry.resource.id].includes(mixin.getMappingId(source1ParentIds[0])) && recoLevel != 2) {
                    parentsDiffer = true;
                    matchComments.push('Parents differ');
                  }
                  const source2Name = source2Entry.resource.name;
                  let source2Latitude = null;
                  let source2Longitude = null;
                  if (source2Entry.resource.hasOwnProperty('position')) {
                    source2Latitude = source2Entry.resource.position.latitude;
                    source2Longitude = source2Entry.resource.position.longitude;
                  }
                  let dist = '';
                  if (source2Latitude && source2Longitude) {
                    dist = geodist({
                      source2Latitude,
                      source2Longitude,
                    }, {
                      source1Latitude,
                      source1Longitude,
                    }, {
                      exact: false,
                      unit: 'miles',
                    });
                    if (dist !== 0) {
                      matchComments.push('Coordinates differ');
                    }
                  } else {
                    matchComments.push('Coordinates missing');
                  }
                  // check if IDS are the same and mark as exact match
                  const matchingIdent = source2Identifiers.find(source2Ident => source1Identifiers.find(source1Ident => source2Ident.value == source1Ident.value));
                  if (matchingIdent && !matchBroken) {
                    const lev = levenshtein.get(source2Name.toLowerCase(), source1Name.toLowerCase());
                    if (lev != 0) {
                      matchComments.push('Names differ');
                    }
                    ignore.push(source2Entry.resource.id);
                    const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                    thisRanking.exactMatch = {
                      name: source2Name,
                      parents: source2ParentNames[source2Entry.resource.id].slice(0, source2ParentNames[source2Entry.resource.id].length - 1),
                      mappedParentName: source2MappedParentNames[source2Entry.resource.id][0],
                      lat: source2Latitude,
                      long: source2Longitude,
                      geoDistance: dist,
                      matchComments,
                      id: source2Entry.resource.id,
                      source2IdHierarchy,
                    };
                    thisRanking.potentialMatches = {};

                    noNeedToSave = false;
                    matchesToSave.push({
                      source1Id,
                      source2Id: source2Entry.resource.id,
                      source1DB,
                      source2DB,
                      mappingDB,
                      recoLevel,
                      totalLevels,
                    });
                    totalAllMapped += 1;
                    source2MatchedIDs.push(source2Entry.resource.id);
                    return source2Callback();
                  }
                  if (matchingIdent && matchBroken && getPotential) {
                    const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                    if (!thisRanking.potentialMatches.hasOwnProperty('0')) {
                      thisRanking.potentialMatches['0'] = [];
                    }
                    thisRanking.potentialMatches['0'].push({
                      name: source2Name,
                      parents: source2ParentNames[source2Entry.resource.id].slice(0, source2ParentNames[source2Entry.resource.id].length - 1),
                      mappedParentName: source2MappedParentNames[source2Entry.resource.id][0],
                      lat: source2Latitude,
                      long: source2Longitude,
                      geoDistance: dist,
                      id: source2Entry.resource.id,
                      source2IdHierarchy,
                    });
                    return source2Callback();
                  }

                  matchComments.push('ID differ');

                  const lev = levenshtein.get(source2Name.toLowerCase(), source1Name.toLowerCase());

                  if (lev == 0 && !matchBroken
                    && (parentsDiffer == false || (parentConstraint.enabled == false && parentConstraint.nameAutoMatch == true) || recoLevel == 2)
                  ) {
                    const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                    ignore.push(source2Entry.resource.id);
                    thisRanking.exactMatch = {
                      name: source2Name,
                      parents: source2ParentNames[source2Entry.resource.id].slice(0, source2ParentNames[source2Entry.resource.id].length - 1),
                      mappedParentName: source2MappedParentNames[source2Entry.resource.id][0],
                      lat: source2Latitude,
                      long: source2Longitude,
                      geoDistance: dist,
                      matchComments,
                      id: source2Entry.resource.id,
                      source2IdHierarchy,
                    };
                    thisRanking.potentialMatches = {};
                    noNeedToSave = false;
                    matchesToSave.push({
                      source1Id,
                      source2Id: source2Entry.resource.id,
                      source1DB,
                      source2DB,
                      mappingDB,
                      recoLevel,
                      totalLevels,
                    });
                    totalAllMapped += 1;
                    source2MatchedIDs.push(source2Entry.resource.id);
                    return source2Callback();
                  }

                  if (getPotential) {
                    // use dictionary
                    const dictionary = config.get('dictionary');
                    for (const abbr in dictionary) {
                      let replacedSource1 = source1Name.replace(abbr, '');
                      replacedSource1 = replacedSource1.replace(dictionary[abbr], '').trim();
                      let replacedSource2 = source2Name.replace(abbr, '');
                      replacedSource2 = replacedSource2.replace(dictionary[abbr], '').trim();
                      if (replacedSource1.toLowerCase() === replacedSource2.toLowerCase()) {
                        const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                        if (!thisRanking.potentialMatches.hasOwnProperty('0')) {
                          thisRanking.potentialMatches['0'] = [];
                        }
                        thisRanking.potentialMatches['0'].push({
                          name: source2Name,
                          parents: source2ParentNames[source2Entry.resource.id].slice(0, source2ParentNames[source2Entry.resource.id].length - 1),
                          mappedParentName: source2MappedParentNames[source2Entry.resource.id][0],
                          lat: source2Latitude,
                          long: source2Longitude,
                          geoDistance: dist,
                          id: source2Entry.resource.id,
                          source2IdHierarchy,
                        });
                        return source2Callback();
                      }
                    }
                  }

                  if (lev == 0 && getPotential) {
                    const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                    if (!thisRanking.potentialMatches.hasOwnProperty('0')) {
                      thisRanking.potentialMatches['0'] = [];
                    }
                    thisRanking.potentialMatches['0'].push({
                      name: source2Name,
                      parents: source2ParentNames[source2Entry.resource.id].slice(0, source2ParentNames[source2Entry.resource.id].length - 1),
                      mappedParentName: source2MappedParentNames[source2Entry.resource.id][0],
                      lat: source2Latitude,
                      long: source2Longitude,
                      geoDistance: dist,
                      id: source2Entry.resource.id,
                      source2IdHierarchy,
                    });
                    return source2Callback();
                  }
                  if (Object.keys(thisRanking.exactMatch).length == 0 && getPotential) {
                    if (thisRanking.potentialMatches.hasOwnProperty(lev) || Object.keys(thisRanking.potentialMatches).length < maxSuggestions) {
                      const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                      if (!thisRanking.potentialMatches.hasOwnProperty(lev)) {
                        thisRanking.potentialMatches[lev] = [];
                      }
                      thisRanking.potentialMatches[lev].push({
                        name: source2Name,
                        parents: source2ParentNames[source2Entry.resource.id].slice(0, source2ParentNames[source2Entry.resource.id].length - 1),
                        mappedParentName: source2MappedParentNames[source2Entry.resource.id][0],
                        lat: source2Latitude,
                        long: source2Longitude,
                        geoDistance: dist,
                        id: source2Entry.resource.id,
                        source2IdHierarchy,
                      });
                    } else {
                      const existingLev = Object.keys(thisRanking.potentialMatches);
                      const max = lodash.max(existingLev);
                      if (lev < max) {
                        const source2IdHierarchy = mixin.createIdHierarchy(mcsdSource2, source2Entry.resource.id);
                        delete thisRanking.potentialMatches[max];
                        thisRanking.potentialMatches[lev] = [];
                        thisRanking.potentialMatches[lev].push({
                          name: source2Name,
                          parents: source2ParentNames[source2Entry.resource.id].slice(0, source2ParentNames[source2Entry.resource.id].length - 1),
                          mappedParentName: source2MappedParentNames[source2Entry.resource.id][0],
                          lat: source2Latitude,
                          long: source2Longitude,
                          geoDistance: dist,
                          id: source2Entry.resource.id,
                          source2IdHierarchy,
                        });
                      }
                    }
                  }
                  return source2Callback();
                }, () => {
                  scoreResults.push(thisRanking);
                  count += 1;
                  const percent = parseFloat((count * 100 / totalSource1Records).toFixed(1));
                  const scoreResData = JSON.stringify({
                    status: '3/3 - Running Automatching',
                    error: null,
                    percent,
                    stage: 'last',
                  });
                  redisClient.set(scoreRequestId, scoreResData, 'EX', 1200);
                  if (noNeedToSave) {
                    updateDataSavingPercent();
                  }
                  return source1Callback();
                });
              }).catch((err) => {
                logger.error(err);
              });
            }
          });
        }, () => {
          if (getPotential) {
            mcsdSource2All = {};
            callback(scoreResults, source2Unmatched, totalAllMapped, totalAllFlagged, totalAllIgnored, totalAllNoMatch);
            async.eachSeries(matchesToSave, (match, nxtMatch) => {
              mcsd.saveMatch(match.source1Id, match.source2Id, match.source1DB, match.source2DB, match.mappingDB, match.recoLevel, match.totalLevels, 'match', true, false, () => {
                updateDataSavingPercent();
                return nxtMatch();
              });
            }, () => {
              updateDataSavingPercent('done');
            });
          } else {
            async.each(mcsdSource2.entry, (entry, nxtEntry) => {
              if (!source2MatchedIDs.includes(entry.resource.id)) {
                source2Unmatched.push({
                  id: entry.resource.id,
                  name: entry.resource.name,
                  parents: source2ParentNames[entry.resource.id].slice(0, source2ParentNames[entry.resource.id].length - 1),
                  mappedParentName: source2MappedParentNames[entry.resource.id][0],
                });
              }
              return nxtEntry();
            }, () => {
              mcsdSource2All = {};
              callback(scoreResults, source2Unmatched, totalAllMapped, totalAllFlagged, totalAllIgnored, totalAllNoMatch);
              async.eachSeries(matchesToSave, (match, nxtMatch) => {
                mcsd.saveMatch(match.source1Id, match.source2Id, match.source1DB, match.source2DB, match.mappingDB, match.recoLevel, match.totalLevels, 'match', true, false, () => {
                  updateDataSavingPercent();
                  return nxtMatch();
                });
              }, () => {
                updateDataSavingPercent('done');
              });
            });
          }
        });
      });

      function updateDataSavingPercent(status) {
        if (status == 'initialize') {
          countSaved = 0;
        } else if (status == 'done') {
          countSaved = totalSource1Records;
        } else {
          countSaved += 1;
        }
        const percent = parseFloat((countSaved * 100 / totalSource1Records).toFixed(1));
        const scoreSavingStatId = `scoreSavingStatus${clientId}`;
        const scoreSavingData = JSON.stringify({
          status: '1/1 - Saving Data',
          error: null,
          percent,
        });
        redisClient.set(scoreSavingStatId, scoreSavingData, 'EX', 1200);
      }
    },
    matchStatus(mcsdMapped, id, callback) {
      if (!mcsdMapped || !mcsdMapped.entry || mcsdMapped.entry.length === 0) {
        return callback();
      }
      const status = mcsdMapped.entry.find(
        entry => entry.resource.id === id
        || (entry.resource.identifier && entry.resource.identifier.find(identifier => identifier.value === id)),
      );
      return callback(status);
    },
    getUnmatched(mcsdAll, mcsdFiltered, mappingDB, getmCSD, source, parentsFields, callback) {
      const unmatched = [];
      const fakeOrgId = config.get('mCSD:fakeOrgId');
      const flagCode = config.get('mapping:flagCode');
      const flagCommentCode = config.get('mapping:flagCommentCode');
      const ignoreCode = config.get('mapping:ignoreCode');
      const noMatchCode = config.get('mapping:noMatchCode');

      const mcsdUnmatched = {
        resourceType: 'Bundle',
        type: 'document',
        entry: [],
      };
      mcsd.getLocations(mappingDB, (mappedLocations) => {
        const parentCache = {};
        async.each(mcsdFiltered.entry, (filteredEntry, filteredCallback) => {
          if (filteredEntry.resource.id === fakeOrgId) {
            return filteredCallback();
          }
          let srcURI;
          if (source === 'source1') {
            srcURI = 'https://digitalhealth.intrahealth.org/source1';
          } else if (source === 'source2') {
            srcURI = 'https://digitalhealth.intrahealth.org/source2';
          }
          const matched = mappedLocations.entry.find(entry => mixin.getIdFromIdentifiers(entry.resource.identifier, srcURI) === filteredEntry.resource.id);
          let status;
          let noMatch;
          let ignored;
          let flagged;
          let flagComments;
          if (matched) {
            noMatch = matched.resource.meta.tag.find(tag => tag.code == noMatchCode);
            ignored = matched.resource.meta.tag.find(tag => tag.code == ignoreCode);
            flagged = matched.resource.meta.tag.find(tag => tag.code == flagCode);
            flagComments = matched.resource.meta.tag.find(tag => tag.code == flagCommentCode);
          }
          let newTag;
          if (noMatch) {
            newTag = noMatch;
            status = 'No Match';
          } else if (ignored) {
            newTag = ignored;
            status = 'Ignored';
          } else if (flagged) {
            newTag = flagged;
            status = 'Flagged';
          }
          let comment = '';
          if (flagComments && flagComments.hasOwnProperty('display')) {
            comment = flagComments.display;
          }
          if (!matched || (matched && status)) {
            if (!status) {
              status = 'Not Processed';
            }
            if (getmCSD) {
              // deep copy filteredEntry before modifying it
              const copiedEntry = JSON.parse(JSON.stringify(filteredEntry));
              let parent;
              if (copiedEntry.resource.partOf && copiedEntry.resource.partOf.reference) {
                parent = copiedEntry.resource.partOf.reference;
              }
              // remove fakeID
              if (parent && parent.endsWith(fakeOrgId)) {
                delete copiedEntry.resource.partOf;
              }
              if (newTag) {
                if (!copiedEntry.resource.meta.tag) {
                  copiedEntry.resource.meta.tag = [];
                }
                copiedEntry.resource.meta.tag.push(newTag);
                if (flagComments) {
                  copiedEntry.resource.meta.tag.push(flagComments);
                }
              }
              mcsdUnmatched.entry.push(copiedEntry);
            }

            const {
              name,
              id,
            } = filteredEntry.resource;
            let entityParent = null;
            if (filteredEntry.resource.hasOwnProperty('partOf')) {
              entityParent = filteredEntry.resource.partOf.reference;
            }
            if (!parentCache[entityParent]) {
              parentCache[entityParent] = [];
              mcsd.getLocationParentsFromData(entityParent, mcsdAll, 'names', (parents) => {
                parentCache[entityParent] = parents.slice(0, parents.length - 1);
                let reversedParents = [];
                reversedParents = reversedParents.concat(parentCache[entityParent]);
                reversedParents.reverse();
                const data = {
                  id,
                  name,
                };
                if (parentsFields) {
                  for (const key in parentsFields) {
                    const parent = parentsFields[key];
                    data[parent] = reversedParents[key];
                  }
                } else {
                  data.parents = parentCache[entityParent];
                }
                data.status = status;
                data.comment = comment;
                unmatched.push(data);
                return filteredCallback();
              });
            } else {
              let reversedParents = [];
              reversedParents = reversedParents.concat(parentCache[entityParent]);
              reversedParents.reverse();
              const data = {
                id,
                name,
              };
              if (parentsFields) {
                for (const key in parentsFields) {
                  const parent = parentsFields[key];
                  data[parent] = reversedParents[key];
                }
              } else {
                data.parents = parentCache[entityParent];
              }
              data.status = status;
              data.comment = comment;
              unmatched.push(data);
              return filteredCallback();
            }
          } else {
            return filteredCallback();
          }
        }, () => {
          callback(unmatched, mcsdUnmatched);
        });
      });
    },
    getMappingStatus(source1Locations, source2Locations, mappedLocations, source1DB, clientId, callback) {
      const noMatchCode = config.get('mapping:noMatchCode');
      const ignoreCode = config.get('mapping:ignoreCode');
      const flagCode = config.get('mapping:flagCode');
      const mappingStatus = {};
      mappingStatus.mapped = [];
      mappingStatus.notMapped = [];
      mappingStatus.flagged = [];
      mappingStatus.noMatch = [];
      mappingStatus.ignore = [];
      let count = 0;
      async.each(source1Locations.entry, (entry, source1Callback) => {
        const ident = entry.resource.identifier.find(identifier => identifier.system == 'https://digitalhealth.intrahealth.org/source1');
        let source1UploadedId = null;
        if (ident) {
          source1UploadedId = ident.value;
        }
        const source1Id = entry.resource.id;
        this.matchStatus(mappedLocations, source1Id, (mapped) => {
          if (mapped) {
            const source2Entry = source2Locations.entry.find((source2Entry) => {
              const matchedSource2Id = mixin.getIdFromIdentifiers(mapped.resource.identifier, 'https://digitalhealth.intrahealth.org/source2');
              return source2Entry.resource.id === matchedSource2Id;
            });
            let nomatch;
            let ignore;
            let flagged;
            if (mapped.resource.meta.hasOwnProperty('tag')) {
              nomatch = mapped.resource.meta.tag.find(tag => tag.code === noMatchCode);
              ignore = mapped.resource.meta.tag.find(tag => tag.code === ignoreCode);
              flagged = mapped.resource.meta.tag.find(tag => tag.code === flagCode);
            }
            if (flagged) {
              mappingStatus.flagged.push({
                source1Name: entry.resource.name,
                source1Id: source1UploadedId,
                source2Name: source2Entry.resource.name,
                source2Id: source2Entry.resource.id,
              });
            } else if (nomatch) {
              mappingStatus.noMatch.push({
                source1Name: entry.resource.name,
                source1Id: source1UploadedId,
              });
            } else if (ignore) {
              mappingStatus.ignore.push({
                source1Name: entry.resource.name,
                source1Id: source1UploadedId,
              });
            } else {
              mappingStatus.mapped.push({
                source1Name: entry.resource.name,
                source1Id: source1UploadedId,
                source2Name: source2Entry.resource.name,
                source2Id: source2Entry.resource.id,
              });
            }
            count += 1;
            const statusRequestId = `mappingStatus${clientId}`;
            const percent = parseFloat((count * 100 / source1Locations.entry.length).toFixed(1));
            const statusResData = JSON.stringify({
              status: '2/2 - Loading Source2 and Source1 Data',
              error: null,
              percent,
            });
            redisClient.set(statusRequestId, statusResData, 'EX', 1200);
            source1Callback();
          } else {
            mappingStatus.notMapped.push({
              source1Name: entry.resource.name,
              source1Id: source1UploadedId,
            });
            count += 1;
            const statusRequestId = `mappingStatus${clientId}`;
            const percent = parseFloat((count * 100 / source1Locations.entry.length).toFixed(1));
            const statusResData = JSON.stringify({
              status: '2/2 - Loading Source2 and Source1 Data',
              error: null,
              percent,
            });
            redisClient.set(statusRequestId, statusResData, 'EX', 1200);
            source1Callback();
          }
        });
      }, () => {
        const statusRequestId = `mappingStatus${clientId}`;
        const statusResData = JSON.stringify({
          status: 'Done',
          error: null,
          percent: 100,
        });
        redisClient.set(statusRequestId, statusResData, 'EX', 1200);
        return callback(mappingStatus);
      });
    },

  };
};
