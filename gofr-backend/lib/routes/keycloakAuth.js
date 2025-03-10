const express = require('express');
const user = require('../modules/user');
const kcadmin = require('../modules/keycloakAdminClient');

const router = express.Router();

const logger = require('../winston');
const fhirAxios = require('../modules/fhirAxios');

router.post('/', (req, res) => {
  fhirAxios.search('Person', { _id: req.body.id }, 'DEFAULT').then((usersRes) => {
    if (!usersRes.entry || (usersRes.entry && usersRes.entry.length === 0)) {
      fhirAxios.update(req.body, 'DEFAULT').then((resp) => {
        kcadmin.populateRoleTasks({
          token: req.headers.authorization.split(' ')[1],
          user: resp,
        }).then((popResp) => {
          let userObj;
          user.createUserInstance(resp, popResp.role).then((obj) => {
            userObj = obj;
            res.status(200).json(userObj);
          }).catch(() => {
            res.status(500).json();
          });
        }).catch((err) => {
          logger.error(err);
          return res.status(500).json();
        });
      }).catch((err) => {
        logger.error(err);
        res.status(500).send();
      });
    } else {
      kcadmin.populateRoleTasks({
        token: req.headers.authorization.split(' ')[1],
        user: usersRes.entry[0].resource,
      }).then(async (popResp) => {
        let userObj;
        user.createUserInstance(usersRes.entry[0].resource, popResp.role).then((obj) => {
          userObj = obj;
          res.status(200).json(userObj);
        }).catch(() => {
          res.status(500).json();
        });
      }).catch((err) => {
        logger.error(err);
        return res.status(500).json();
      });
    }
  });
});
module.exports = router;
