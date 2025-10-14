const { Router } = require('express');
const favorite = require('../../action/favorite');
const catchError = require('../../util/catchError');

const router = Router();
router.use('/', catchError(favorite));

module.exports = router;
